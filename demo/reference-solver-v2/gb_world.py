"""gb_world —— 局面模型 + 轨迹模拟（Judge 规则的只读镜像）。

搜索需要一个「这一枪能打死谁」的预测器。平台侧的唯一事实来源是
`src/core/Judge.ts`（traceTrajectory + judgeShot）。本模块按同一套规则
重新实现一遍，只为了**打分**：

    · 只瞄准 `alive == true` 的敌方战斗点（规范 §3 / S6）；
    · 敌方点必须位于攻击方向上，且位于首次终止事件之前；
    · 首次障碍物接触即截断（接触点之前有效）；
    · 首次离开 y ∈ [ymin, ymax] 即永久终止；
    · 命中容差 |f(x_p) − y_p| ≤ 1e-6。

**它不是 Judge，也不参与判定**：平台的判定永远以 Judge.ts 为准。本模块
只影响「选哪条曲线」，选错最多是这一枪打空，不会产出非法结果。

性能取舍：搜索期用较粗的步长（见 COARSE_STEP），候选定稿后再用比平台更细的
步长（FINE_STEP）复算一次，只有复算同意的候选才会被提交。
"""

import math

# 搜索期步长。比平台的 min(0.005, ...) 粗，换取 60~80 个候选的整体预算。
COARSE_STEP = 0.02
# 定稿复核步长：比平台更细，宁可自己更保守。
FINE_STEP = 0.002
# Judge.ts 的场外判定容差。
FIELD_EPS = 1e-9


class World(object):
    """一轮公开/揭盲输入解出的、与队别相关的局面。"""

    __slots__ = (
        "team", "me_x", "me_y", "x_end", "dir",
        "ymin", "ymax", "enemies", "dead", "obstacles", "round_no", "match_id",
    )

    def __init__(self, team, me_x, me_y, x_end, ymin, ymax,
                 enemies, dead, obstacles, round_no, match_id):
        self.team = team
        self.me_x = float(me_x)
        self.me_y = float(me_y)
        self.x_end = float(x_end)
        self.dir = 1 if self.x_end > self.me_x else -1
        self.ymin = float(ymin)
        self.ymax = float(ymax)
        # [(id, x, y)]，仅存活敌点，按 id 排序（顺序稳定 => 结果可复现）
        self.enemies = enemies
        self.dead = dead
        self.obstacles = obstacles
        self.round_no = round_no
        self.match_id = match_id


def build_world(team, public, reveal):
    """从两份输入构造局面。攻击方向与有效范围来自规范 §6。"""
    arena = public.get("map") or {}
    ymin = float(arena.get("ymin", -12.0))
    ymax = float(arena.get("ymax", 12.0))
    x_field_min = float(arena.get("xmin", -20.0))
    x_field_max = float(arena.get("xmax", 20.0))

    emit = (public.get("emitters") or {}).get(team) or {}
    me_x = float(emit.get("x", -18.0 if team == "A" else 18.0))
    me_y = float(emit.get("y", 0.0))

    # 攻击方向：A 向 +x 到 xmax，B 向 −x 到 xmin（Rules.attackEndX）。
    x_end = x_field_max if team == "A" else x_field_min

    enemies = []
    dead = []
    for p in public.get("points") or []:
        if p.get("team") == team:
            continue
        item = (str(p.get("id")), float(p.get("x", 0.0)), float(p.get("y", 0.0)))
        if p.get("alive", True):
            enemies.append(item)
        else:
            dead.append(item)
    # 按 id 排序：输入数组的顺序不携带含义（JSON_SCHEMA §4），
    # 我们自建一个稳定顺序，让「轮换」在同样输入下必然得到同样结果。
    enemies.sort(key=lambda e: e[0])
    dead.sort(key=lambda e: e[0])

    return World(
        team, me_x, me_y, x_end, ymin, ymax,
        enemies, dead, [normalize_obstacle(o) for o in (reveal.get("obstacles") or [])],
        int(public.get("round", 0) or 0),
        str(public.get("match_id", "")),
    )


def _circle_center(ob):
    """圆心 —— **两种形状都收**，缺了就说清楚，绝不静默当作 0。

    协议下发给算法的是 `{"cx":…, "cy":…}`（`InputProtocol.buildRevealState`），
    而平台**内部**与回放帧用的是核心形态 `{"center": [x, y]}`。开发时若拿回放帧
    拼一份输入来复现问题，很容易把后者喂进来。

    这里原先写的是 `ob.get("cx", 0.0)` —— 缺键时静默退化成 0.0，
    圆会被悄悄挪到 x=0：**输入错了，但答案看起来完全合理**，
    于是「复现出来的现象」与真实比赛毫无关系。宁可当场报错。
    """
    if "cx" in ob or "cy" in ob:
        return float(ob.get("cx", 0.0)), float(ob.get("cy", 0.0))
    center = ob.get("center")
    if isinstance(center, (list, tuple)) and len(center) == 2:
        return float(center[0]), float(center[1])
    raise ValueError("圆形障碍物缺少圆心：既没有 cx/cy，也没有 center: [x, y]")


def normalize_obstacle(ob):
    """把障碍物收敛成内部统一形状（圆用 cx/cy），形状不认识就报错。"""
    kind = ob.get("type")
    if kind == "circle":
        cx, cy = _circle_center(ob)
        r = ob.get("radius")
        if r is None:
            raise ValueError("圆形障碍物缺少 radius")
        return {"type": "circle", "cx": cx, "cy": cy, "radius": float(r)}
    if kind in ("rectangle", "polygon", "segment"):
        return dict(ob)
    raise ValueError("无法识别的障碍物类型: %r" % (kind,))


# ---------------------------------------------------------------------------
# 障碍物几何（镜像 src/obstacle/Obstacle.ts 的距离定义）
# ---------------------------------------------------------------------------

def obstacle_x_span(ob):
    """障碍物在 x 方向的占用区间（闭区间）。"""
    if ob.get("type") == "circle":
        cx, _ = _circle_center(ob)
        r = float(ob["radius"])
        return cx - r, cx + r
    return float(ob.get("xmin", 0.0)), float(ob.get("xmax", 0.0))


def obstacle_y_span(ob):
    """障碍物在 y 方向的占用区间（闭区间）。"""
    if ob.get("type") == "circle":
        _, cy = _circle_center(ob)
        r = float(ob["radius"])
        return cy - r, cy + r
    return float(ob.get("ymin", 0.0)), float(ob.get("ymax", 0.0))


# 兼容旧内部的私有名（本模块内仍在用）
_obstacle_x_range = obstacle_x_span


def penetration(x, y, ob):
    """外部为正、接触或内部为 0（Judge.penetration 的同口径实现）。"""
    if ob.get("type") == "circle":
        cx, cy = _circle_center(ob)
        r = float(ob["radius"])
        d = math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
        return max(0.0, d - r)
    xmin = float(ob.get("xmin", 0.0))
    xmax = float(ob.get("xmax", 0.0))
    ymin = float(ob.get("ymin", 0.0))
    ymax = float(ob.get("ymax", 0.0))
    if xmin <= x <= xmax and ymin <= y <= ymax:
        return 0.0
    dx = max(xmin - x, 0.0, x - xmax)
    dy = max(ymin - y, 0.0, y - ymax)
    return math.sqrt(dx * dx + dy * dy)


def _first_contact_x(f, ob, x_lo, x_hi, direction, steps):
    """曲线在 [x_lo, x_hi] 上与障碍物的首次接触 x（沿传播方向）。"""
    o_lo, o_hi = _obstacle_x_range(ob)
    lo = max(x_lo, min(o_lo, o_hi))
    hi = min(x_hi, max(o_lo, o_hi))
    if hi < lo:
        return None

    def pen(x):
        y = f(x)
        if not math.isfinite(y):
            return float("inf")
        return penetration(x, y, ob)

    if hi - lo <= 1e-12:
        return lo if pen(lo) <= 0.0 else None

    if direction == 1:
        start, end = lo, hi
    else:
        start, end = hi, lo

    if pen(start) <= 0.0:
        return start

    prev_x = start
    for i in range(1, steps + 1):
        x = start + (end - start) * i / steps
        if pen(x) <= 0.0:
            a, b = prev_x, x
            for _ in range(48):
                m = 0.5 * (a + b)
                if pen(m) <= 0.0:
                    b = m
                else:
                    a = m
            return b
        prev_x = x
    return None


def _is_before(x, limit, direction):
    return x < limit - 1e-12 if direction == 1 else x > limit + 1e-12


# ---------------------------------------------------------------------------
# 单次射击的模拟
# ---------------------------------------------------------------------------

def simulate(f, world, step):
    """返回 {'kills': [...], 'end_x': float, 'blocked_x': float|None, 'reason': str}。

    `f` 是候选曲线的 Python 闭包（与它要提交的 AST 同函数）。
    """
    me_x, me_y = world.me_x, world.me_y
    x_end = world.x_end
    direction = world.dir

    # ---- 1. 首次障碍物接触 ----
    blocked_x = None
    for ob in world.obstacles:
        cx = _first_contact_x(f, ob, min(me_x, x_end), max(me_x, x_end), direction, 160)
        if cx is None:
            continue
        if blocked_x is None or _is_before(cx, blocked_x, direction):
            blocked_x = cx

    # ---- 2. 首次离开场地（永久终止）----
    span = abs(x_end - me_x)
    n = max(2, int(span / step) + 1)
    end_x = x_end
    reason = "FIELD_EDGE"
    last_inside_x = me_x
    for i in range(n + 1):
        x = me_x + direction * span * (i / float(n))
        y = f(x)
        if not math.isfinite(y):
            end_x = last_inside_x
            reason = "NON_FINITE"
            break
        if y < world.ymin - FIELD_EPS or y > world.ymax + FIELD_EPS:
            a, b = last_inside_x, x
            for _ in range(48):
                m = 0.5 * (a + b)
                ym = f(m)
                if not math.isfinite(ym) or ym < world.ymin - FIELD_EPS or ym > world.ymax + FIELD_EPS:
                    b = m
                else:
                    a = m
            end_x = b
            reason = "OUT_OF_FIELD"
            break
        last_inside_x = x

    if blocked_x is not None and _is_before(blocked_x, end_x, direction):
        end_x = blocked_x
        reason = "OBSTACLE"

    # ---- 3. 命中判定 ----
    kills = []
    for pid, px, py in world.enemies:
        if direction == 1:
            if px < me_x - 1e-12 or px > end_x + 1e-12:
                continue
        else:
            if px > me_x + 1e-12 or px < end_x - 1e-12:
                continue
        if blocked_x is not None and not _is_before(px, blocked_x, direction):
            continue
        y = f(px)
        if not math.isfinite(y):
            continue
        if abs(y - py) <= 1e-6:
            kills.append(pid)

    return {"kills": kills, "end_x": end_x, "blocked_x": blocked_x, "reason": reason}
