# DEVELOPMENT_RULES —— 怎么在这个仓库里干活

> 这些规矩是从**已经踩过的坑**里长出来的，不是风格偏好。
> 最后更新：2026-09-11。

---

## 1. 先信代码，再信文档

`Plans/Output/` 下的审计报告与交接文档是**历史快照**，可能与代码不符。
`docs/development_log.md` 停在 V1.1 阶段 11，没有 V1.2 条目。

发生冲突时：**以代码 + 当前冻结规范为准**，核实后**修正文档**，然后继续 ——
不要停下来等确认，也不要照着过期文档改代码。

---

## 2. 测试策略：targeted，不是每次全量

```bash
npm run typecheck && npm run typecheck:web      # 秒级，改什么都先跑
npx ts-node tests/run-all.ts <suite> [suite…]   # 只跑相关套件
npm test                                        # 全量 34 套件，含 timing-fairness（约 10 分钟）
```

**全量只在 milestone 跑一次。** 平时按改动范围挑：

| 你动了什么 | 跑什么 |
|---|---|
| `src/core/`（引擎、规则、校验） | `fixed-emitter` `locked-attack-right` `termination` `alive-kill` `obstacle-*` |
| `src/server/` | `server-team` `web-server` `web-projection` |
| `web/src/` | `npm run typecheck:web` + `web-projection`；**改了行为再跑 `npm run e2e`** |
| `competitor-kit/` | `competitor-kit` |
| `src/ui/`（终端文案） | `judge-console` `arena-view` `operator-e2e` |
| 沙箱 / 计时 | `timing-fairness`（**很慢**，323s）`runner-isolation` `process-tree-cleanup` |

### 写回归的规矩

一条**不能抓住旧 bug 的回归等于没写**。加完断言后，把 bug 临时注入回去
跑一遍，确认变红，再还原。本仓库里近期的几条回归都做过这一步
（圆的屏幕几何、锦标赛门禁、选手文档锚点语义）。

回归要断言**语义**，不要断言代理量。反例：`assert(r > 0)` 在圆的半径算错时
照样通过 —— 现在断言的是「画出的椭圆 = 数学圆在投影下的像」。

---

## 3. 里程碑与文档

到稳定 milestone 时：

1. 更新 [`PROJECT_STATE.md`](PROJECT_STATE.md) —— **只写当前有效事实**，
   过时的事实直接删掉，不要把过程日志堆进去。
2. 如果需求状态变了，同步 [`V1.2_REQUIREMENTS.md`](V1.2_REQUIREMENTS.md) 的状态列。
3. **提交**。没有提交的「完成」只存在于你这一台机器上。

不要为每次改动写 CHANGELOG 风格的段落 —— 那是 `git log` 的职责。

---

## 4. 代码风格

- **注释讲「为什么」，不讲「做了什么」。** 尤其要写清楚**反直觉的那些决定**：
  为什么 decoy 世界用常量锚点、为什么打点必须在 `write('GO')` 之后、
  为什么 `snapshotDigest` 不许碰文件系统。这些是下一个人最容易改坏的地方。
- **不要写「TODO 以后优化」式的注释。** 要么现在做，要么写进
  `PROJECT_STATE.md` 的「已知缺口」。
- 匹配周边代码的密度与命名。中文注释、中文错误消息（面向人的）是这个仓库的既有风格。
- 错误消息必须**说人话并且可执行**（规范 §27）。「操作失败」不是错误消息。

---

## 5. 绝不碰的东西

| 东西 | 原因 |
|---|---|
| `playtest/competitors/` | 归档的试玩选手包 —— **人类明确要求不要修改** |
| `algorithms/` | 出厂 fixture，受 git 跟踪。投递点是**运行期**的 `runs/slots/` |
| 沙箱的 `utimes` 拒绝、计时锚点、`GO` 打点位置 | 每一条都有回归盯着，改了就破坏公平性 |
| `protocol.ts` 里的 node import | 会让前端 bundle 直接构建失败 |
| 终止保证（四类 `endReason`） | 改它等于允许「跑不完的比赛」 |

---

## 6. 端到端演练

`npm run e2e` 是**唯一**证明 V1.2 参赛者闭环真的能跑的东西。它很慢
（单次 15–20 分钟起步，真的起服务、真的跑沙箱、真的开浏览器），
并且需要系统装有 Google Chrome（配置里 `channel: 'chrome'`）。

改动前端**行为**（不只是样式）之后必须跑它。改 `web/src/` 的纯样式或纯死代码
可以只跑 `typecheck:web` + `web-projection`。

---

## 7. 交接

新接手的人只需要读 `docs/agent-context/` 下这几份（先 PROJECT_STATE，再按需展开）+ `README.md`。
**不要**一次性读 `Plans/`、`playtest/results/`、完整的 `development_log.md`
或全部历史审计 —— 那会把上下文撑爆，而且里面大半是过期的。
需要追某个具体事实时再定点搜索。
