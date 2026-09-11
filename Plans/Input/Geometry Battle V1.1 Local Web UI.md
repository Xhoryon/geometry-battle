基于当前 RC `42e5417` 开发 Geometry Battle 的正式本地 Web UI。

目标：将现有稳定 Engine / Judge / Replay 包装成真正可使用的本地比赛应用，不重新实现任何比赛判定。

技术建议：

```text
React + TypeScript + Vite
Local Node/TypeScript Tournament Server
REST = 用户操作
WebSocket = 实时比赛状态
```

默认只绑定：

```text
127.0.0.1
```

最终目标：

```text
npm run app
→ 启动本地服务
→ 自动打开浏览器
```

至少提供：

```text
/judge
/spectator
/replay/:matchId
```

### Judge
完成正式赛事全流程：

- Team A/B 算法加载
- Validation / Preflight
- Match Setup
- Arena preview
- Reveal
- START
- Compute status
- First Solver
- 轨迹动画
- kills / alive counts
- round result
- match result
- replay
- audit access
- reset / next match

### Spectator
只读大屏：

- 大型 Arena
- A/B 固定 Emitter
- Combat Points
- Obstacles
- Round
- Compute status
- trajectory animation
- kills
- alive counts
- winner / draw / stalemate

不得显示开发诊断、文件路径、JSON、hash 或 stack trace。

### Replay
使用保存的正式 MatchLog/Audit/trajectory 数据重放真实比赛。

### 核心约束
Web UI 不得重新实现：

```text
timing
first solver
hit detection
obstacle/boundary
kills
winner
stalemate
```

所有权威状态来自现有 Engine。

轨迹动画必须消费 Engine 已判定、已截断的 trajectory，禁止浏览器自行重新计算函数。

尽量不要修改：

```text
src/core/
src/runner/
src/map/
src/submission/
competitor-kit/
Revision 3 rules
500ms timeout
stalemate=20
hard limit=60
```

若确实需要修改核心才能支持 UI，先判断是否能通过只读 adapter/event layer 解决；只有真正不可避免的核心改动才扩大范围。

保留：

```text
npm run judge
```

作为 Terminal fallback。

### 开发方式
继续 Fast Verification Mode：

- UI/API 修改只跑 targeted tests + browser/E2E smoke；
- 未修改 Timing/Sandbox/DSL 时不要重复重型 suites；
- 每完成一个页面直接继续，不等待用户；
- 真正失败必须修或记录；
- 最终 Web UI 完成后再统一进行一次完整 product regression。

至少做一次完整 browser tournament rehearsal：

```text
启动应用
→ 加载两队
→ Preflight
→ Match
→ 多 Round
→ 终局
→ Replay
→ Reset
→ 第二场
```

目标是正常比赛全过程不需要 Terminal 或开发者介入。

完成后形成新的 Product RC，并输出：

```text
LOCAL WEB UI COMPLETE
PRODUCT RELEASE CANDIDATE READY
READY FOR FINAL COMPETITION READINESS AUDIT
```

不要自行创建 `v1.1.0-competition` tag。