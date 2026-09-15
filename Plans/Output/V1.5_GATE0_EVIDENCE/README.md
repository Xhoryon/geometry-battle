# V1.5 Gate 0 验证证据（内部）

本目录是 Gate 0 的脱敏审计证据，不是正式参赛包、安全攻击工具集或 V1.5 实现。不得自动公开 agent 原始 transcript；本目录未包含它们。主报告见[内部交接](../V1.5_GATE0_AUDIT_REPORT.md)。

## 文件

- [baseline-summary.json](baseline-summary.json)：固定公开基线、105 文件一致性与依赖使用边界。
- [test-results.json](test-results.json)、[geometry-test-results.json](geometry-test-results.json)：命令、退出码、耗时。
- [test-counts.json](test-counts.json)：18 套件 / 167 用例统计。
- [gate0-targeted.log](gate0-targeted.log)、[geometry-targeted.log](geometry-targeted.log)：完整定向测试输出。
- [typecheck.log](typecheck.log)、[typecheck-web.log](typecheck-web.log)：类型检查。
- [boundary-probes.json](boundary-probes.json)：几何、线程、platform、计时观察。
- [session-probes.json](session-probes.json)：部分筹备、赛前投影、交互 CLI 观察。
- [upload-boundary.json](upload-boundary.json)：仅针对自建合成标记的 raw-upload 读取结果。
- 三个 `.cjs`：对应无害探针。归档时只将基线定位改为显式环境变量，不修改被审生产代码。

## 可复跑性与安全边界

仅在隔离的 **公开 v1.4.3 / commit f6b2a4677e67b8797c6e52a9947b5ddeecab9be3** 副本中执行，使用 macOS 和该版本依赖。显式指定 `GB_AUDIT_BASELINE`，不要设为活跃赛事工作区。

```bash
GB_AUDIT_BASELINE=/path/to/disposable-baseline \
TS_NODE_PROJECT=/path/to/disposable-baseline/tsconfig.json \
node -r /path/to/disposable-baseline/node_modules/ts-node/register \
/path/to/V1.5_GATE0_EVIDENCE/boundary-probes.cjs
```

其他两个文件同样执行。**要先把整个 evidence 目录复制到临时位置**，探针会在脚本同目录输出结果，避免覆盖这里的历史观察。其内部会创建/删除自己拥有的临时槽位、沙箱及合成包。

- `boundary-probes.cjs`：纯数学场景、一个短生命线程、短睡眠，`Atomics.wait` 只暂停本探针进程，不向其他服务施压。
- `session-probes.cjs`：使用仓库已知良性 fixture、独立槽位/产物，运行非自动 judge 的 `v/s/q`，不操作现有比赛。
- `upload-boundary.cjs`：只捕获本次 `mkdtempSync` 创建的上传路径，只读本次合成标记；不枚举历史上传，不读取真实队伍数据，之后清理自己创建的上传副本。

三个 harness 是观察脚本，不是 assert「已修复」的正式回归。脚本退出码 0 表示完成观察，**不代表被审安全属性通过**。例如 `teamAInstallationPreflightCanReadSyntheticB=true` 恰是被审隔离缺陷。

本轮结果只适用于日志所述环境与测试条件；精确耗时会随宿主改变。无完整 E2E/新机器/RC 认证。
