<div align="right">

**English** | <a href="./BILINGUAL_DOCUMENTATION.zh-CN.md">简体中文</a>

</div>

# Bilingual Documentation Index

**Geometry Battle V1.4.1** — Complete bilingual documentation coverage.

---

## Overview

All public-facing documentation in this repository is provided in both **Chinese (zh-CN)** and **English (en-US)**, using a consistent same-file bilingual format.

### Bilingual Format

Each bilingual document:
- Begins with the marker: `<!-- bilingual-doc: zh-CN + en-US -->`
- Presents content in **Chinese first, then English** for each section
- Maintains technical accuracy in both languages
- Preserves all code examples, tables, and technical terms

---

## Core Documentation

| File | Lines | Description |
|------|-------|-------------|
| [README.md](../README.md) | 1,286 | Main repository introduction, quick start, rules, tournament workflow |
| [docs/ARCHITECTURE.md](ARCHITECTURE.md) | 309 | System architecture, design constraints, engine resolution order |
| [docs/V1.4_FAIRNESS_REPORT.md](V1.4_FAIRNESS_REPORT.md) | 452 | Platform fairness validation, mirror-symmetry testing, methodology |
| [docs/RELEASE_NOTES.md](RELEASE_NOTES.md) | 394 | Release history for V1.4, V1.3, V1.2 |
| [docs/BILINGUAL_DOCUMENTATION.md](BILINGUAL_DOCUMENTATION.md) | 198 | This file: Bilingual documentation index |

---

## Competitor Documentation

| File | Lines | Description |
|------|-------|-------------|
| [competitor-kit/ALGORITHM_REQUIREMENTS.md](../competitor-kit/ALGORITHM_REQUIREMENTS.md) | 1,343 | Complete algorithm requirements (§0–§18), DSL specification, legality rules |
| [algorithms/README.md](../algorithms/README.md) | 205 | Algorithm submission structure, slots vs fixtures, upload pipeline |

---

## Demo & Reference

| File | Lines | Description |
|------|-------|-------------|
| [demo/reference-solver-v2/README.md](../demo/reference-solver-v2/README.md) | 378 | Reference solver design, candidate families, known limitations, reproducibility |

---

## Playtest Documentation

### Competitor Algorithms

| File | Lines | Description |
|------|-------|-------------|
| [playtest/competitors/solver-fast/README.md](../playtest/competitors/solver-fast/README.md) | 94 | Algorithm A: Fast tactical solver, closed-form candidates, early stopping |
| [playtest/competitors/solver-optimizer/README.md](../playtest/competitors/solver-optimizer/README.md) | 92 | Algorithm B: Time-budgeted search, exact interpolation, trigonometric families |
| [playtest/competitors/solver-hybrid/README.md](../playtest/competitors/solver-hybrid/README.md) | 167 | Algorithm C: Anytime optimizer, three-stage design, tactical-first strategy |

### Playtest Results

| File | Lines | Description |
|------|-------|-------------|
| [playtest/results/round-2/ROUND_2_BALANCE_PLAYTEST_REPORT.md](../playtest/results/round-2/ROUND_2_BALANCE_PLAYTEST_REPORT.md) | 1,249 | Comprehensive balance analysis, 180-match campaign, cancellation dominance findings |

---

## Statistics

**Total bilingual documentation: 4,887 lines**

- Core documentation: 2,639 lines
- Competitor documentation: 1,548 lines
- Demo & reference: 378 lines
- Playtest documentation: 1,602 lines

---

## Verification

All bilingual documents are verified by automated regression tests in:

```
tests/bilingual-docs.spec.ts
```

The test suite verifies:
- Presence of bilingual marker in each file
- File existence and accessibility
- Basic structure integrity

---

## Contributing

When adding new public-facing documentation:

1. **Add bilingual marker** at the top: `<!-- bilingual-doc: zh-CN + en-US -->`
2. **Write Chinese content first**, then add English translation
3. **Preserve technical accuracy** in both languages
4. **Update this index** with the new file
5. **Add test coverage** in `tests/bilingual-docs.spec.ts`

---

## License

This documentation is part of Geometry Battle and is subject to the **PolyForm Noncommercial License 1.0.0**.

See [LICENSE](../LICENSE) for details.
