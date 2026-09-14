# Hybrid Tactical-First Anytime Optimizer

<a href="./README.md">English</a> | **简体中文**

Geometry Battle V1.1 参赛算法（Round 2）。第三套算法,用于回答:

> Fast Tactical Solver 的统治究竟来自合理的算法 meta,
> 还是 First Solver + Shooter Cancellation 让策略空间过度收缩?

## 定位

不是 Fast 的副本,也不是给 Optimizer 加一句 `if shooter: ...`。
它是一个**真正的 anytime search**:

> 在任意较早时间停止,都已经拥有一个可执行的合法候选;
> 随着计算继续,函数质量逐步提高。

实现上这是字面意义上的:第一个被构造的东西就是一条保证合法的 fallback,
`best` 在任何候选胜过它时立刻更新,每个阶段边界都是「此刻停手也能交卷」的点。

## 三个阶段

| 阶段 | 内容 | 预算 |
|---|---|---|
| Stage 1 战术 | 刺杀直线、对每个敌点的直线、恰好过(对方 Shooter + 任一敌点)的二次曲线、单参数 bend 族扫描 | ~3 ms(软上限 60 ms) |
| Stage 2 多目标 | 最多 3 点的精确有理插值、三角族、复合族 | ≤ 320 ms |
| Stage 3 深挖 | 自由度扫描下更大的目标组合、局部细化 | ≤ 250 ms,且仅在 1/2 阶段拿不出决定性解时启用 |

**Early Return**: Stage 1 本身已覆盖全部廉价战术答案(它不是一个采样,而是整个族),
所以 Stage 1 走完时若已持有 shooter kill 或 ≥2 杀,立即开火、不再进入后续阶段。
这不是优化,而是规则经济学的直接后果——平台从 GO 到结果落盘计时,多花的每一毫秒
都是「尚未开火」,而对手的攻击可以在这段时间里把本轮整个取消。

## 几何与合法性

曲线一律写成以自身 Shooter 为原点的增量形式:

```
V = (x - x_s) / L,  f(x) = y_s + g(V),  g(0) = 0
```

`f(x_s) = y_s` 因此是恒等式,不会漂移到 1e-6 的 Shooter 容差边缘;
`L` 把攻击区间归一化到 `|V| ≤ 1`,多项式系数自然落在 `|const| ≤ 1000` 之内。

多项式插值用 `fractions.Fraction` 精确求解,最后一步才转 float。
目标点在 V 上聚集时 Vandermonde 会病态,系数可以冲到 1e4 量级——
这类组合会被显式跳过,而不是花代价去解一个注定失败的方程。

轨迹扫描是**保守**的:无法证明通畅就判为 blocked。
误判 blocked 只损失一次击杀,误判 clear 会损失整轮。

## 模块

```
solver.py       入口、时间预算、原子写、GB_DIAG 分阶段诊断
gbhy/world.py   (public, reveal, team) → Shooter 坐标系的棋盘
gbhy/dsl.py     AST 构造、度量、公开合法性筛查
gbhy/geom.py    轨迹扫描(障碍 / 场地边界 / 命中)与打分
gbhy/fit.py     精确有理插值
gbhy/cand.py    分阶段候选族
gbhy/search.py  anytime 编排器
```

## 规则来源

只使用冻结的 Playtest Rules 与公开的 `competitor-kit/`。
未读取 Judge / Validator / SandboxRunner 的任何内部实现。

场地边界终止来自 Playtest Rules §34 明文,并在 Round 1 由独立黑盒
cross-check(866/866 一致)确认;本算法不使用任何未公开常量。

## 实测(1170 个真实世界 × 2 队别)

| 指标 | Hybrid | Fast(Round 1) | Optimizer(Round 1) |
|---|---|---|---|
| 非法 / 崩溃 | **0** | 0 | 0 |
| 墙上时间中位 | 30.9 ms | 27.2 ms | 189.7 ms |
| 墙上时间 p95 | 87.0 ms | 53.5 ms | 332.6 ms |
| 自身口径耗时中位 | 8.7 ms | — | — |
| 预测命中对方 Shooter | 48.3% | 53.6% | 55.0% |
| Stage 1 早返回占比 | 46.1% | — | — |

Local Validator / Official Preflight: **PASS**(2 队别 × 9 分节)。
