"""gb_select —— 每回合的重新打分、目标轮换与「无进展」抑制。

本模块是 v2 相对旧 demo 算法的**全部差异所在**。旧算法的问题是：
连续多个回合瞄同一个位置（同一目标点、同一条几乎重合的曲线），局面卡死。

沙箱每轮销毁重建、禁止跨轮持久化（ALGORITHM_REQUIREMENTS §8 / M12），
所以「上一回合打了谁」**不可能**被记住 —— 只能从**当前输入**反推。
本模块用两种互补的、完全由当前输入决定的机制：

1. **确定性轮换（stale slate）**
   `round` 是公开输入。把存活敌点按 id 排成一个稳定序列 E，
   定义 `focus(r) = E[(r + phase) mod n]`。于是「最近 k 个回合本该盯的目标」
   是可以从 `(round, 当前存活集合, match_id)` 直接算出来的：
   `slate_k = E[(round − k + phase) mod n]`。
   落在 slate 里的目标按近远降权（最近的最重）。这是**惩罚**而不是强制 ——
   击杀数永远优先，轮换只在同击杀数之间起作用。

   局限（README 里也写了）：真正的历史不是用当前存活集合算的。点位阵亡后 n 变小、
   序列整体位移，重建出的 slate 会与实际打过的目标错位。它是「避免复读」的
   启发式，不是账本。

2. **最平凡轨迹抑制（no-progress）**
   按当前局面能构造出的最平凡那条 = 过 Emitter、瞄「|Δy| 最小的存活敌点」的直线
   （也就是 starter 的默认选择）。若某个候选的**击杀集合与它相同**且**曲线几乎
   重合**，那这一枪在结果上与「什么都不做」等价 —— 跳过它，换下一名候选。
   两个条件缺一不可：击杀更多、或曲线明显不同，都不算复读。

   跳过有一条硬约束：**只有当存在另一个非复读候选能拿到同样的击杀数时才跳**。
   否则宁可复读也不放弃一次真实击杀 —— 反重复不能以打空为代价。

除此之外，所有候选**每回合重新模拟、重新打分**，不缓存任何跨回合选择。
"""

import math
import time

from gb_candidates import (
    Candidate, flat, interp_through, line_to,
    multi_target_candidates, single_target_candidates,
)
from gb_dsl import agrees_with_ast, assert_emittable
from gb_world import COARSE_STEP, FINE_STEP, simulate

# 打分权重。KILL_WEIGHT 必须**远大于**所有惩罚之和，
# 保证「多杀一个点」永远压过「换一个目标」。
KILL_WEIGHT = 1000.0
STALE_PENALTY = 150.0
GENTLE_BONUS = 0.02          # 轻微偏好起伏小的曲线
ROTATION_WINDOW = 3          # 回看多少个回合
MAX_PAIR_TARGETS = 6         # 双点组合只对单点得分最高的 6 个目标做
MAX_TRIPLE_TARGETS = 4       # 三点组合只对前 4 个做（组合数增长快，控制预算）
MAX_VERIFY_TRIES = 6         # 定稿前的复核重试次数
TRIVIAL_TOL = 0.5            # 判定「几乎重合」的纵向容差


class Budget(object):
    """墙钟预算。超时前必须交出结果 —— 宁可少搜几个候选，也不能 TIMEOUT。"""

    def __init__(self, ms):
        self.t0 = time.monotonic()
        self.ms = ms

    def elapsed_ms(self):
        return (time.monotonic() - self.t0) * 1000.0

    def spent(self, reserve_ms=0.0):
        return self.elapsed_ms() >= (self.ms - reserve_ms)


# ---------------------------------------------------------------------------
# 轮换相位 / stale slate
# ---------------------------------------------------------------------------

def rotation_phase(match_id, team):
    """由 match_id + team 派生的确定性相位（FNV-1a 32 位）。

    用 match_id 是为了让不同比赛落在不同的轮换起点；同一场比赛内它是常量，
    因此轮换序列完全可复现（不依赖任何随机源）。
    """
    h = 2166136261
    for byte in (str(match_id) + "|" + str(team)).encode("utf-8"):
        h ^= byte
        h = (h * 16777619) & 0xFFFFFFFF
    return h % 997


def stale_slate(world, alive_ids):
    """返回 {id: 权重}，权重越大表示「越像是最近几个回合刚打过」。

    只读当前输入（round / 存活集合 / match_id），不含任何跨轮状态。
    """
    n = len(alive_ids)
    if n <= 1:
        return {}
    phase = rotation_phase(world.match_id, world.team)
    window = min(ROTATION_WINDOW, n - 1)   # 至少留一个「新鲜」目标
    if window <= 0:
        return {}
    total = window * (window + 1) / 2.0
    out = {}
    for k in range(1, window + 1):
        idx = (world.round_no - k + phase) % n
        tid = alive_ids[idx]
        out[tid] = out.get(tid, 0.0) + (window - k + 1) / total
    for tid in list(out):
        out[tid] = min(1.0, out[tid])
    return out


# ---------------------------------------------------------------------------
# 轨迹距离（用于「几乎重合」判定）
# ---------------------------------------------------------------------------

def trajectory_distance(fa, fb, world):
    """两条曲线在攻击区间上的最大纵向差。"""
    span = abs(world.x_end - world.me_x)
    if span <= 0:
        return abs(fa(world.me_x) - fb(world.me_x))
    steps = max(8, int(span / 0.25) + 1)
    worst = 0.0
    for i in range(steps + 1):
        x = world.me_x + (world.x_end - world.me_x) * (i / float(steps))
        a = fa(x)
        b = fb(x)
        if not (math.isfinite(a) and math.isfinite(b)):
            return float("inf")
        d = abs(a - b)
        if d > worst:
            worst = d
    return worst


# ---------------------------------------------------------------------------
# 单候选评估
# ---------------------------------------------------------------------------

def evaluate_candidate(cand, world, stale, baseline_sim, baseline_f, step):
    """模拟 + 打分。返回 dict 或 None（候选作废）。"""
    try:
        return _evaluate_candidate(cand, world, stale, baseline_sim, baseline_f, step)
    except Exception:
        # 单条候选出错只作废它自己，绝不影响整轮求解。
        return None


def _evaluate_candidate(cand, world, stale, baseline_sim, baseline_f, step):
    assert_emittable(cand.ast)

    # 闭包与 AST 必须是同一个函数 —— 否则「打中了」的结论对提交物不成立。
    span = abs(world.x_end - world.me_x)
    samples = [world.me_x + span * (i / 9.0) for i in range(10)]
    if not agrees_with_ast(cand.f, cand.ast, samples):
        return None

    sim = simulate(cand.f, world, step)
    kills = len(sim["kills"])

    # 轮换惩罚：候选瞄的每个目标取 stale 权重的均值。
    stale_score = 0.0
    if stale and cand.targets:
        stale_score = sum(stale.get(t, 0.0) for t in cand.targets) / float(len(cand.targets))

    # 「最平凡轨迹」判定：结果相同 **且** 曲线几乎重合 —— 两者缺一不可。
    trivial = 0.0
    if baseline_sim is not None and kills == len(baseline_sim["kills"]):
        if trajectory_distance(cand.f, baseline_f, world) < TRIVIAL_TOL:
            trivial = 1.0

    # 轻微偏好起伏小的曲线（在击杀与轮换都相同时才起作用）。
    peak = 0.0
    for i in range(0, 41):
        x = world.me_x + (world.x_end - world.me_x) * (i / 40.0)
        y = cand.f(x)
        if math.isfinite(y):
            peak = max(peak, abs(y))

    score = (KILL_WEIGHT * kills
             - STALE_PENALTY * stale_score
             - GENTLE_BONUS * peak)
    return {
        "score": score, "kills": kills, "kill_ids": sim["kills"],
        "stale": stale_score, "trivial": trivial,
        "end_x": sim["end_x"], "reason": sim["reason"],
    }


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

def choose_shot(world, budget_ms):
    """在当前局面上选一条曲线。返回 (candidate, diagnostics)。"""
    budget = Budget(budget_ms)
    alive_ids = [e[0] for e in world.enemies]
    diag = {
        "alive": len(alive_ids), "dead": len(world.dead),
        "round": world.round_no, "candidates": 0,
        "baseline": None, "chosen": None, "skipped": [], "capped": False,
    }

    fallback = flat(world.me_x, world.me_y)
    if not world.enemies:
        diag["chosen"] = "flat(no-alive-target)"
        diag["ms"] = round(budget.elapsed_ms(), 2)
        return fallback, diag

    # ---- 最平凡的那条：|Δy| 最小的存活敌点 + 直线（starter 的默认选择）----
    nearest = min(world.enemies, key=lambda t: (abs(t[2] - world.me_y), abs(t[1] - world.me_x)))
    baseline = line_to(world.me_x, world.me_y, nearest) or fallback
    baseline_sim = simulate(baseline.f, world, COARSE_STEP)
    diag["baseline"] = "%s(kills=%d)" % (baseline.tag, len(baseline_sim["kills"]))

    stale = stale_slate(world, alive_ids)

    scored = []

    def add_candidates(cands):
        for cand in cands:
            if cand is None:
                continue
            row = evaluate_candidate(cand, world, stale, baseline_sim, baseline.f, COARSE_STEP)
            if row is None:
                continue
            row["cand"] = cand
            scored.append(row)

    # ---- 全部单目标候选（每回合重新生成、重新打分）----
    singles = []
    for target in world.enemies:
        singles.extend(single_target_candidates(world.me_x, world.me_y, target))
    add_candidates(singles)

    # ---- 多点候选：只对单目标得分最高的若干目标做组合 ----
    if not budget.spent(reserve_ms=180.0) and scored:
        ranked_singles = sorted(scored, key=lambda r: (-r["score"], r["cand"].tag))
        ranked_targets = []
        seen = set()
        for row in ranked_singles:
            tid = row["cand"].targets[0]
            if tid in seen:
                continue
            seen.add(tid)
            ranked_targets.append(next(t for t in world.enemies if t[0] == tid))
        pairs = ranked_targets[:MAX_PAIR_TARGETS]
        if len(pairs) >= 2:
            add_candidates(multi_target_candidates(world.me_x, world.me_y, pairs, max_k=2))
        triples = ranked_targets[:MAX_TRIPLE_TARGETS]
        if len(triples) >= 3:
            add_candidates(multi_target_candidates(world.me_x, world.me_y, triples, max_k=3))
    else:
        diag["capped"] = True

    diag["candidates"] = len(scored)
    if not scored:
        diag["chosen"] = "flat(no-legal-candidate)"
        diag["ms"] = round(budget.elapsed_ms(), 2)
        return fallback, diag

    # ---- 排序：分数降序，tag 升序（确定性 tie-break）----
    scored.sort(key=lambda r: (-r["score"], r["cand"].tag))

    # ---- 选枪 ----
    # 「复读」判据：击杀结果与最平凡那条相同 **且** 曲线几乎重合。
    # 跳过它的前提是**存在一个非复读候选能拿到同样的击杀数** ——
    # 绝不用「换个姿势」换掉一次真实的击杀（那才是真正的不讲道理）。
    non_trivial_kills = -1
    for row in scored:
        if row["trivial"] == 0.0:
            non_trivial_kills = row["kills"]
            break

    chosen = None
    for row in scored:
        if row["trivial"] > 0.0 and row["kills"] <= non_trivial_kills:
            # 与最平凡那条等价、且换得掉 —— 这一枪等于复读，跳过。
            diag["skipped"].append(row["cand"].tag)
            continue
        if not _verify(row, world):
            # 细步长复核不同意粗步长的乐观结论 —— 换下一条。
            diag["skipped"].append(row["cand"].tag + "(verify)")
            continue
        chosen = row
        break

    if chosen is None:
        # 所有候选都被跳过或复核不通过：退到排序第一名，但**必须**复核过。
        for row in scored[:MAX_VERIFY_TRIES]:
            if _verify(row, world):
                chosen = row
                break
        if chosen is None:
            chosen = scored[0]
            fine = simulate(chosen["cand"].f, world, FINE_STEP)
            chosen["kills"] = len(fine["kills"])
            chosen["kill_ids"] = fine["kills"]
        diag["capped"] = True

    diag["chosen"] = "%s(kills=%d,stale=%.2f,trivial=%.0f)" % (
        chosen["cand"].tag, chosen["kills"], chosen["stale"], chosen["trivial"])
    diag["ms"] = round(budget.elapsed_ms(), 2)
    return chosen["cand"], diag


def _verify(row, world):
    """用比平台更细的步长复核候选。击杀数只能持平或变多，变少即否决。"""
    fine = simulate(row["cand"].f, world, FINE_STEP)
    if len(fine["kills"]) < row["kills"]:
        return False
    row["kills"] = len(fine["kills"])
    row["kill_ids"] = fine["kills"]
    row["end_x"] = fine["end_x"]
    row["reason"] = fine["reason"]
    return True


__all__ = ["choose_shot", "stale_slate", "rotation_phase", "Budget"]
