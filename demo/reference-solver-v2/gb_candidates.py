"""gb_candidates —— 候选曲线族。

所有候选都用「以 Emitter 为原点的增量形式」构造：

    u = x − x_emitter
    f(x) = y_emitter + g(u),   g(0) = 0

于是 `f(x_emitter) = y_emitter` 是**恒等式**，与浮点误差无关
（DSL_SPECIFICATION §9）。每一条候选同时给出：

    · `ast`      —— 要提交给平台的 AST（白名单节点）
    · `f`        —— 等价的 Python 闭包，用于搜索期高频打分
    · `targets`  —— 它试图穿过的敌点 id（全部来自 alive 集合）
    · `focus`    —— 主目标 id（用于回合轮换的重复惩罚）

候选族：

    line      过 Emitter 与一个敌点的直线（最平凡的一族）
    bend2     g = a·u + b·u²     —— 一个自由曲率参数
    bend3     g = a·u + c·u³
    wave      g = a·u + A·sin(w·u)
    interp    Newton 插值：精确穿过 Emitter + 1~3 个敌点（一枪多点）
    flat      常函数 f ≡ y_emitter —— 兜底，永远合法
"""

import math

from gb_dsl import DslError, add, num, sub, var, mul, sin, powi


class Candidate(object):
    __slots__ = ("tag", "targets", "focus", "ast", "f", "kind", "baseline_hint")

    def __init__(self, tag, kind, targets, focus, ast, f, baseline_hint=False):
        self.tag = tag
        self.kind = kind
        self.targets = tuple(targets)
        self.focus = focus
        self.ast = ast
        self.f = f
        self.baseline_hint = baseline_hint


def _u_axis(me_x):
    """子表达式 (x − x_emitter) 的 AST。"""
    return sub(var(), num(me_x))


def _coeff_ok(*values):
    for v in values:
        if not math.isfinite(v) or abs(v) > 900.0:
            return False
    return True


# ---------------------------------------------------------------------------
# 单项候选
# ---------------------------------------------------------------------------

def line_to(me_x, me_y, t):
    """过 Emitter 与目标 t 的直线 —— 「最平凡」的构造。"""
    ux = t[1] - me_x
    dy = t[2] - me_y
    if abs(ux) < 1e-9:
        return None
    m = dy / ux
    if not _coeff_ok(m):
        return None

    f = (lambda x, m=m: me_y + m * (x - me_x))
    ast = add(num(me_y), mul(num(m), _u_axis(me_x)))
    return Candidate("line:%s" % t[0], "line", [t[0]], t[0], ast, f)


def bend2_to(me_x, me_y, t, bend):
    """g(u) = a·u + b·u²，a 由「穿过目标」解出。

    `bend` 是**在目标距离处的额外纵向偏移**（而不是裸的二次项系数），
    因此 b = bend / u_t² 会随距离自动缩放，远近距离上的曲线形状一致。
    """
    ux = t[1] - me_x
    dy = t[2] - me_y
    if abs(ux) < 1e-9:
        return None
    b = bend / (ux * ux)
    a = (dy - b * ux * ux) / ux
    if not _coeff_ok(a, b):
        return None

    def f(x, a=a, b=b):
        u = x - me_x
        return me_y + u * (a + b * u)

    U = _u_axis(me_x)
    ast = add(num(me_y), mul(add(num(a), mul(num(b), U)), U))
    tag = "bend2:%s:%+.3g" % (t[0], bend)
    return Candidate(tag, "bend2", [t[0]], t[0], ast, f)


def bend3_to(me_x, me_y, t, bend):
    """g(u) = a·u + c·u³ —— 曲率随距离增长，适合「先平后弯」的绕行。

    同样用「目标距离处的纵向偏移」参数化：c = bend / u_t³。
    """
    ux = t[1] - me_x
    dy = t[2] - me_y
    if abs(ux) < 1e-9:
        return None
    c = bend / (ux * ux * ux)
    a = (dy - c * ux * ux * ux) / ux
    if not _coeff_ok(a, c):
        return None

    def f(x, a=a, c=c):
        u = x - me_x
        return me_y + u * (a + c * u * u * u)

    U = _u_axis(me_x)
    ast = add(num(me_y), mul(add(num(a), mul(num(c), powi(U, 3))), U))
    tag = "bend3:%s:%+.3g" % (t[0], bend)
    return Candidate(tag, "bend3", [t[0]], t[0], ast, f)


def wave_to(me_x, me_y, t, amp, freq):
    """g(u) = a·u + A·sin(w·u)。低频正弦：凸性变号远低于 100，采样也无压力。"""
    ux = t[1] - me_x
    dy = t[2] - me_y
    if abs(ux) < 1e-9:
        return None
    a = (dy - amp * math.sin(freq * ux)) / ux
    if not _coeff_ok(a, amp, freq):
        return None

    def f(x, a=a, amp=amp, freq=freq):
        u = x - me_x
        return me_y + a * u + amp * math.sin(freq * u)

    U = _u_axis(me_x)
    ast = add(num(me_y), add(mul(num(a), U), mul(num(amp), sin(mul(num(freq), U)))))
    tag = "wave:%s:%+.3g:%.3g" % (t[0], amp, freq)
    return Candidate(tag, "wave", [t[0]], t[0], ast, f)


def flat(me_x, me_y):
    """常函数 f ≡ y_emitter —— 永远经过 Emitter，永远有限、C^∞、凸性 0。"""
    ast = num(me_y)
    return Candidate("flat", "flat", [], None, ast, lambda x, y=me_y: y)


# ---------------------------------------------------------------------------
# 多点候选：Newton 插值（精确穿过 Emitter + 若干敌点）
# ---------------------------------------------------------------------------

def interp_through(me_x, me_y, targets):
    """穿过 Emitter 与 targets 的插值多项式（Newton 形式，次数 = len(targets)）。

    Emitter 作为插值表的第 0 个节点（u=0, v=0），因此常数项恒为 0，
    整个多项式可以写成 `u · (…)` —— `g(0) = 0` 在结构上成立。
    """
    us = [0.0] + [t[1] - me_x for t in targets]
    vs = [0.0] + [t[2] - me_y for t in targets]
    if any(abs(u) < 1e-9 for u in us[1:]):
        return None

    # 均差表：table[order][j]，d[order] = table[order][0] 即 Newton 系数。
    # 节点 us[0] = 0 对应 Emitter，vs[0] = 0，因此 d[0] 恒为 0。
    table = [vs[:]]
    d = [vs[0]]
    for order in range(1, len(us)):
        prev = table[order - 1]
        row = []
        for j in range(len(prev) - 1):
            denom = us[j + order] - us[j]
            if abs(denom) < 1e-12:
                return None
            row.append((prev[j + 1] - prev[j]) / denom)
        table.append(row)
        d.append(row[0])
    if not _coeff_ok(*d):
        return None

    k = len(targets)

    def f(x, d=d, us=us, me_x=me_x, me_y=me_y, k=k):
        u = x - me_x
        acc = d[k]
        for j in range(k - 1, 1, -1):
            acc = d[j] + (u - us[j]) * acc
        inner = d[1] + (u - us[1]) * acc
        return me_y + u * inner

    U = _u_axis(me_x)
    acc_ast = num(d[k])
    for j in range(k - 1, 1, -1):
        acc_ast = add(num(d[j]), mul(sub(U, num(us[j])), acc_ast))
    inner_ast = add(num(d[1]), mul(sub(U, num(us[1])), acc_ast))
    ast = add(num(me_y), mul(U, inner_ast))

    tag = "interp%d:%s" % (k, "+".join(t[0] for t in targets))
    return Candidate(tag, "interp", [t[0] for t in targets], targets[0][0], ast, f)


# ---------------------------------------------------------------------------
# 候选族装配
# ---------------------------------------------------------------------------

# 自由曲率参数的取值，单位是「目标距离处的纵向偏移（y 单位）」。
# 刻意取小：保证曲线在场地内，也不触发陡峭 / 凸性限制。
BEND2_VALUES = (1.5, -1.5)
BEND3_VALUES = (2.5, -2.5)
WAVE_VALUES = ((1.6, 0.25), (-1.6, 0.25))


def single_target_candidates(me_x, me_y, target):
    """对一个敌点生成整族候选（约 7 条）。"""
    out = []
    c = line_to(me_x, me_y, target)
    if c:
        out.append(c)
    for b in BEND2_VALUES:
        c = bend2_to(me_x, me_y, target, b)
        if c:
            out.append(c)
    for cv in BEND3_VALUES:
        c = bend3_to(me_x, me_y, target, cv)
        if c:
            out.append(c)
    for amp, freq in WAVE_VALUES:
        c = wave_to(me_x, me_y, target, amp, freq)
        if c:
            out.append(c)
    return out


def multi_target_candidates(me_x, me_y, targets, max_k=3):
    """对 2~max_k 个敌点生成精确插值候选（每个组合恰好穿过的点集不同）。"""
    out = []
    for k in range(2, max_k + 1):
        if len(targets) < k:
            continue
        for combo in _combinations(targets, k):
            c = interp_through(me_x, me_y, combo)
            if c:
                out.append(c)
    return out


def _combinations(items, k):
    n = len(items)
    if k > n:
        return
    idx = list(range(k))
    while True:
        yield tuple(items[i] for i in idx)
        i = k - 1
        while i >= 0 and idx[i] == i + n - k:
            i -= 1
        if i < 0:
            return
        idx[i] += 1
        for j in range(i + 1, k):
            idx[j] = idx[j - 1] + 1


__all__ = [
    "Candidate", "DslError", "flat", "line_to", "interp_through",
    "single_target_candidates", "multi_target_candidates", "_combinations",
]
