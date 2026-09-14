<div align="right"><a href="./BILINGUAL_DOCUMENTATION.md">English</a> | <strong>简体中文</strong></div>

# 双语文档索引

**几何斗殴 V1.4.2** — 可切换语言的完整双语文档覆盖。

---

## 概述

本仓库中所有面向公众的文档均提供**中文（zh-CN）**与**英文（en-US）**双语版本，采用语言配对文件模式（`.md` + `.zh-CN.md`）。

### 语言配对格式

每个文档主题有两个文件：
- **英文版本**：`filename.md`（如 `README.md`）
- **中文版本**：`filename.zh-CN.md`（如 `README.zh-CN.md`）
- 两个文件顶部都包含**语言导航**链接
- 每种语言内的交叉引用保持在该语言
- 两个版本均保持技术准确性和完整性

---

## 核心文档

| 英文 | 中文 | 描述 |
|------|------|------|
| [README.md](../README.md) | [README.zh-CN.md](../README.zh-CN.md) | 仓库主介绍、快速开始、规则、锦标赛工作流 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | [ARCHITECTURE.zh-CN.md](ARCHITECTURE.zh-CN.md) | 系统架构、设计约束、引擎解析顺序 |
| [V1.4_FAIRNESS_REPORT.md](V1.4_FAIRNESS_REPORT.md) | [V1.4_FAIRNESS_REPORT.zh-CN.md](V1.4_FAIRNESS_REPORT.zh-CN.md) | 平台公平性验证、镜像对称测试 |
| [RELEASE_NOTES.md](RELEASE_NOTES.md) | [RELEASE_NOTES.zh-CN.md](RELEASE_NOTES.zh-CN.md) | V1.4、V1.3、V1.2 发行历史 |
| [REPRODUCIBILITY.md](REPRODUCIBILITY.md) | [REPRODUCIBILITY.zh-CN.md](REPRODUCIBILITY.zh-CN.md) | 可重现性指南与验证 |
| [BILINGUAL_DOCUMENTATION.md](BILINGUAL_DOCUMENTATION.md) | [BILINGUAL_DOCUMENTATION.zh-CN.md](BILINGUAL_DOCUMENTATION.zh-CN.md) | 本文件：文档索引 |

---

## 参赛者文档

| 英文 | 中文 | 描述 |
|------|------|------|
| [competitor-kit/README.md](../competitor-kit/README.md) | [competitor-kit/README.zh-CN.md](../competitor-kit/README.zh-CN.md) | 参赛工具包概述 |
| [competitor-kit/ALGORITHM_REQUIREMENTS.md](../competitor-kit/ALGORITHM_REQUIREMENTS.md) | [competitor-kit/ALGORITHM_REQUIREMENTS.zh-CN.md](../competitor-kit/ALGORITHM_REQUIREMENTS.zh-CN.md) | 完整算法要求（§0–§18） |
| [competitor-kit/DSL_SPECIFICATION.md](../competitor-kit/DSL_SPECIFICATION.md) | [competitor-kit/DSL_SPECIFICATION.zh-CN.md](../competitor-kit/DSL_SPECIFICATION.zh-CN.md) | DSL 规范、合法/非法示例 |
| [competitor-kit/JSON_SCHEMA.md](../competitor-kit/JSON_SCHEMA.md) | [competitor-kit/JSON_SCHEMA.zh-CN.md](../competitor-kit/JSON_SCHEMA.zh-CN.md) | JSON 字段结构 |
| [competitor-kit/RUNTIME_MANIFEST.md](../competitor-kit/RUNTIME_MANIFEST.md) | [competitor-kit/RUNTIME_MANIFEST.zh-CN.md](../competitor-kit/RUNTIME_MANIFEST.zh-CN.md) | 运行时清单 |
| [algorithms/README.md](../algorithms/README.md) | [algorithms/README.zh-CN.md](../algorithms/README.zh-CN.md) | 算法提交结构 |

---

## 演示与参考

| 英文 | 中文 | 描述 |
|------|------|------|
| [demo/reference-solver-v2/README.md](../demo/reference-solver-v2/README.md) | [demo/reference-solver-v2/README.zh-CN.md](../demo/reference-solver-v2/README.zh-CN.md) | 参考求解器设计、限制、可重现性 |

---

## Playtest 文档

### 参赛算法

| 英文 | 中文 | 描述 |
|------|------|------|
| [playtest/competitors/solver-fast/README.md](../playtest/competitors/solver-fast/README.md) | [playtest/competitors/solver-fast/README.zh-CN.md](../playtest/competitors/solver-fast/README.zh-CN.md) | 快速战术求解器 |
| [playtest/competitors/solver-optimizer/README.md](../playtest/competitors/solver-optimizer/README.md) | [playtest/competitors/solver-optimizer/README.zh-CN.md](../playtest/competitors/solver-optimizer/README.zh-CN.md) | 时间预算搜索求解器 |
| [playtest/competitors/solver-hybrid/README.md](../playtest/competitors/solver-hybrid/README.md) | [playtest/competitors/solver-hybrid/README.zh-CN.md](../playtest/competitors/solver-hybrid/README.zh-CN.md) | Anytime 优化求解器 |

### Playtest 结果

| 英文 | 中文 | 描述 |
|------|------|------|
| [playtest/results/DUAL_ALGORITHM_PLAYTEST_REPORT.md](../playtest/results/DUAL_ALGORITHM_PLAYTEST_REPORT.md) | [playtest/results/DUAL_ALGORITHM_PLAYTEST_REPORT.zh-CN.md](../playtest/results/DUAL_ALGORITHM_PLAYTEST_REPORT.zh-CN.md) | 双算法 playtest |
| [playtest/results/round-2/ROUND_2_BALANCE_PLAYTEST_REPORT.md](../playtest/results/round-2/ROUND_2_BALANCE_PLAYTEST_REPORT.md) | [playtest/results/round-2/ROUND_2_BALANCE_PLAYTEST_REPORT.zh-CN.md](../playtest/results/round-2/ROUND_2_BALANCE_PLAYTEST_REPORT.zh-CN.md) | Round 2 平衡分析 |
| [playtest/results/shooter-rule-revision/SHOOTER_RULE_REBALANCE_REPORT.md](../playtest/results/shooter-rule-revision/SHOOTER_RULE_REBALANCE_REPORT.md) | [playtest/results/shooter-rule-revision/SHOOTER_RULE_REBALANCE_REPORT.zh-CN.md](../playtest/results/shooter-rule-revision/SHOOTER_RULE_REBALANCE_REPORT.zh-CN.md) | 射手规则重平衡 |

---

## 统计

**文档配对总数：19**

- 核心文档：6 对
- 参赛者文档：6 对
- 演示与参考：1 对
- Playtest 文档：6 对

---

## 验证

所有语言配对文档均通过以下自动回归测试验证：

```
tests/bilingual-docs.spec.ts
```

测试套件验证：
- 每个文档主题的 `.md` 和 `.zh-CN.md` 文件均存在
- 两个版本中都存在语言导航链接
- 中文文档内的交叉引用指向中文版本
- 无遗留的双语标记

---

## 贡献

添加新的面向公众的文档时：

1. **创建两个语言文件**：`filename.md`（英文）和 `filename.zh-CN.md`（中文）
2. **在两个文件顶部添加语言导航**
3. **用两种语言编写完整内容**，保持技术准确性
4. **更新交叉引用**：英文文档链接到 `.md`，中文文档链接到 `.zh-CN.md`
5. **更新此索引**，加入新文件对
6. **添加测试覆盖**到 `tests/bilingual-docs.spec.ts`

---

## 许可

本文档是几何斗殴的一部分，受 **PolyForm Noncommercial License 1.0.0** 约束。

详见 [LICENSE](../LICENSE)。
