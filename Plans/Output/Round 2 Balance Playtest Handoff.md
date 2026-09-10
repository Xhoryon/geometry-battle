# Round 2 Algorithm Balance Playtest Handoff

**任务**：Geometry Battle V1.1 第二轮 Algorithm Balance Playtest
**角色**：ROUND 2 BALANCE PLAYTEST AGENT
**日期**：2026-09-10
**分支**：`feature/v1.1-ui-protocol`

| 项 | 值 |
|---|---|
| 前置 baseline 冻结提交 | `8f7dc110`（规则基线）→ `6f987bfb`（Round-1 证据）→ `d9f470c5`（槽位同步）→ `10b63a24`（复现器） |
| Round 2 代码与结果 | `f9b83a37`（算法 + harness + 180 场证据） |
| Round 2 修订 | `fac48070`（对抗式复核后的更正） |
| `v1.0.0-competition` | `26d7970`（**未触碰**） |

**完整报告**：`playtest/results/round-2/ROUND_2_BALANCE_PLAYTEST_REPORT.md`

---

## 1. 本轮做了什么

| 阶段 | 产物 |
|---|---|
| §0–4 规则基线与源材料 | 规则文件单独入库；Arena boundary 一致性确认（§16） |
| §5–9 第三套算法 | `playtest/competitors/solver-hybrid/` — Hybrid Tactical-First Anytime Optimizer |
| §10 验证 | Local Validator + Official Preflight **PASS**；离线矩阵 3 包 × 600 次 **0 异常** |
| §11–14 正式规则实验 | 3 pair × 30 条件 × 槽位互换 = **180 场**，0 INVALID / 0 TIMEOUT / 0 CRASH |
| §16–18 反事实 | `gb_counterfactual.py`：OFFICIAL MODE 门禁通过；CF 模拟 360 场 |
| §19–22 分析 | 取消代价 / 速度效应 / no-progress / match length |
| §23 平台异常 | 8 场污染识别 → 隔离 → 重跑，**0 结果变化** |
| §25–29 判定与报告 | `CANCELLATION-DOMINATED`；A–E 逐条回答 |

---

## 2. 核心结论（供规则评审）

| | 官方规则 | CF-NO-CANCEL | CF-SIMULTANEOUS |
|---|---|---|---|
| Fast vs Optimizer | Fast **50** / Opt **0** / Draw 10 | Opt **38** / Fast **2** / Draw 20 | 与 NO-CANCEL 逐回合相同 |
| Hybrid vs Optimizer | Hybrid **39** / Opt **4** / Draw 17 | Opt **37** / Hybrid **3** / Draw 20 | 同上 |
| Fast vs Hybrid | Fast **26** / Hybrid **8** / Draw **26** | Fast **13** / Hybrid **10** / Draw 37 | 同上 |

**结构性结论（规范 §40/§41 的直接推论，非实验发现）**：
冻结回合快照使先手顺序**无作用通道**，因此速度影响胜负的**唯一**途径就是 §38 Shot Cancellation。

**取消的代价（回合级归因，官方世界上重解）**：

| pair | 被取消方 | 损失击杀 | 落在最终幸存点上 | 损失的反杀 Shooter |
|---|---|---|---|---|
| fast-vs-optimizer | optimizer | **787** | 667 (84.8%) | **253** |
| optimizer-vs-hybrid | optimizer | 663 | 514 (77.5%) | 213 |
| fast-vs-hybrid | hybrid | 316 | 160 (50.6%) | 164 |

---

## 3. 需要人类决策的三个开放项

### O-1 §38 Shot Cancellation 是否需要修改

- 数据支持「重新评估」：移除后两场对阵胜负反转，唯一同速对抗几乎不动。
- **本轮未修改任何规则**（§27）。候选方案见报告 §21 R1。
- 待决：是否采纳；若采纳，须补做完整回归（§59 Rule Change Procedure）。

### O-2 Stalemate 阈值

- **本轮无法给出阈值**，且已**撤回** rev 1 的 `20 / 30` 建议。
- 理由：观测分布被 30 轮测试上限右删失；53 个尾部观测全部等于「上限 − 最后击杀轮」；
  实测把上限提到 60 轮后三场**仍全部触顶**（吸收式不动点）。
- 待决：是否安排一次**无上限**（或上限 ≥1000）的测量实验。

### O-3 competitor-kit 文档补齐

- 场地边界终止条件未写入 kit，而它影响 Fast **55.3%** 的回合。
- `aBlocked` 字段谓词未公开，第三方无法复核该统计（本轮 106 / 298 处无法复现）。
- 平台未暴露 `start skew`，任务书 §24 无法被任何 harness 完整满足。

---

## 4. 本轮方法论说明（供后续轮次复用）

1. **反事实门禁**：`gb_counterfactual.py verify` 必须先通过，才允许统计。产物已持久化在
   `playtest/results/round-2/cf/verify-*.json`。
   门禁范围已在报告 §18.1 显式声明：反事实消费的全部字段 0 失配；
   `blocked` 字段**未达成字面一致**，该例外不被掩盖。
2. **对抗式复核**：报告在提交前经 5 名独立反驳者 + 1 名完整性评论员复核，推翻 3 项结论、
   指出 1 处引擎缺陷。全部修订记录在报告 §25，**保留推翻理由**。
3. **污染处理**：`platform-contaminated/` 保留原始证据；重跑后逐场比对，0 结果变化。
4. **诚实归因**：污染窗口与本轮作者自己执行的一次重负载检查重叠，已在报告 §15.1 如实记录。

---

## 5. 边界确认

- 未修改：`Plans/Input/Geometry Battle V1.1 — Competition Rules & Playtest Specification.md`、
  `competitor-kit/`、`src/`、production Judge、Sandbox core、timing 规则、DSL 规则、
  `algorithms/team-a`、`algorithms/team-b`、`solver-fast`、`solver-optimizer`。
- 未进入 UI 开发，未自动开展 Round 3。
- `v1.0.0-competition` → `26d7970`，**未改变**。

```
ROUND 2 ALGORITHM BALANCE PLAYTEST COMPLETE
READY FOR RULE REVIEW
```
