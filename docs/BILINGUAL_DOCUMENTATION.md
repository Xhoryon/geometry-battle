<!-- bilingual-doc: zh-CN + en-US -->

# Bilingual Documentation Index / 双语文档索引

**Geometry Battle V1.4.1** — Complete bilingual documentation coverage.

**几何斗殴 V1.4.1** — 完整双语文档覆盖。

---

## Overview / 概述

All public-facing documentation in this repository is provided in both **Chinese (zh-CN)** and **English (en-US)**, using a consistent same-file bilingual format.

本仓库中所有面向公众的文档均提供**中文（zh-CN）**与**英文（en-US）**双语版本，采用统一的同文件双语格式。

### Bilingual Format / 双语格式

Each bilingual document:
- Begins with the marker: `<!-- bilingual-doc: zh-CN + en-US -->`
- Presents content in **Chinese first, then English** for each section
- Maintains technical accuracy in both languages
- Preserves all code examples, tables, and technical terms

每个双语文档：
- 以标记开头：`<!-- bilingual-doc: zh-CN + en-US -->`
- 每个章节**先中文、后英文**呈现内容
- 两种语言均保持技术准确性
- 保留所有代码示例、表格和技术术语

---

## Core Documentation / 核心文档

| File | Lines | Description |
|------|-------|-------------|
| [README.md](../README.md) | 1,286 | Main repository introduction, quick start, rules, tournament workflow |
| [docs/ARCHITECTURE.md](ARCHITECTURE.md) | 309 | System architecture, design constraints, engine resolution order |
| [docs/V1.4_FAIRNESS_REPORT.md](V1.4_FAIRNESS_REPORT.md) | 452 | Platform fairness validation, mirror-symmetry testing, methodology |
| [docs/RELEASE_NOTES.md](RELEASE_NOTES.md) | 394 | Release history for V1.4, V1.3, V1.2 |
| [docs/BILINGUAL_DOCUMENTATION.md](BILINGUAL_DOCUMENTATION.md) | 198 | This file: Bilingual documentation index |

| 文件 | 行数 | 描述 |
|------|------|------|
| [README.md](../README.md) | 1,286 | 仓库主介绍、快速开始、规则、锦标赛工作流 |
| [docs/ARCHITECTURE.md](ARCHITECTURE.md) | 309 | 系统架构、设计约束、引擎解析顺序 |
| [docs/V1.4_FAIRNESS_REPORT.md](V1.4_FAIRNESS_REPORT.md) | 452 | 平台公平性验证、镜像对称测试、方法论 |
| [docs/RELEASE_NOTES.md](RELEASE_NOTES.md) | 394 | V1.4、V1.3、V1.2 发行历史 |
| [docs/BILINGUAL_DOCUMENTATION.md](BILINGUAL_DOCUMENTATION.md) | 198 | 本文件：双语文档索引 |

---

## Competitor Documentation / 参赛者文档

| File | Lines | Description |
|------|-------|-------------|
| [competitor-kit/ALGORITHM_REQUIREMENTS.md](../competitor-kit/ALGORITHM_REQUIREMENTS.md) | 1,343 | Complete algorithm requirements (§0–§18), DSL specification, legality rules |
| [algorithms/README.md](../algorithms/README.md) | 205 | Algorithm submission structure, slots vs fixtures, upload pipeline |

| 文件 | 行数 | 描述 |
|------|------|------|
| [competitor-kit/ALGORITHM_REQUIREMENTS.md](../competitor-kit/ALGORITHM_REQUIREMENTS.md) | 1,343 | 完整算法要求（§0–§18）、DSL 规范、合法性规则 |
| [algorithms/README.md](../algorithms/README.md) | 205 | 算法提交结构、槽位与固件、上传管道 |

---

## Demo & Reference / 演示与参考

| File | Lines | Description |
|------|-------|-------------|
| [demo/reference-solver-v2/README.md](../demo/reference-solver-v2/README.md) | 378 | Reference solver design, candidate families, known limitations, reproducibility |

| 文件 | 行数 | 描述 |
|------|------|------|
| [demo/reference-solver-v2/README.md](../demo/reference-solver-v2/README.md) | 378 | 参考求解器设计、候选族、已知限制、可重现性 |

---

## Playtest Documentation / Playtest 文档

### Competitor Algorithms / 参赛算法

| File | Lines | Description |
|------|-------|-------------|
| [playtest/competitors/solver-fast/README.md](../playtest/competitors/solver-fast/README.md) | 94 | Algorithm A: Fast tactical solver, closed-form candidates, early stopping |
| [playtest/competitors/solver-optimizer/README.md](../playtest/competitors/solver-optimizer/README.md) | 92 | Algorithm B: Time-budgeted search, exact interpolation, trigonometric families |
| [playtest/competitors/solver-hybrid/README.md](../playtest/competitors/solver-hybrid/README.md) | 167 | Algorithm C: Anytime optimizer, three-stage design, tactical-first strategy |

| 文件 | 行数 | 描述 |
|------|------|------|
| [playtest/competitors/solver-fast/README.md](../playtest/competitors/solver-fast/README.md) | 94 | 算法 A：快速战术求解器、封闭形式候选、早停策略 |
| [playtest/competitors/solver-optimizer/README.md](../playtest/competitors/solver-optimizer/README.md) | 92 | 算法 B：时间预算搜索、精确插值、三角族 |
| [playtest/competitors/solver-hybrid/README.md](../playtest/competitors/solver-hybrid/README.md) | 167 | 算法 C：Anytime 优化器、三阶段设计、战术优先策略 |

### Playtest Results / Playtest 结果

| File | Lines | Description |
|------|-------|-------------|
| [playtest/results/round-2/ROUND_2_BALANCE_PLAYTEST_REPORT.md](../playtest/results/round-2/ROUND_2_BALANCE_PLAYTEST_REPORT.md) | 1,249 | Comprehensive balance analysis, 180-match campaign, cancellation dominance findings |

| 文件 | 行数 | 描述 |
|------|------|------|
| [playtest/results/round-2/ROUND_2_BALANCE_PLAYTEST_REPORT.md](../playtest/results/round-2/ROUND_2_BALANCE_PLAYTEST_REPORT.md) | 1,249 | 全面平衡分析、180 场比赛战役、取消机制主导性结论 |

---

## Statistics / 统计

**Total bilingual documentation: 4,887 lines**

**双语文档总计：4,887 行**

- Core documentation: 2,639 lines / 核心文档：2,639 行
- Competitor documentation: 1,548 lines / 参赛者文档：1,548 行
- Demo & reference: 378 lines / 演示与参考：378 行
- Playtest documentation: 1,602 lines / Playtest 文档：1,602 行

---

## Verification / 验证

All bilingual documents are verified by automated regression tests in:

所有双语文档均通过以下自动回归测试验证：

```
tests/bilingual-docs.spec.ts
```

The test suite verifies:
- Presence of bilingual marker in each file
- File existence and accessibility
- Basic structure integrity

测试套件验证：
- 每个文件中双语标记的存在
- 文件存在性和可访问性
- 基本结构完整性

---

## Contributing / 贡献

When adding new public-facing documentation:

添加新的面向公众的文档时：

1. **Add bilingual marker** at the top: `<!-- bilingual-doc: zh-CN + en-US -->`
2. **Write Chinese content first**, then add English translation
3. **Preserve technical accuracy** in both languages
4. **Update this index** with the new file
5. **Add test coverage** in `tests/bilingual-docs.spec.ts`

1. **在顶部添加双语标记**：`<!-- bilingual-doc: zh-CN + en-US -->`
2. **先写中文内容**，再添加英文翻译
3. **保持技术准确性**（两种语言）
4. **更新此索引**，加入新文件
5. **添加测试覆盖**到 `tests/bilingual-docs.spec.ts`

---

## License / 许可

This documentation is part of Geometry Battle and is subject to the **PolyForm Noncommercial License 1.0.0**.

本文档是几何斗殴的一部分，受 **PolyForm Noncommercial License 1.0.0** 约束。

See [LICENSE](../LICENSE) for details.

详见 [LICENSE](../LICENSE)。
