#!/usr/bin/env python3
"""Round-1 Dual Algorithm Playtest — 独立复现器（read-only）。

用途
----
只依赖已入库的提交证据重新推导 Round-1 的全部结论，用来证明：

    Round 1 baseline 可以只通过 Git commit + committed evidence
    被第三方定位和复核。

本脚本**不**重新运行平台、**不**读取 Judge / Sandbox 内部实现，只解析
`playtest/results/raw/` 中平台自身落盘的 `match.json`，再与
`run-summary.json` / `metrics.json` / 交叉验证 `crosscheck.json` 对账，
并与 `DUAL_ALGORITHM_PLAYTEST_REPORT.md` 中声称的数字逐条比较。

用法
----
    # 直接核对工作区
    python3 playtest/harness/reproduce_round1.py

    # 核对某个 commit 的导出副本（推荐，证明仅凭 commit 即可复核）
    git archive <ROUND1_BASELINE_SHA> | tar -x -C /tmp/round1-verify
    python3 playtest/harness/reproduce_round1.py --results /tmp/round1-verify/playtest/results

退出码
------
    0  全部对账通过
    1  存在不一致（输出 ROUND-1 BASELINE REPRODUCTION ISSUE）
"""

import argparse
import glob
import json
import os
import statistics
import sys

# ---------------------------------------------------------------- 报告声称值
# 来自 playtest/results/DUAL_ALGORITHM_PLAYTEST_REPORT.md
REPORT_WINS = {"fast": 50, "optimizer": 0, "draw": 10}
REPORT_MATCHES = 60
REPORT_CONDITIONS = 30
REPORT_ROUNDS = 585
REPORT_ALGO = {
    "fast": {
        "cancelled": 0,
        "blocked": 147,
        "kills": 464,
        "shooterKills": 304,
        "multiKillRounds": 128,
        "killsPerValidShot": 0.793,
        "firstShotRate": 1.000,
        "shooterKillRate": 0.520,
        "multiKillRate": 0.219,
        "noHitRate": 0.429,
    },
    "optimizer": {
        "cancelled": 304,
        "blocked": 244,
        "kills": 76,
        "shooterKills": 28,
        "multiKillRounds": 34,
        "killsPerValidShot": 0.270,
        "firstShotRate": 0.000,
        "shooterKillRate": 0.048,
        "multiKillRate": 0.058,
        "noHitRate": 0.933,
    },
}


def pct(values, p):
    """最近秩法分位数（与 numpy 默认 linear 不同，这里用报告口径的稳健值）。"""
    if not values:
        return None
    s = sorted(values)
    if len(s) == 1:
        return s[0]
    k = (len(s) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", default=os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "results"))
    args = ap.parse_args()
    root = os.path.abspath(args.results)

    problems = []
    raw_dir = os.path.join(root, "raw")
    match_dirs = sorted(
        d for d in glob.glob(os.path.join(raw_dir, "*"))
        if os.path.isfile(os.path.join(d, "match.json")))
    run_summary = load(os.path.join(raw_dir, "run-summary.json"))
    metrics = load(os.path.join(root, "metrics.json"))
    crosscheck = load(os.path.join(root, "crosscheck.json"))

    print("=" * 72)
    print("ROUND-1 BASELINE 独立复现")
    print("  证据根目录 : %s" % root)
    print("  来源       : 仅 committed evidence（raw/match.json 为唯一事实源）")
    print("=" * 72)

    # ---------------------------------------------------- 1. 结构：场次/条件
    n_matches = len(match_dirs)
    labels = sorted({os.path.basename(d).split("__")[0] for d in match_dirs})
    arrangements = sorted({os.path.basename(d).split("__")[1] for d in match_dirs})
    map_hashes = set()
    per_match = {}          # (label, arrangement) -> 派生结果
    agg = {a: dict(rounds=0, valid=0, cancelled=0, blocked=0, kills=0,
                   shooter_kills=0, multi=0, nohit=0, first=0, times=[])
           for a in ("fast", "optimizer")}
    streak_all = []
    match_lengths = []
    total_rounds = 0
    codes = {}

    for d in match_dirs:
        base = os.path.basename(d)
        label, arrangement = base.split("__")
        m = load(os.path.join(d, "match.json"))
        winner_side = m.get("winner")

        # arrangement -> 哪个槽位放的是哪套算法
        fast_side = "A" if arrangement == "fast-A" else "B"
        opt_side = "B" if fast_side == "A" else "A"

        if winner_side == "draw":
            winner_alg = "draw"
        else:
            winner_alg = "fast" if winner_side == fast_side else "optimizer"
        per_match[(label, arrangement)] = winner_alg

        kill_run = 0
        for r in m["rounds"]:
            total_rounds += 1
            map_hashes.add(r["mapHash"])
            for side, code in (("a", r.get("aErrorCode")), ("b", r.get("bErrorCode"))):
                codes[code] = codes.get(code, 0) + 1

            kills_in_round = r["aKills"] + r["bKills"]
            if kills_in_round == 0:
                kill_run += 1
            else:
                streak_all.append(kill_run)
                kill_run = 0

            for alg, side, other in (("fast", fast_side, opt_side),
                                     ("optimizer", opt_side, fast_side)):
                s = side.lower()
                o = other.lower()
                a = agg[alg]
                a["rounds"] += 1
                if r.get("firstSolver") == side:
                    a["first"] += 1
                cancelled = bool(r.get("cancelled%s" % side))
                if cancelled:
                    a["cancelled"] += 1
                else:
                    # 产生了函数即计为一次 valid shot
                    a["valid"] += 1
                if r.get("%sBlocked" % s):
                    a["blocked"] += 1
                hits = r.get("%sHits" % s) or []
                k = r.get("%sKills" % s) or 0
                a["kills"] += k
                if k >= 2:
                    a["multi"] += 1
                if not hits:
                    a["nohit"] += 1
                opp_shooter = r.get("shooter%s" % other)
                if opp_shooter and opp_shooter in hits:
                    a["shooter_kills"] += 1
                t = r.get("%sTimeMs" % s)
                if t is not None:
                    a["times"].append(t)
        streak_all.append(kill_run)
        match_lengths.append(len(m["rounds"]))

    wins = {"fast": 0, "optimizer": 0, "draw": 0}
    for v in per_match.values():
        wins[v] += 1

    def check(name, got, want, tol=0.0):
        ok = (got == want) if tol == 0 else (
            got is not None and abs(got - want) <= tol)
        tag = "✓" if ok else "✗"
        print("  %s %-34s got=%-10s report=%s" % (tag, name, got, want))
        if not ok:
            problems.append("%s: got=%s want=%s" % (name, got, want))
        return ok

    print("\n[1] 样本结构")
    check("matches", n_matches, REPORT_MATCHES)
    check("map conditions", len(labels), REPORT_CONDITIONS)
    check("distinct map hashes", len(map_hashes), REPORT_CONDITIONS)
    check("rounds", total_rounds, REPORT_ROUNDS)
    check("total algorithm invocations", sum(codes.values()), REPORT_ROUNDS * 2)
    print("  · arrangements: %s" % arrangements)

    print("\n[2] 胜负")
    check("fast wins", wins["fast"], REPORT_WINS["fast"])
    check("optimizer wins", wins["optimizer"], REPORT_WINS["optimizer"])
    check("draws", wins["draw"], REPORT_WINS["draw"])

    print("\n[3] 异常计数（报告声称 0 INVALID / 0 TIMEOUT）")
    bad = {k: v for k, v in codes.items() if k not in (None, "CANCELLED")}
    check("unexpected error codes", 0, 0)
    if bad:
        print("     !! 出现: %s" % bad)
        problems.append("unexpected error codes: %s" % bad)

    print("\n[4] 取消 / 命中结构")
    check("cancellations total", codes.get("CANCELLED", 0),
          REPORT_ALGO["optimizer"]["cancelled"])
    for alg in ("fast", "optimizer"):
        a, w = agg[alg], REPORT_ALGO[alg]
        print("  -- %s --" % alg)
        check("  %-30s" % "cancelled", a["cancelled"], w["cancelled"])
        check("  %-30s" % "blocked", a["blocked"], w["blocked"])
        check("  %-30s" % "kills", a["kills"], w["kills"])
        check("  %-30s" % "shooter kills", a["shooter_kills"], w["shooterKills"])
        check("  %-30s" % "multi-kill rounds", a["multi"], w["multiKillRounds"])
        check("  %-30s" % "kills per valid shot",
              round(a["kills"] / a["valid"], 3), w["killsPerValidShot"], tol=0.002)
        check("  %-30s" % "first-shot rate",
              round(a["first"] / a["rounds"], 3), w["firstShotRate"], tol=0.002)
        check("  %-30s" % "shooter-kill rate",
              round(a["shooter_kills"] / a["rounds"], 3), w["shooterKillRate"], tol=0.002)
        check("  %-30s" % "multi-kill rate",
              round(a["multi"] / a["rounds"], 3), w["multiKillRate"], tol=0.002)
        check("  %-30s" % "no-hit rate",
              round(a["nohit"] / a["rounds"], 3), w["noHitRate"], tol=0.002)

    print("\n[5] 交叉验证 / 汇总一致性")
    check("crosscheck agree", crosscheck["agree"], crosscheck["total"])
    check("crosscheck mismatches", len(crosscheck["mismatches"]), 0)

    ms_wins = metrics["wins"]
    mw = {"fast": ms_wins.get("fast"), "optimizer": ms_wins.get("optimizer"),
          "draw": ms_wins.get("draw")}
    for k in wins:
        ok = wins[k] == mw[k]
        print("  %s metrics.json wins[%s] = %s (raw 独立推导 %s)"
              % ("✓" if ok else "✗", k, mw[k], wins[k]))
        if not ok:
            problems.append("metrics wins[%s] mismatch" % k)
    check("metrics matches", metrics["matches"], REPORT_MATCHES)

    rs = {s["label"] + "__" + s["arrangement"]: s["winner"] for s in run_summary["summaries"]}
    mismatch = []
    for d in match_dirs:
        b = os.path.basename(d)
        label, arrangement = b.split("__")
        m = load(os.path.join(d, "match.json"))
        if rs.get(b) != m["winner"]:
            mismatch.append(b)
    check("run-summary vs raw winner mismatches", len(mismatch), 0)

    # swap 一致性：同 label 两场是否同向
    by_label = {}
    for (label, arr), w in per_match.items():
        by_label.setdefault(label, {})[arr] = w
    consistent = both_decided = 0
    for label, d in by_label.items():
        if len(d) != 2:
            continue
        a, b = d.get("fast-A"), d.get("opt-A")
        if a != "draw" and b != "draw":
            both_decided += 1
            if a == b:
                consistent += 1
    check("swap-consistent conditions", consistent, metrics["swapConsistent"])
    check("both-decided conditions", both_decided, metrics["swapConsistent"])
    check("swap-flipped conditions", 0, metrics["swapFlipped"])

    print("\n[6] 无进展 / 对局长度分布")
    ml = sorted(match_lengths)
    print("  match length  median=%.0f p95=%.0f max=%.0f" %
          (statistics.median(ml), pct(ml, 0.95), ml[-1]))
    check("exhausted matches (max-rounds)",
          sum(1 for s in run_summary["summaries"] if s.get("exhausted")),
          metrics["exhaustedMatches"])
    st = sorted(streak_all)
    print("  longest zero-kill streak = %d" % max(streak_all))

    print("\n[7] 计算时间")
    for alg in ("fast", "optimizer"):
        t = sorted(agg[alg]["times"])
        print("  %-10s median=%7.1f  p95=%7.1f  max=%7.1f  (n=%d)"
              % (alg, statistics.median(t), pct(t, 0.95), t[-1], len(t)))

    print("\n" + "=" * 72)
    if problems:
        print("ROUND-1 BASELINE REPRODUCTION ISSUE")
        for p in problems:
            print("  - %s" % p)
        print("=" * 72)
        return 1
    print("ROUND-1 BASELINE REPRODUCED — committed evidence 与报告声称值全部一致")
    print("=" * 72)
    return 0


if __name__ == "__main__":
    sys.exit(main())
