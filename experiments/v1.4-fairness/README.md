# V1.4 平台公平性实验（experiments/v1.4-fairness）

> 目的：回答「Geometry Battle 对 Team A / Team B 是否镜像公平」，并把答案固化成
> 可重复的测试与可重跑的实验脚本。**本目录只放实验脚本、说明与结果摘要**；
> 原始产物写到 `experiments/v1.4-fairness/results/<日期>/`（本目录 `.gitignore` 已忽略 `results/`），
> 绝不写进 `runs/`、`artifacts/`、`algorithms/`。

## 1. 永久测试（已落地，`tests/`）

| 套件 | 层次 | 命令 | 耗时 |
|---|---|---|---|
| `tests/mirror-helpers.ts` | 共用镜像变换 M（x' = −x，A↔B，id 重标，障碍物保序，Emitter 互换） | 被下面两套导入；自检 `selfCheck()` 在 L1 调用 | — |
| `tests/mirror-fairness.ts` | Level 1–5：几何原语 / Validator（2400 随机 AST + 198 定向探针）/ 轨迹 / 命中 / 单回合（纯函数，不起沙箱） | `npx ts-node tests/mirror-fairness.ts` | ≈ 20 s |
| `tests/mirror-match.ts` | Level 6：symmetry-probe 自战，真沙箱整场，第二场把镜像地图喂给引擎 | `npx ts-node tests/mirror-match.ts` | ≈ 1–3 min（4 个 seed × 2 场） |

镜像关系是**语义**的：哈希字节（地图哈希、输入哈希）本来就不同，不比较；
比较的是 winner 互换、endReason 相同、逐回合 kills / hits / blocked 互换并重标、
回放轨迹 x 取负 y 不变、命中点镜像、函数 f'(−x) 与 f(x) 逐位同值。

## 2. Symmetry Probe（`tests/fixtures/algos/symmetry-probe/`）

**审计 fixture，不是选手**；不得作为 Tournament Mode 的内置选手暴露。

设计要点：

- 一切几何都在**局部前进坐标** u 里算：A 用 `u = x − xe`，B 用 `u = xe − x`，双方 forward = +u。
  IEEE-754 取负精确、加法可交换，所以 `(−xe) − (−x) == x − xe` 逐位成立 ——
  镜像输入下 u 空间里每个中间量都逐位相同。
- 输出 AST 唯一与队别有关的是 u 子表达式：A 写 `sub(x, xe)`，B 写 `sub(xe, x)`；其余常数全部来自 u 空间。
  Judge 侧 `evaluate(sub(xe', x'), −x) = (−xe) − (−x) = x − xe`，与 A 逐位一致。
- 策略确定性、无随机、无时间依赖：敌人按 (u, |y − ye|, id) 排序，对前 4 个目标尝试固定网格 K 的抛物线
  `y = ye + m·u + K·u²`（m 由过目标解出），u 空间 64 点采样避障（与 Judge 的 penetration 语义一致，留 0.05 余量）；
  全部失败退到直线，无敌人退到水平线。沙箱内实测 18–20 ms（`validate-submission` PRE-FLIGHT PASS 双队）。

于是 Level 6 里两场之间任何差异都只能来自平台，而不是 solver。

## 3. 已确认并修复的平台缺陷：Validator 采样网格锚点

`validateAttackFunction` 的四条采样循环（有限性、跳变窗口、斜率、凸性）原本都从 `domain[0]` 起步。
A 的 `domain[0]` 是 Emitter，B 的却是场地边 −20（`Rules.firingDomain`），所以同一个镜像函数在两边
被采到**两组不同的 x**。阈值附近会翻转：

- 最小复现：`f = 1.5 + sin(8.3074·(x + 18.008) − 0.0166) − sin(−0.0166)`，Emitter (−18.008, 1.5)。
  A：凸性变号 101 → `CONVEXITY_LIMIT`（非法）；镜像给 B：变号 100 → 合法。
- 修复：网格从 Emitter 出发沿进攻方向推进（`min(sx + i·h, 20)` ↔ `max(−sx − i·h, −20)`，精确镜像），
  凸性计数的二阶差分改为 `((fp + fm) − 2·f0)` 以保证镜像网格上逐位相同。
- 对 A 队的影响：采样点与修复前完全一致；独立复核在 6000 个刻意贴阈值的函数上比对新旧代码，
  A 侧的结论 / 错误码 / 凸性计数 / max|f| / max|f'| 全部相同，**只有**信息性度量 `maxAbsCurvature`
  因二阶差分换了加法顺序而在最后一位 ulp 上不同（2324/6000）。该度量不参与任何判定。
- 对 B 队的影响：**这是修复的本意** —— B 现在被采到与 A 互为镜像的 x 集合。贴阈值的函数结论可能改变
  （同一组 6000 个合成边界函数里 1065 个 B 侧结论或错误码变化；8 族 2400 个随机函数里 0 个）。
  参赛者文档应写明网格规则：「校验网格从本队 Emitter 出发、沿进攻方向以步长 h 推进到场地边界；
  两队的采样点互为镜像」（`competitor-kit/DSL_SPECIFICATION.md` 校验表一节，待补）。
- 回归：`tests/mirror-fairness.ts` 的「L2: 定向探针」，198 个探针、5 个家族，除结论与错误码外还要求
  `convexityChanges / maxAbsValue / maxAbsSlope / maxAbsCurvature` 四个判定度量逐位相同
  （只比结论会漏掉「两边都合法但计数不同」这种阈值一挪就翻转的前兆）：

  | 家族 | 构造 | 旧代码分歧 / 探针数 |
  |---|---|---|
  | convexity-straddle | 恰好 101 个拐点，第一个落在 Emitter 后不到一个 h | 24/24（10 处合法/非法翻转） |
  | tan-pole | tan 极点落在远端边界外 1e-7…3e-6 | 24/24（错误码 DISCONTINUOUS vs NOT_FINITE/NOT_C2） |
  | div-pole | 1/(x−c) 极点落在远端边界外 1e-7…4e-5 | 24/24（含 xe=−13.37, eps=5e-6：A 合法、B NOT_C2） |
  | gaussian-spike | 峰值 1000×1000.0005 ≈ 1.0000005e6 的窄高斯，宽 0.0012…0.004 | 54/54（仅 max|f| 等度量不同） |
  | curvature-floor | 直线 + 幅值 2.9e-4…4.4e-4 的 sin，|f''| 压在曲率噪声地板上 | 72/72（仅度量不同；直接检验 `(fp+fm)−2·f0` 的可交换性） |

  旧代码（HEAD febf1c6 的 Validator）上该用例与「L2: 随机 AST 家族」一起变红（8/10）；修复后 10/10，
  2400 + 198 个函数零分歧。

## 4. 实验脚本（A4 —— 待补）

计划中的脚本（放在本目录，输出到 `results/`）：

- `self-play-campaign.ts`：同包自战（symmetry-probe / 官方 starter / 另一强 solver），配对镜像 seed，
  两种槽位分配各跑一遍，记录 A wins / B wins / draws、firstSolver 分布、每回合双方耗时；
  统计用配对检验（同一 seed 的原/镜两场是一对）。
- `map-distribution.ts`：数千 seed 上按 §5 的成对统计检验地图分布的左右对称性
  （障碍物质心 x 符号、区域内障碍物面积、每队到最近障碍物的间距、直线可达敌人数）。

跑任何重实验前后都记录 `uptime`：500 ms 预算下机器负载会造成 TIMEOUT 假红。
