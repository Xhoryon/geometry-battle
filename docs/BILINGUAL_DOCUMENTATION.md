<div align="right"><strong>English</strong> | <a href="./BILINGUAL_DOCUMENTATION.zh-CN.md">简体中文</a></div>

# Bilingual Documentation Index

**Geometry Battle V1.4.3** — Complete bilingual documentation coverage with language switching.

---

## Overview

All public-facing documentation in this repository is provided in both **Chinese (zh-CN)** and **English (en-US)**, using a language-paired file pattern (`.md` + `.zh-CN.md`).

### Language Pairing Format

Each documentation topic has two files:
- **English version**: `filename.md` (e.g., `README.md`)
- **Chinese version**: `filename.zh-CN.md` (e.g., `README.zh-CN.md`)
- Both files include **language navigation** links at the top
- Cross-references within each language stay within that language
- Both versions maintain technical accuracy and completeness

---

## Core Documentation

| English | Chinese | Description |
|---------|---------|-------------|
| [README.md](../README.md) | [README.zh-CN.md](../README.zh-CN.md) | Main repository introduction, quick start, rules, tournament workflow |
| [ARCHITECTURE.md](ARCHITECTURE.md) | [ARCHITECTURE.zh-CN.md](ARCHITECTURE.zh-CN.md) | System architecture, design constraints, engine resolution order |
| [V1.4_FAIRNESS_REPORT.md](V1.4_FAIRNESS_REPORT.md) | [V1.4_FAIRNESS_REPORT.zh-CN.md](V1.4_FAIRNESS_REPORT.zh-CN.md) | Platform fairness validation, mirror-symmetry testing |
| [RELEASE_NOTES.md](RELEASE_NOTES.md) | [RELEASE_NOTES.zh-CN.md](RELEASE_NOTES.zh-CN.md) | V1.4, V1.3, V1.2 release history |
| [REPRODUCIBILITY.md](REPRODUCIBILITY.md) | [REPRODUCIBILITY.zh-CN.md](REPRODUCIBILITY.zh-CN.md) | Reproducibility guide and verification |
| [BILINGUAL_DOCUMENTATION.md](BILINGUAL_DOCUMENTATION.md) | [BILINGUAL_DOCUMENTATION.zh-CN.md](BILINGUAL_DOCUMENTATION.zh-CN.md) | This file: documentation index |

---

## Competitor Documentation

| English | Chinese | Description |
|---------|---------|-------------|
| [competitor-kit/README.md](../competitor-kit/README.md) | [competitor-kit/README.zh-CN.md](../competitor-kit/README.zh-CN.md) | Competitor kit overview |
| [competitor-kit/ALGORITHM_REQUIREMENTS.md](../competitor-kit/ALGORITHM_REQUIREMENTS.md) | [competitor-kit/ALGORITHM_REQUIREMENTS.zh-CN.md](../competitor-kit/ALGORITHM_REQUIREMENTS.zh-CN.md) | Complete algorithm requirements (§0–§18) |
| [competitor-kit/DSL_SPECIFICATION.md](../competitor-kit/DSL_SPECIFICATION.md) | [competitor-kit/DSL_SPECIFICATION.zh-CN.md](../competitor-kit/DSL_SPECIFICATION.zh-CN.md) | DSL specification, legal/illegal examples |
| [competitor-kit/JSON_SCHEMA.md](../competitor-kit/JSON_SCHEMA.md) | [competitor-kit/JSON_SCHEMA.zh-CN.md](../competitor-kit/JSON_SCHEMA.zh-CN.md) | JSON field structure |
| [competitor-kit/RUNTIME_MANIFEST.md](../competitor-kit/RUNTIME_MANIFEST.md) | [competitor-kit/RUNTIME_MANIFEST.zh-CN.md](../competitor-kit/RUNTIME_MANIFEST.zh-CN.md) | Runtime manifest |
| [algorithms/README.md](../algorithms/README.md) | [algorithms/README.zh-CN.md](../algorithms/README.zh-CN.md) | Algorithm submission structure |

---

## Demo & Reference

| English | Chinese | Description |
|---------|---------|-------------|
| [demo/reference-solver-v2/README.md](../demo/reference-solver-v2/README.md) | [demo/reference-solver-v2/README.zh-CN.md](../demo/reference-solver-v2/README.zh-CN.md) | Reference solver design, limitations, reproducibility |

---

## Playtest Documentation

### Competitor Algorithms

| English | Chinese | Description |
|---------|---------|-------------|
| [playtest/competitors/solver-fast/README.md](../playtest/competitors/solver-fast/README.md) | [playtest/competitors/solver-fast/README.zh-CN.md](../playtest/competitors/solver-fast/README.zh-CN.md) | Fast tactical solver |
| [playtest/competitors/solver-optimizer/README.md](../playtest/competitors/solver-optimizer/README.md) | [playtest/competitors/solver-optimizer/README.zh-CN.md](../playtest/competitors/solver-optimizer/README.zh-CN.md) | Time-budgeted search solver |
| [playtest/competitors/solver-hybrid/README.md](../playtest/competitors/solver-hybrid/README.md) | [playtest/competitors/solver-hybrid/README.zh-CN.md](../playtest/competitors/solver-hybrid/README.zh-CN.md) | Anytime optimizer solver |

### Playtest Results

| English | Chinese | Description |
|---------|---------|-------------|
| [playtest/results/DUAL_ALGORITHM_PLAYTEST_REPORT.md](../playtest/results/DUAL_ALGORITHM_PLAYTEST_REPORT.md) | [playtest/results/DUAL_ALGORITHM_PLAYTEST_REPORT.zh-CN.md](../playtest/results/DUAL_ALGORITHM_PLAYTEST_REPORT.zh-CN.md) | Dual algorithm playtest |
| [playtest/results/round-2/ROUND_2_BALANCE_PLAYTEST_REPORT.md](../playtest/results/round-2/ROUND_2_BALANCE_PLAYTEST_REPORT.md) | [playtest/results/round-2/ROUND_2_BALANCE_PLAYTEST_REPORT.zh-CN.md](../playtest/results/round-2/ROUND_2_BALANCE_PLAYTEST_REPORT.zh-CN.md) | Round 2 balance analysis |
| [playtest/results/shooter-rule-revision/SHOOTER_RULE_REBALANCE_REPORT.md](../playtest/results/shooter-rule-revision/SHOOTER_RULE_REBALANCE_REPORT.md) | [playtest/results/shooter-rule-revision/SHOOTER_RULE_REBALANCE_REPORT.zh-CN.md](../playtest/results/shooter-rule-revision/SHOOTER_RULE_REBALANCE_REPORT.zh-CN.md) | Shooter rule rebalance |

---

## Statistics

**Total document pairs: 19**

- Core documentation: 6 pairs
- Competitor documentation: 6 pairs
- Demo & reference: 1 pair
- Playtest documentation: 6 pairs

---

## Verification

All language-paired documents are verified by automated regression tests:

```
tests/bilingual-docs.spec.ts
```

The test suite verifies:
- Both `.md` and `.zh-CN.md` files exist for each documentation topic
- Language navigation links are present in both versions
- Cross-references within Chinese documents point to Chinese versions
- No legacy bilingual markers remain

---

## Contributing

When adding new public-facing documentation:

1. **Create two language files**: `filename.md` (English) and `filename.zh-CN.md` (Chinese)
2. **Add language navigation** at the top of both files
3. **Write complete content in both languages**, maintaining technical accuracy
4. **Update cross-references**: English documents link to `.md`, Chinese documents link to `.zh-CN.md`
5. **Update this index** with the new file pair
6. **Add test coverage** to `tests/bilingual-docs.spec.ts`

---

## License

This documentation is part of Geometry Battle and is subject to the **PolyForm Noncommercial License 1.0.0**.

See [LICENSE](../LICENSE) for details.
