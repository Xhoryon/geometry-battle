# Geometry Battle V1.1 — Competitor Interface Freeze Audit

## Role

你是 Geometry Battle V1.1 的：

```text
COMPETITOR INTERFACE AUDITOR
```

本轮是：

```text
READ-ONLY REVIEW
```

不要修改：

- `src/`
- `tests/`
- `starter/`
- Runtime
- Sandbox
- Judge
- DSL
- 比赛规则

本轮目标不是继续开发平台。

目标是确认：

> 一个此前没有参与 Geometry Battle 平台开发的参赛者，是否能够只依赖公开的算法开发文档、Starter 和官方接口，正确开发一个正式参赛算法。

---

# 1. 需要读取的内容

读取当前 V1.1 分支中的：

```text
README.md
Plans/
starter/
src/core/InputProtocol.ts
Runner / Sandbox 相关实现
Algorithm Slot 相关实现
DSL / AST parser
Function Validator
Judge
Competition / Match orchestration
tests/
```

以及最新的：

```text
Geometry Battle V1.1 — 参赛算法开发要求
V1.1 Input Protocol specification
V1.1 Slot & IPC specification
相关 implementation handoff
```

如果《参赛算法开发要求》尚未正式保存到仓库，使用用户提供的当前版本作为待审核规范。

---

# 2. 审核原则

不要因为：

```text
“设计上应该如此”
```

就判 PASS。

必须区分：

```text
Document says
Implementation does
Starter demonstrates
Tests enforce
```

四者。

如果不一致：

```text
REPORT
```

不要自行选择其中一个作为正确答案。

---

# 3. 第一项：算法目录与入口

确认正式参赛者是否真的只需要：

```text
solver.py
```

作为固定入口。

核实：

- 是否允许辅助 `.py` 文件；
- 是否允许子目录；
- ZIP 解压后的根目录要求；
- 是否存在 manifest；
- 是否已经废弃自定义 entrypoint；
- Team A / Team B slot 的实际目录行为。

明确给出：

```text
PASS / AMBIGUOUS / FAIL
```

---

# 4. 固定启动命令

从真实 Runner 中提取正式启动方式。

确认是否真的等价于：

```bash
python3 solver.py \
  --team A \
  --public <path> \
  --reveal <path> \
  --output <path>
```

核实：

- 参数准确名称；
- 参数是否必需；
- 参数顺序是否重要；
- Python executable；
- working directory；
- Team A / B 唯一差异；
- 是否还有隐藏参数。

输出一份：

```text
CANONICAL START COMMAND
```

不得根据文档猜测。

---

# 5. Runtime

确认实际冻结 Runtime：

```text
Python version
allowed third-party packages
package versions
environment variables
CPU limit
memory limit
thread/process limit
```

特别检查：

> 当前公开文档是否足够让参赛者知道哪些库可以 import。

如果目前没有真正的 Runtime Manifest：

标记为：

```text
COMPETITOR DOCUMENTATION GAP
```

不要自行编造允许库列表。

---

# 6. public_state.json

从真实实现生成至少一份实际：

```text
public_state.json
```

不要手写。

核实文档中所有字段：

```text
schema_version
match_id
round
map
points
id
team
x
y
alive
```

以及任何真实存在但文档遗漏的字段。

检查绝对不能泄漏：

```text
obstacles
shooters
real map seed
hidden state
future state
Judge result
```

输出：

```text
ACTUAL PUBLIC STATE SCHEMA
```

---

# 7. reveal_state.json

同样使用真实引擎生成。

核实：

```text
schema_version
match_id
round
public_state_sha256
shooters
obstacles
```

以及实际障碍字段。

尤其确认每一种正式支持 obstacle type 的 JSON Schema：

例如若真实支持：

```text
rectangle
circle
segment
polygon
```

必须把它们的**真实字段名**全部列出来。

不要使用设计稿字段代替真实实现。

---

# 8. Public / Reveal Hash

独立验证：

```text
A public bytes == B public bytes
A reveal bytes == B reveal bytes
```

确认：

```text
public_state_sha256
```

真实绑定机制。

检查参赛者是否需要自行验证 Hash。

如果不是强制要求，文档不要写成必须。

---

# 9. START Gate

确认真实时序：

```text
public state generated
↓
human shooter selection
↓
reveal generated
↓
WAIT
↓
START
↓
participant code first executes
```

验证：

> 在 START 之前，任何 Team `solver.py` 或其 import module 都没有运行。

这一点必须通过实际测试或已有可靠回归确认。

---

# 10. Team Identity

确认 Team Identity 是否只通过：

```text
--team A
--team B
```

提供。

检查两个 JSON 是否真的不含：

```text
my_team
```

等差异字段。

---

# 11. result.json

使用官方 Starter 实际运行一次。

读取真实：

```text
result.json
```

输出正式 Schema。

确认是否只有：

```text
schema_version
dsl
```

如果存在其他必需字段：

必须记录。

确认：

- 文件名；
- 写入路径；
- 是否必须原子 rename；
- 是否接受直接完整写入；
- result 出现后能否覆盖；
- 是否 One Result Per Round。

---

# 12. Result completion timing

确认 V1.1 当前已经修改后的正式计时终点。

特别核实：

```text
mtime
atomic rename
utimes blocked
close-race fallback
```

然后回答：

### 对参赛者而言，必须遵守什么？

只写参赛者真正需要知道的内容。

不要把 SandboxRunner 内部实现细节全部暴露成开发要求。

例如应判断：

```text
“必须使用 atomic rename”
```

究竟是：

```text
REQUIRED
```

还是：

```text
STRONGLY RECOMMENDED
```

必须以实现为依据。

---

# 13. stdout / stderr

实际确认：

- stdout 是否被读取；
- stdout 是否有 size limit；
- stderr 是否允许；
- stderr limit；
- stdout 是否完全不能作为 result channel。

给出参赛者准确规则。

---

# 14. Timeout

确认：

```text
2000 ms
```

是否仍为当前正式值。

确认时间从何时开始，到何时结束。

特别区分：

```text
GO/release
result mtime
process exit
file readable
```

不要让参赛文档描述比实现更强。

---

# 15. TIE_EPS_MS

检查当前真实：

```text
TIE_EPS_MS
```

值。

判断这一内部规则：

- 是否应该告诉参赛者；
- 还是应该只存在于比赛规则文档。

如果不影响接口兼容性，可以建议从“算法开发要求”移到“Competition Rules”。

---

# 16. DSL / AST

这是最重要的审核之一。

从真实 parser / validator 提取：

## Node types

全部允许的：

```text
number
variable
...
```

## Operators

完整 whitelist。

## 每个 Operator

列出：

```text
arity
argument rules
numeric constraints
```

例如：

```text
add: exactly 2
sin: exactly 1
...
```

不要根据以前的 Plan 手写。

---

# 17. DSL 示例必须真实通过

将参赛开发文档中的所有 AST 示例逐个提交真实 Validator。

任何示例如果：

```text
INVALID
```

则文档不能发布。

至少验证：

- 最简单合法函数；
- linear；
- polynomial；
- trig；
- composite。

---

# 18. Function legality

确认正式 Validator 真正执行的全部规则。

包括但不限于：

```text
AST Nodes <= ?
AST Depth <= ?
C²
Convexity changes <= ?
Shooter pass-through
NaN
Infinity
Domain
Illegal operators
```

输出：

```text
ACTUAL VALIDATION PIPELINE
```

只列当前真实生产路径执行的规则。

---

# 19. Shooter pass-through tolerance

确认：

\[
f(x_s)=y_s
\]

在实现中采用的实际数值容差。

判断：

> 是否需要让参赛者知道精确 epsilon。

如果它会影响算法合法性：

必须公开。

---

# 20. Hit tolerance 不要混入算法接口

确认 Hit tolerance 属于：

```text
Competition Judge Rule
```

而不是：

```text
Algorithm Output Contract
```

如果参赛开发文档没有必要知道精确值，可以建议移动到 Rulebook。

---

# 21. Convexity <= 100

确认：

```text
<=100
```

仍然真实生效。

检查文档应该告诉参赛者：

- 规则本身；
- Validator 工具；

但不一定需要暴露 Validator 内部算法。

---

# 22. Sandbox

检查参赛者文档中关于禁止行为的陈述是否与真实 Sandbox 一致：

```text
network
filesystem
home
tmp
other team
Judge source
child process
daemon
cross-round state
utimes
```

重点：

> 不要把 Sandbox 实际没有阻止的能力写成“绝对禁止且技术上阻止”。

如果是：

```text
rule prohibited
```

但不是：

```text
technically blocked
```

必须区分措辞。

---

# 23. `/app /input /output /work`

确认这四个逻辑区域与真实 Runner 一致。

特别检查：

- `/app` 是否只读；
- `/input` 是否只读；
- `/output` 可写范围；
- `/work` 是否真的存在；
- 参赛程序如何获取 `/work` 路径；
- 是否应该写死 `/work`。

如果没有正式提供 work path：

不要在参赛文档里要求选手依赖它。

---

# 24. Randomness

检查比赛是否给 Solver 提供正式随机 Seed。

如果没有：

参赛文档不要暗示存在官方 deterministic solver seed。

如果选手自行：

```python
random.seed(...)
```

这是自己的算法行为。

需要判断是否允许 system randomness。

---

# 25. Stalemate

当前 V1.1 仍存在或即将增加 Stalemate Rule。

检查当前生产代码是否已经真正实现：

```text
MAX_NO_PROGRESS_ROUNDS
MAX_TOTAL_ROUNDS
STALEMATE
ROUND_LIMIT
```

如果还没有实现：

> 不得把拟议的 `12 / 100` 写成已经生效的正式参赛规则。

请明确区分：

```text
IMPLEMENTED
```

与：

```text
PROPOSED
```

这是本轮重点检查项。

---

# 26. 参赛者能否只靠公开资料开发

模拟一个完全陌生的参赛者。

不要读取平台内部实现来写算法。

只使用拟公开：

```text
Algorithm Development Requirements
Starter
JSON examples/schema
DSL reference
Runtime manifest
Local Validator
```

创建：

```text
audit-competitor/
└── solver.py
```

算法可以非常简单。

目标不是强。

目标是：

```text
FIRST-TRY COMPATIBILITY
```

然后使用正式 Preflight。

必须：

```text
PASS
```

否则说明公开接口资料不完整。

---

# 27. 错误信息

检查一个普通参赛者犯以下错误时，Preflight 是否能给出有意义提示：

```text
solver.py missing
unsupported package
wrong CLI parsing
malformed result.json
invalid DSL
AST too deep
doesn't pass shooter
timeout
```

如果只得到：

```text
FAILED
```

而没有可理解原因：

记录 UX issue。

这不一定阻止协议 Freeze，但会严重影响测试阶段。

---

# 28. 规则与开发要求分层

审核当前参赛文档内容，并将项目分成三类：

## A — Algorithm Contract

必须严格遵守，否则程序无法运行。

例如：

```text
solver.py
CLI args
JSON schemas
result schema
runtime
timeout
```

## B — Competition Rules

影响比赛合法性和策略。

例如：

```text
C²
convexity
shooter
attack direction
stalemate
```

## C — Recommendations

不是强制协议。

例如：

```text
推荐 <1000ms
推荐模块结构
推荐 atomic write
```

检查当前文档是否把 Recommendation 错写成 Mandatory。

---

# 29. 不要评估算法策略优劣

本轮不要讨论：

```text
哪种 interpolation 最强
Fourier 是否最好
如何多杀
```

这些留给下一阶段两个 Algorithm Development Agents。

本轮只审核：

> 接口和规则是否足够清晰、准确、可执行。

---

# 30. 最终报告

生成：

```text
Plans/Output/V1.1 Competitor Interface Freeze Audit.md
```

格式：

# Verdict

只能选择：

```text
PASS — READY FOR ALGORITHM PLAYTEST
```

或：

```text
CONDITIONAL PASS
```

或：

```text
FAIL
```

---

## Interface Matrix

| Area | Docs | Implementation | Starter | Test | Result |
|---|---|---|---|---|---|
| Entrypoint | | | | | |
| Runtime | | | | | |
| CLI | | | | | |
| Public JSON | | | | | |
| Reveal JSON | | | | | |
| Team identity | | | | | |
| START gate | | | | | |
| Result JSON | | | | | |
| Timing | | | | | |
| DSL | | | | | |
| Validator | | | | | |
| Sandbox | | | | | |
| Preflight | | | | | |
| Stalemate | | | | | |

---

## Actual Canonical Contract

输出最终从源码和真实运行得到的：

```text
Entrypoint:
Runtime:
Start command:
Public schema:
Reveal schema:
Result schema:
Timeout:
DSL limits:
Sandbox rules:
```

---

## Documentation Problems

按照：

```text
BLOCKER
IMPORTANT
MINOR
```

列出。

---

## Test Competitor Result

记录：

```text
Package:
Preflight:
Runtime:
Output:
DSL validation:
```

---

## Required Changes Before Playtest

如果 PASS：

```text
NONE
```

如果不是：

只列真正需要在“两 Agent 开发算法”之前修改的问题。

---

# 31. 最终问题

必须明确回答：

> 如果现在把公开参赛资料分别交给两个完全独立的 Algorithm Agents，他们是否能够在不读取 Geometry Battle 生产源码的情况下，各自开发出兼容平台的算法？

回答：

```text
YES
```

或：

```text
NO
```

并说明原因。

---

# 32. 本轮结束后

不要自动修改问题。

如果：

```text
PASS — READY FOR ALGORITHM PLAYTEST
```

停止。

下一阶段由两个 Fresh Algorithm Development Agents 独立开发不同策略。

如果：

```text
CONDITIONAL PASS / FAIL
```

输出最小修改清单，等待用户决定。