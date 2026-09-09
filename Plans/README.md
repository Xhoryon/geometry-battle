# Plans/ — 目录说明

本目录按**来源**分为两个子目录：人输入的任务/规范文档，与 Agent 产出的报告/日志。

```text
Plans/
├── Input/     # 人输入的 Plan、规范与任务书（只读输入，不由 Agent 撰写）
│   ├── Plan V1.rtf                      # V1 规则规范（原始 RTF）
│   ├── Plan 2 — V1 Completion Plan.md   # 阶段计划
│   └── Gate Plan1.md                    # Plan 1 Gate 的审核任务书（只读审计要求）
└── Output/    # Agent 产出的报告、工作日志与交接文档
    ├── Plan 1 Gate Result.md            # Plan 1 Gate 审计报告（FAIL）
    ├── Plan 1 Gate 工作日志.md           # Plan 1 Gate 工作日志
    ├── Re-Gate Cycle 1 Result.md        # 第 1 轮独立再审计（FAIL）
    ├── Re-Gate Cycle 2 Result.md        # 第 2 轮独立再审计（FAIL）
    ├── Re-Gate Cycle 3 Result.md        # 第 3 轮独立再审计（CONDITIONAL PASS）
    └── V1 Remediation Handoff.md        # 开发/修复交接文档（含终局状态 §10）
```

## 当前结论

**V1 REMAINS NOT COMPETITION READY** —— 3 个 remediation/re-gate cycle 上限已用尽，
Cycle 3 判定 `CONDITIONAL PASS`（实现层全部通过，4 条纯文档失实为阻塞项）。
详见 [Output/V1 Remediation Handoff.md](Output/V1%20Remediation%20Handoff.md) §10
与 [Output/Re-Gate Cycle 3 Result.md](Output/Re-Gate%20Cycle%203%20Result.md)。

## 重组说明（2026-09-09）

原先所有文件平铺在 `Plans/` 下，现按来源分为 `Input/` 与 `Output/`。
移动本身由 `git mv` 完成（`60f920e`，9 个文件纯重命名、**字节零变化**）；
紧随其后的提交（`5be48d3`）更新了路径引用、新增本文件、展开根 `README.md` 的项目结构树，
并改写了 `Output/V1 Remediation Handoff.md` 的 §9 冻结基线（`text` 键值块）、新增其 §10.5（重组说明）。

旧路径 → 新路径映射：

| 旧路径 | 新路径 |
|---|---|
| `Plans/Plan V1.rtf` | `Plans/Input/Plan V1.rtf` |
| `Plans/Plan 2 — V1 Completion Plan.md` | `Plans/Input/Plan 2 — V1 Completion Plan.md` |
| `Plans/Gate Plan1.md` | `Plans/Input/Gate Plan1.md` |
| `Plans/Plan 1 Gate Result.md` | `Plans/Output/Plan 1 Gate Result.md` |
| `Plans/Plan 1 Gate 工作日志.md` | `Plans/Output/Plan 1 Gate 工作日志.md` |
| `Plans/Re-Gate Cycle 1 Result.md` | `Plans/Output/Re-Gate Cycle 1 Result.md` |
| `Plans/Re-Gate Cycle 2 Result.md` | `Plans/Output/Re-Gate Cycle 2 Result.md` |
| `Plans/Re-Gate Cycle 3 Result.md` | `Plans/Output/Re-Gate Cycle 3 Result.md` |
| `Plans/V1 Remediation Handoff.md` | `Plans/Output/V1 Remediation Handoff.md` |

注意事项：

- 历史审计报告（`Output/Re-Gate Cycle * Result.md`、`Output/Plan 1 Gate Result.md`）
  中的**终端输出转录块保持原样**（记录的是当时的真实输出），其中的旧路径不作改写；
  正文中的路径引用已更新为新位置。
- 由于报告与工作日志**全部**位于 `Output/`，它们之间的相对 Markdown 链接
  （指向同目录的 `Re-Gate%20Cycle%202%20Result.md` 这类）在移动后**依然有效**，无需改写。
- 指向仓库其他目录的相对链接（如 `../../tests/*.ts`）已随层级加深同步修正。
- 根 `README.md` 的项目结构树由 1 行扩为 3 行，使其后行号 +2；文档中指向 README
  行号的交叉引用（原文「第 198 行」）已同步改为「第 200 行」（「第 130 行」未移位）。
- 仓库内**没有任何代码、测试或构建配置**引用 `Plans/` 下的文件
  （`grep` 全仓确认：仅 `README.md` 的项目结构树与 `Plans/` 内文档互相引用）。
