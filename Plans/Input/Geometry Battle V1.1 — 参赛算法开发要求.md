# Geometry Battle V1.1 — 参赛算法开发要求

> 本文档规定 Geometry Battle V1.1 正式比赛中参赛算法必须遵守的开发、输入、输出、运行与公平性要求。  
> 参赛者只需要开发算法本身，不需要实现比赛界面、地图、碰撞判定、计时、动画或胜负逻辑。

---

# 1. 比赛中你需要开发什么

每支队伍需要提交一个独立算法程序。

算法每一轮会获得：

1. 一份公开状态 JSON；
2. 一份揭盲状态 JSON；
3. 自己属于 Team A 还是 Team B 的身份；
4. 一次正式 START 信号。

算法需要在规定时间内，根据以上数据计算出一条合法攻击函数：

\[
y=f(x)
\]

并以官方规定的 DSL / AST JSON 格式输出。

算法不负责判断：

- 击中了谁；
- 是否撞到障碍物；
- 谁被击杀；
- 谁先攻击；
- 谁获得胜利。

这些全部由赛事 Judge 统一完成。

---

# 2. 比赛流程

每个 Round 按以下顺序进行：

```text
ROUND START PREPARATION
        ↓
生成 public_state.json
        ↓
双方人工选择 Shooter
        ↓
Team A LOCK
Team B LOCK
        ↓
揭盲
        ↓
生成 reveal_state.json
        ↓
裁判 / 主持人准备
        ↓
START
        ↓
Team A Algorithm 与 Team B Algorithm 同时释放
        ↓
双方读取 JSON
        ↓
双方计算
        ↓
生成 result.json
        ↓
Judge 验证函数
        ↓
先完成的一方优先攻击
        ↓
另一方攻击 / Shooter 被击杀后取消
        ↓
ROUND RESULT
```

最重要的一点：

> **参赛算法在 START 之前不会运行。**

因此：

- `public_state.json` 提前存在；
- `reveal_state.json` 揭盲后存在；

并不代表算法可以提前计算。

---

# 3. 固定开发语言与 Runtime

V1.1 使用统一 Python Runtime。

当前正式 Runtime：

```text
Python 3.9.6
```

所有队伍：

- 使用相同 Python 版本；
- 使用相同 Runner；
- 使用相同 CPU / Memory 限制；
- 使用相同 Sandbox；
- 使用相同依赖环境。

允许使用哪些第三方 Python Package，以赛事最终发布的 Runtime Manifest 为准。

参赛者不得在正式比赛中执行：

```text
pip install
conda install
brew install
apt install
npm install
```

或任何其他动态安装行为。

如果算法依赖未被赛事 Runtime 提供的第三方库：

> 算法可能无法通过 Preflight。

因此建议尽量使用：

- Python Standard Library；
- 官方明确允许的数学 / 数值库。

---

# 4. 固定入口文件

算法根目录必须存在：

```text
solver.py
```

例如：

```text
my-algorithm/
├── solver.py
├── optimizer.py
├── geometry.py
├── fitting.py
└── utils/
    ├── search.py
    └── math_tools.py
```

允许自由增加辅助模块。

但正式入口永远是：

```text
solver.py
```

不得要求赛事平台启动：

```text
main.py
run.py
start.py
algorithm.py
```

等其他入口。

---

# 5. 平台中的两个算法槽位

正式比赛平台内部固定存在：

```text
algorithms/
├── team-a/
└── team-b/
```

赛事工作人员上传算法后：

```text
Team A package
→ team-a/

Team B package
→ team-b/
```

参赛者不需要自行操作这两个目录。

你提交的是自己的算法 Package。

平台负责：

```text
上传
↓
检查
↓
Preflight
↓
Hash
↓
Seal
↓
安装到正式 Team Slot
```

---

# 6. 算法 Package 基本要求

建议提交：

```text
team-name.zip
```

ZIP 解压后的根目录必须直接包含：

```text
solver.py
```

正确：

```text
team-name.zip
└── solver.py
```

也可以：

```text
team-name.zip
├── solver.py
├── optimizer.py
└── utils/
```

不建议出现额外一层：

```text
team-name.zip
└── random-folder/
    └── solver.py
```

除非官方 Submission Validator 明确支持。

正式比赛前必须通过官方 Preflight。

---

# 7. 固定启动方式

赛事平台会以固定参数启动算法。

逻辑形式为：

```bash
python3 solver.py \
  --team A \
  --public /input/public_state.json \
  --reveal /input/reveal_state.json \
  --output /output/result.json
```

Team B：

```bash
python3 solver.py \
  --team B \
  --public /input/public_state.json \
  --reveal /input/reveal_state.json \
  --output /output/result.json
```

因此 `solver.py` 必须支持四个参数：

```text
--team
--public
--reveal
--output
```

---

# 8. `--team`

值只可能是：

```text
A
```

或：

```text
B
```

例如：

```python
team = args.team
```

这是算法判断自己属于哪一方的唯一官方渠道。

不要尝试从 JSON：

```text
my_team
```

字段获取身份。

两个队伍收到的输入 JSON 要保持一致，因此 Team Identity 不写入比赛 JSON。

---

# 9. 输入文件一：`public_state.json`

这是揭盲之前已经确定的公开状态。

典型结构：

```json
{
  "schema_version": "1.1",
  "match_id": "MATCH-001",
  "round": 5,

  "map": {
    "xmin": -20,
    "xmax": 20,
    "ymin": -12,
    "ymax": 12
  },

  "points": [
    {
      "id": "A1",
      "team": "A",
      "x": -14,
      "y": 6,
      "alive": true
    },
    {
      "id": "A2",
      "team": "A",
      "x": -10,
      "y": -3,
      "alive": false
    },
    {
      "id": "B1",
      "team": "B",
      "x": 9,
      "y": 5,
      "alive": true
    }
  ]
}
```

---

# 10. `public_state.json` 中的主要内容

至少包含以下类型的信息。

## 10.1 Match 信息

```text
schema_version
match_id
round
```

---

## 10.2 地图边界

例如：

```text
xmin
xmax
ymin
ymax
```

---

## 10.3 全部点

每个点至少具有：

```text
id
team
x
y
alive
```

---

# 11. 死亡点仍然保留

`points` 中不仅包含当前存活点。

死亡点仍然存在：

```json
{
  "id": "B4",
  "team": "B",
  "x": 12,
  "y": -4,
  "alive": false
}
```

因此不要使用：

```python
len(points)
```

作为当前存活单位数量。

正确方式：

```python
alive_points = [
    p for p in points
    if p["alive"]
]
```

死亡点：

- 不能成为 Shooter；
- 不会再次被击杀；

但坐标仍属于公开地图历史信息。

---

# 12. Public State 不包含的信息

`public_state.json` 不会告诉算法：

- 障碍物位置；
- 障碍物数量；
- 障碍物类型；
- Team A Shooter；
- Team B Shooter；
- 隐藏地图 Seed；
- Generator Seed；
- Judge 的预计算结果；
- Hit Result；
- 未来 Round 数据。

特别注意：

> 正式比赛不会向算法提供能够重新生成隐藏障碍物的真实地图 Seed。

---

# 13. 输入文件二：`reveal_state.json`

双方完成 Shooter Lock 后，比赛进入 Reveal。

此时生成：

```text
reveal_state.json
```

典型结构：

```json
{
  "schema_version": "1.1",
  "match_id": "MATCH-001",
  "round": 5,

  "public_state_sha256": "abc123...",

  "shooters": {
    "A": "A4",
    "B": "B2"
  },

  "obstacles": [
    {
      "id": "O1",
      "type": "rectangle",
      "xmin": -2,
      "xmax": 1,
      "ymin": -3,
      "ymax": 2
    },

    {
      "id": "O2",
      "type": "circle",
      "cx": 5,
      "cy": 3,
      "radius": 2
    }
  ]
}
```

---

# 14. Reveal State 是增量数据

`reveal_state.json` 不重新复制：

- points；
- map；
- alive 状态；

而是补充：

```text
shooters
obstacles
public_state binding
```

因此算法应理解：

\[
\text{Current Round State}
=
\text{Public State}
+
\text{Reveal State}
\]

---

# 15. `public_state_sha256`

Reveal State 中会包含：

```text
public_state_sha256
```

用于证明：

> 当前 Reveal 属于哪一份 Public State。

普通算法一般不需要自行验证这个 Hash。

但允许参赛者验证。

不要依赖其具体编码长度之外的任何隐藏语义。

---

# 16. A 与 B 获得相同 JSON

正式比赛要求：

```text
Team A public_state.json
==
Team B public_state.json
```

以及：

```text
Team A reveal_state.json
==
Team B reveal_state.json
```

在正式审计层面会比较 Hash。

双方唯一不同的信息是：

```text
--team A
```

和：

```text
--team B
```

---

# 17. 什么时候算法真正开始运行

必须理解以下区别。

## 已生成 Public State

```text
public_state.json READY
```

算法：

```text
NOT RUNNING
```

---

## 已 Reveal

```text
reveal_state.json READY
```

算法：

```text
NOT RUNNING
```

---

## 裁判点击 START

比赛平台触发统一 GO Event。

之后才允许：

```text
solver.py
```

真正开始执行。

---

# 18. 禁止 Preprocessing

正式比赛禁止：

> 在 START 前执行参赛代码，并利用等待时间计算正式 Round 的结果。

参赛者不需要写“等待 Reveal”的后台程序。

不要设计：

```python
while not reveal_ready:
    precompute_everything()
```

这样的程序。

因为正式 Runner 根本不会在 START 前执行你的 `solver.py`。

---

# 19. Preflight 不等于正式比赛运行

赛事平台会在正式 Match 前运行 Preflight。

用于检查：

- `solver.py` 是否存在；
- Python 能否启动；
- 参数是否支持；
- JSON 是否能够读取；
- 是否能够生成合法结果；
- 是否 Crash；
- 是否 Timeout。

但 Preflight 使用：

> **Decoy Data**

不会使用正式比赛的真实隐藏 Round 数据。

Preflight Sandbox 和正式 Match Sandbox 相互独立。

---

# 20. Sandbox 文件结构

每 Round，算法运行在新的隔离环境。

逻辑结构：

```text
/
├── app/
│   ├── solver.py
│   └── ...
│
├── input/
│   ├── public_state.json
│   └── reveal_state.json
│
├── output/
│
└── work/
```

---

# 21. `/app`

包含你的算法文件。

正式运行时：

```text
READ ONLY
```

不要尝试修改：

```text
solver.py
optimizer.py
```

或其他算法文件。

---

# 22. `/input`

包含：

```text
public_state.json
reveal_state.json
```

正式运行时：

```text
READ ONLY
```

不要尝试修改输入文件。

---

# 23. `/output`

只用于生成正式：

```text
result.json
```

每 Round 会提供新的 Output 环境。

---

# 24. `/work`

如果算法需要临时文件，可以使用赛事允许的临时工作区域。

但是：

```text
Round N end
↓
Sandbox destroyed
```

下一轮重新创建。

因此不要依赖：

```text
Round 1 写文件
Round 2 再读取
```

这种逻辑。

它不会被视为合法算法设计。

---

# 25. 禁止跨 Round 状态

每一 Round 的算法必须被视为：

> 全新的独立执行。

不得依赖：

- 上一轮内存；
- 上一轮文件；
- `/tmp`；
- Home；
- Shared Memory；
- socket；
- background daemon；
- child process；
- local server。

正式 Sandbox 会主动阻止这些跨 Round 通道。

---

# 26. 禁止访问其他 Team 算法

Team A 不允许读取：

```text
Team B solver
Team B source
Team B temporary files
```

Team B 同理。

不要尝试：

- 猜测其他 Team 路径；
- 读取项目源码；
- 读取 Judge 源码；
- 枚举宿主目录。

正式 Sandbox 会进行隔离。

---

# 27. 禁止网络访问

正式算法不允许访问：

- Internet；
- HTTP；
- HTTPS；
- DNS；
- localhost service；
- TCP；
- UDP；
- WebSocket；
- 外部 API；
- LLM API。

因此比赛运行时不能：

```text
调用 ChatGPT
调用 Claude
访问自己服务器
在线查数据
```

这也是为什么本赛事属于：

> **Algorithm Vibecoding Competition**

而不是实时 AI Agent Competition。

AI 可以用于赛前开发算法。

正式比赛只运行冻结后的算法。

---

# 28. 固定输出文件

算法必须生成：

```text
result.json
```

路径由：

```text
--output
```

参数提供。

不要自行假设固定绝对路径。

正确：

```python
output_path = args.output
```

---

# 29. 输出 JSON 基本结构

正式输出只包含：

```json
{
  "schema_version": "1.1",
  "dsl": {
    "...": "official function AST"
  }
}
```

其中：

```text
dsl
```

表示你选择的攻击函数：

\[
y=f(x)
\]

---

# 30. 算法不能输出 Target

不要返回：

```json
{
  "target": "B3"
}
```

Judge 不接受这种结果。

算法应该返回：

> 一整条函数。

---

# 31. 算法不能输出 Hit

不要返回：

```json
{
  "hits": ["B2", "B5"]
}
```

因为：

```text
Hit Detection
```

属于 Judge。

---

# 32. 算法不能输出 Winner

不要返回：

```json
{
  "winner": "A"
}
```

算法无权决定比赛结果。

---

# 33. 算法不能自行声明计算时间

不要返回：

```json
{
  "compute_time": 34.5
}
```

官方时间由赛事 Runner 测量。

算法自己报告的时间不会被 Judge 使用。

---

# 34. Function DSL / AST

攻击函数不是 Python source code。

不能返回：

```text
lambda x: ...
```

不能返回：

```text
"y = sin(x)"
```

也不能返回：

```python
def f(x):
    ...
```

必须使用官方 JSON AST。

例如概念上：

```json
{
  "type": "add",
  "args": [
    {
      "type": "mul",
      "args": [
        {
          "type": "number",
          "value": 0.3
        },
        {
          "type": "variable",
          "name": "x"
        }
      ]
    },
    {
      "type": "number",
      "value": 2
    }
  ]
}
```

代表：

\[
f(x)=0.3x+2
\]

---

# 35. DSL Operator

正式允许的 Operator 必须以赛事发布的：

```text
DSL Specification
```

和 Submission Validator 为唯一权威。

不要根据 Python：

```python
math.*
numpy.*
sympy.*
```

支持什么，就假设 DSL 也支持什么。

例如一个函数：

```python
numpy.tanh
```

能在你的 Python 中运行，

并不代表 Judge DSL 允许：

```text
tanh
```

。

开发前请使用官方 Validator 检查。

---

# 36. 为什么不在算法输出里直接写数学字符串

赛事不接受：

```json
{
  "equation": "sin(x) + 0.3*x"
}
```

主要原因是数学字符串可能出现：

- 解析歧义；
- 隐藏条件；
- 非法函数；
- 任意代码；
- Parser 差异。

统一 AST 后：

- Judge；
- Validator；
- Visualizer；

可以共享同一个数学表示。

---

# 37. Attack Function 基础规则

每次攻击必须对应：

\[
y=f(x)
\]

函数必须满足赛事规则。

包括但不限于：

- 单值；
- 合法定义域；
- 满足规定连续性；
- 满足 C² 要求；
- 不允许非法分段攻击；
- 不允许数值异常；
- 复杂度不超过限制；
- 凹凸变化不超过限制。

---

# 38. Shooter Constraint

本轮 Shooter：

\[
S=(x_s,y_s)
\]

你的函数必须经过 Shooter：

\[
\boxed{f(x_s)=y_s}
\]

否则：

```text
INVALID SHOT
```

---

# 39. Team A 与 Team B 的攻击方向

Team A 从左侧攻击右侧。

其有效方向：

\[
x\geq x_s
\]

Team B 从右侧攻击左侧。

其有效方向：

\[
x\leq x_s
\]

你只需要生成：

\[
f(x)
\]

Judge 会根据 Team 自动确定攻击传播方向。

---

# 40. 不需要自己裁剪函数

Team A 不需要返回：

```text
if x >= shooter_x
```

Team B 也不需要返回：

```text
if x <= shooter_x
```

事实上这种条件表达式可能本身属于非法 Piecewise 结构。

正确做法：

> 返回完整合法 \(f(x)\)，传播方向由 Judge 处理。

---

# 41. 分段攻击禁止

一次攻击不能由多个条件区间拼接。

例如：

\[
f(x)=
\begin{cases}
f_1(x),&x<a\\
f_2(x),&x\geq a
\end{cases}
\]

非法。

同样不要通过 DSL 构造：

```text
if
else
condition
switch
```

等隐藏分段行为。

---

# 42. 函数复杂度限制

当前 V1 系列核心限制包括：

```text
AST Nodes <= 128
AST Depth <= 12
```

超出限制：

```text
INVALID SHOT
```

不要为了“更聪明”而无限扩大表达式。

---

# 43. 凹凸变化限制

当前正式限制：

\[
\boxed{
\text{Convexity Changes}\leq100
}
\]

因此允许：

- 多次弯曲；
- 三角函数；
- 复合函数；
- Fourier 风格函数；

但不允许通过超高频振荡进行接近二维密度覆盖的攻击。

---

# 44. C²

函数需要满足官方 C² 要求。

因此不要构造明显包含：

- jump；
- corner；
- discontinuity；
- singularity；

的轨迹。

即使某个表达式在 Python 中可以计算：

> 也不意味着它是合法攻击函数。

以官方 Validator 结果为准。

---

# 45. 非有限数禁止

函数有效区间内不得产生：

```text
NaN
Infinity
-Infinity
Complex
Undefined
```

例如需要特别谨慎：

```text
division
sqrt
log
pow
```

相关表达式的定义域。

---

# 46. Judge 才决定障碍物碰撞

算法可以：

> 根据障碍物优化自己的函数。

但不要自行返回：

```text
firstCollision
blockedBy
```

Judge 会独立计算函数与障碍物的正式交点。

---

# 47. 多杀允许

如果一条合法函数：

- 经过多个敌方点；
- 并且这些点都位于第一个障碍物之前；

则可以一次击杀多个敌人。

例如：

```text
Shooter
   ↓

curve
   ↓
B2
   ↓
B5
   ↓
B7
   ↓
Obstacle
```

则可能形成：

```text
TRIPLE KILL
```

---

# 48. Shooter 可以被攻击

对方本轮选择的 Shooter 仍然是正常敌方点。

如果你的算法先完成，并且函数命中对方 Shooter：

```text
OPPONENT SHOOTER ELIMINATED
```

若对方尚未完成正式攻击：

```text
OPPONENT SHOT CANCELLED
```

因此算法不仅需要考虑击杀数量，也可以考虑：

> 是否优先攻击对方 Shooter。

---

# 49. 速度的重要性

双方算法同时开始。

先产生合法结果的一方优先攻击。

因此算法目标不是单纯：

\[
\max(\text{kills})
\]

还存在：

\[
\text{solution quality}
\]

与：

\[
\text{compute time}
\]

之间的权衡。

例如：

```text
Algorithm A
80ms
1 kill

Algorithm B
900ms
3 kills
```

A 可能先击杀 B 的 Shooter，

导致 B 的 3-kill 函数根本无法开火。

这属于比赛策略的一部分。

---

# 50. 正式计算时间限制

当前正式：

```text
2000 ms
```

算法必须在时间限制内生成合法：

```text
result.json
```

否则：

```text
TIMEOUT
```

本 Round：

```text
NO SHOT
```

---

# 51. 什么时间算结束

正式结果通道是：

```text
/output/result.json
```

平台会依据经过审计的文件提交机制记录结果完成时刻。

因此：

> 不要依赖 stdout 打印结果。

---

# 52. `result.json` 应原子提交

强烈要求按照：

```text
temporary file
↓
完整写入
↓
atomic rename
↓
result.json
```

提交结果。

Python 示例：

```python
import json
import os

tmp = output_path + ".tmp"

with open(tmp, "w", encoding="utf-8") as f:
    json.dump(result, f)

os.replace(tmp, output_path)
```

不要：

```python
with open(output_path, "w") as f:
    # 一边算一边慢慢写
```

因为 Judge 可能看到半写入文件。

---

# 53. 不允许修改 Result 时间戳

赛事 Runner 使用受保护的文件提交时间信息进行公平计时。

不要尝试：

```python
os.utime(...)
```

修改正式 Result 文件时间。

Sandbox 会阻止相关能力。

任何试图人为伪造计算完成时间的行为均属于严重违规。

---

# 54. stdout

stdout 不作为正式 IPC。

不要：

```python
print(result_json)
```

然后期待 Judge 读取。

正式结果必须写：

```text
result.json
```

---

# 55. stderr

允许有限 Debug 输出，例如：

```python
print("candidate count:", n, file=sys.stderr)
```

但：

- 大小有限；
- 不影响比赛结果；
- 不参与计时结果判断；
- 不应输出大量数据。

---

# 56. 不要洪泛输出

禁止故意输出：

```text
几十 MB
几百 MB
无限日志
```

stdout / stderr 都有资源限制。

恶意 Output Flood 可能导致：

```text
RUNNER TERMINATED
```

或比赛处罚。

---

# 57. Starter 模板

最基础的 `solver.py` 可以写成：

```python
import argparse
import json
import os

parser = argparse.ArgumentParser()

parser.add_argument("--team", required=True)
parser.add_argument("--public", required=True)
parser.add_argument("--reveal", required=True)
parser.add_argument("--output", required=True)

args = parser.parse_args()

with open(args.public, "r", encoding="utf-8") as f:
    public_state = json.load(f)

with open(args.reveal, "r", encoding="utf-8") as f:
    reveal_state = json.load(f)

team = args.team

# -----------------------------------
# Your algorithm starts here
# -----------------------------------

dsl = {
    "type": "number",
    "value": 0
}

# -----------------------------------

result = {
    "schema_version": "1.1",
    "dsl": dsl
}

tmp = args.output + ".tmp"

with open(tmp, "w", encoding="utf-8") as f:
    json.dump(result, f)

os.replace(tmp, args.output)
```

注意：

上面的 DSL 只是说明接口结构。

实际攻击函数必须：

> 经过本轮 Shooter 并满足全部合法性规则。

---

# 58. 推荐算法内部结构

赛事不强制，但建议将算法拆分为：

```text
solver.py
    ↓
parse_input()
    ↓
build_game_state()
    ↓
generate_candidates()
    ↓
evaluate_candidates()
    ↓
choose_function()
    ↓
build_dsl()
    ↓
write_result()
```

这样比把全部逻辑写进一个文件更容易调试。

---

# 59. 一个合理的算法开发方向

例如可以：

### Step 1

读取：

```text
Shooter
Enemy Points
Friendly Points
Obstacles
```

### Step 2

生成候选函数：

- polynomial；
- sinusoidal；
- composite；
- Fourier-like；
- interpolation-based；
- heuristic fitting。

### Step 3

估算：

```text
expected kills
obstacle risk
shooter kill
function complexity
compute cost
```

### Step 4

选择最优候选。

### Step 5

输出 DSL。

---

# 60. 不要求使用 AI

正式比赛算法：

> 不需要也不能实时调用 AI。

选手可以使用：

- ChatGPT；
- Codex；
- Claude；
- Claude Code；
- Copilot；

帮助：

- 开发；
- Debug；
- 优化；
- 设计数学方法；
- 编写测试。

但最终比赛提交的是：

```text
Frozen Algorithm
```

---

# 61. 算法必须能够解释

赛事可以要求队伍能够简单说明：

- 核心算法思路；
- 如何产生函数候选；
- 如何处理障碍；
- 如何考虑速度；
- 如何处理 Shooter；
- 如何保证函数合法；
- AI 在开发过程中发挥了什么作用。

不要求逐行解释所有代码。

但应能够解释自己的总体方案。

---

# 62. 官方 Preflight

正式提交后平台会进行 Preflight。

可能检查：

```text
Package structure
solver.py
Python startup
CLI arguments
Decoy Public JSON
Decoy Reveal JSON
Result JSON
DSL validity
Runtime
Timeout
Sandbox compatibility
```

Preflight：

```text
PASS
```

后算法才进入：

```text
READY
```

状态。

---

# 63. Package Hash

通过 Preflight 后：

```text
Algorithm Package
↓
SHA-256
↓
SEALED
```

正式比赛过程中不能修改。

如果算法内容变化：

```text
Hash changes
```

需要重新：

```text
Preflight
```

。

---

# 64. 不要把运行时生成的数据写入算法目录

正式：

```text
/app
```

是只读的。

例如不要：

```python
open("cache.json", "w")
```

写在算法根目录。

如果确实需要本轮临时缓存，使用赛事允许的：

```text
/work
```

但它不会跨 Round 保留。

---

# 65. 禁止利用文件系统作弊

不得尝试：

- `/Users/...`
- `/home/...`
- `/tmp/...`
- project source；
- Judge source；
- Team B directory；
- system config。

即使开发电脑上某些路径能够访问：

> 正式比赛 Sandbox 中不应依赖这些路径。

---

# 66. 禁止启动后台服务

不要：

```python
subprocess.Popen(...)
```

启动一个后台 Solver，希望下一轮继续运行。

正式 Runner 会清理完整进程树。

跨 Round daemon 属于违规。

---

# 67. 禁止修改系统时间或文件时间

不要尝试修改：

- clock；
- result mtime；
- system timing；
- timestamp metadata。

这些不会提升算法合法速度，并可能直接触发 Sandbox 拒绝。

---

# 68. 随机算法

如果你的策略需要随机搜索：

> 不要依赖外部随机服务。

可以使用本地 PRNG。

但为了可复现性，建议根据本轮公开信息构造内部 Seed，例如：

```text
match_id + round + team
```

具体是否采用由队伍自行决定。

不要使用隐藏地图 Seed，因为算法不会获得它。

---

# 69. 注意 2 秒预算

如果采用：

- symbolic regression；
- evolutionary search；
- numerical optimization；
- brute force；
- interpolation enumeration；

必须实际 Benchmark。

一个理论上能找到：

```text
8 kills
```

但需要：

```text
4 seconds
```

的算法正式比赛结果是：

```text
TIMEOUT
```

因此实际目标更接近：

\[
\max
\left(
\text{attack quality under time budget}
\right)
\]

---

# 70. 不要假设固定点数量

正式比赛：

\[
6\leq N\leq10
\]

算法不要写死：

```python
for i in range(8):
```

除非比赛场次明确固定为 8v8。

推荐始终根据：

```python
points
```

动态读取。

---

# 71. 不要假设 Shooter 编号固定

Shooter 可能是：

```text
A1
A7
B2
B10
```

必须读取：

```json
"shooters"
```

不要根据 Round Number 猜测。

---

# 72. 不要假设障碍物数量固定

算法应接受：

```text
0
1
2
...
```

个障碍物。

不得写死：

```python
obstacle = obstacles[0]
```

而不检查列表长度。

---

# 73. 不要假设障碍物类型只有一种

实际开放哪些类型以正式 V1.1 Schema 为准。

算法必须：

```python
if obstacle["type"] == ...
```

正确解析赛事支持的每种类型。

不要默认为所有障碍都是 rectangle。

---

# 74. 不要根据 JSON 字段顺序推断语义

JSON Object 字段顺序不是策略信息。

例如不要根据：

```text
第一个 obstacle
```

推断：

> 它一定是距离 Shooter 最近的障碍。

除非 Schema 明确这样规定。

---

# 75. 不要根据 Point 数组顺序推断策略信息

例如：

```text
points[0]
```

不代表：

- 最危险；
- 最左；
- 最近；
- Shooter；
- 最优目标。

使用：

```text
id
team
coordinate
alive
```

判断。

---

# 76. 正式 Schema Version

当前：

```text
schema_version = "1.1"
```

算法应该检查 Schema。

例如：

```python
if public_state["schema_version"] != "1.1":
    ...
```

不建议静默按照其他版本解析。

---

# 77. Error Handling

算法至少应该处理：

- JSON read error；
- empty enemy list；
- few alive points；
- zero obstacles；
- multiple obstacles；
- unusual but legal coordinates；
- no good attack candidate。

如果没有优秀函数：

> 输出一个合法保守函数通常比 Crash 更好。

---

# 78. Crash

如果算法：

- exception；
- segmentation fault；
- process error；
- invalid startup；

该 Round：

```text
RUNNER_CRASH
```

通常不会获得重新运行机会。

---

# 79. 一轮只允许一次正式输出

不要：

```text
先提交一个很快的差函数
↓
继续计算
↓
再覆盖一个更好的函数
```

这种行为违反协议。

正式：

\[
\boxed{\text{One Round = One Result}}
\]

Judge 接受到正式 `result.json` 后：

> 本轮结果冻结。

---

# 80. Stalemate / Match End

V1.1 会定义明确的有限终止机制。

除了：

```text
ELIMINATION
```

之外，平台还可能通过：

```text
STALEMATE
ROUND_LIMIT
```

终止比赛。

这些属于平台规则。

算法不需要自行判断 Match 是否结束。

每个 Round 只根据当前输入求解即可。

---

# 81. 参赛者绝对不要做的事情

以下行为属于禁止范围：

1. 网络访问；
2. 调用在线 AI；
3. 读取对手算法；
4. 读取 Judge 源码；
5. 修改比赛 JSON；
6. 跨 Round 保存状态；
7. 启动后台 daemon；
8. 修改 Result 时间戳；
9. 伪造 Runner 时间；
10. 利用 Sandbox 漏洞；
11. 洪泛 stdout/stderr；
12. 修改自己的 sealed package；
13. 输出 Piecewise / 非法 DSL；
14. 利用 NaN/Infinity 干扰 Judge；
15. 故意制造 Judge DoS；
16. 尝试访问隐藏 Seed；
17. 创建额外 IPC channel。

正式比赛发现恶意利用漏洞：

> 赛事方有权取消该 Round、Match 或参赛资格。

---

# 82. 推荐开发流程

参赛队可以按照：

```text
1. 下载 Starter SDK
↓
2. 先跑通官方 solver.py
↓
3. 理解两个输入 JSON
↓
4. 写一个最简单的合法函数
↓
5. 通过 Local Validator
↓
6. 实现基础目标选择
↓
7. 加入障碍物处理
↓
8. 加入多目标函数拟合
↓
9. 优化运行时间
↓
10. Benchmark
↓
11. Adversarial Test
↓
12. Submission Preflight
```

不要一开始就写极复杂的 Fourier / symbolic optimization。

先确保：

```text
100% valid
100% stable
```

通常比：

```text
偶尔很强
经常 INVALID
```

更适合正式比赛。

---

# 83. 建议自行测试的场景

提交前至少测试：

### Point counts

```text
6v6
8v8
10v10
```

### Shooter

```text
different shooter IDs
edge coordinates
```

### Obstacles

```text
0 obstacles
1 obstacle
multiple obstacles
```

### Function

```text
simple
complex
near AST limit
near convexity limit
```

### Runtime

```text
<100ms
~500ms
~1500ms
close to timeout
```

### Failure

```text
no candidate
unexpected input
invalid candidate
```

---

# 84. 建议性能目标

官方硬限制是：

```text
2000ms
```

但不要把正常运行目标设成：

```text
1950ms
```

因为真实系统存在：

- Python startup；
- scheduling；
- file IO；
- serialization；
- OS jitter。

更合理的是尽量留出安全余量。

例如：

```text
< 1000ms
```

通常会比卡 deadline 更稳。

而真正追求先手的算法可能进一步优化到：

```text
几十到几百 ms
```

---

# 85. 官方计时与近似同时完成

比赛存在：

```text
TIE_EPS_MS
```

用于处理极小时间差。

当前实现基线：

```text
0.05 ms
```

即：

```text
50 μs
```

参赛者不应该编写依赖：

> 几微秒差距一定会产生稳定先手结果

的策略。

操作系统调度存在正常微小波动。

---

# 86. 算法优化应该关注什么

最终算法可以同时优化：

\[
\text{Kills}
\]

\[
\text{Shooter Elimination Probability}
\]

\[
\text{Obstacle Avoidance}
\]

\[
\text{Function Validity}
\]

\[
\text{Computation Time}
\]

而不是只追求某一个指标。

一个非常复杂的函数不一定比快速可靠的函数更强。

---

# 87. 官方提供给参赛者的内容

正式比赛前建议赛事方提供：

```text
Algorithm Development Requirements
Starter SDK
solver.py template
public_state sample
reveal_state sample
result sample
DSL Specification
JSON Schema
Local Submission Validator
Local Function Validator
Runtime Manifest
Example Algorithms
```

参赛者不应依赖平台生产源码开发。

---

# 88. 最小合格算法

一个算法要具备正式参赛资格，至少必须：

- 有 `solver.py`；
- 正确读取四个 CLI 参数；
- 正确读取两份 JSON；
- 根据 `--team` 判断己方；
- 读取 Shooter；
- 生成合法函数；
- 输出合法 DSL；
- 原子生成 `result.json`；
- 在 Timeout 前完成；
- 不违反 Sandbox 要求。

---

# 89. 正式提交前 Checklist

提交前逐项确认：

```text
[ ] solver.py 位于根目录

[ ] Python Runtime 兼容

[ ] 不依赖未允许第三方 Package

[ ] --team 正常

[ ] --public 正常

[ ] --reveal 正常

[ ] --output 正常

[ ] public_state.json 能正确解析

[ ] reveal_state.json 能正确解析

[ ] 能正确识别己方 Shooter

[ ] 能正确识别敌方 Shooter

[ ] 能处理 dead points

[ ] 能处理 6–10 个点

[ ] 能处理所有官方 obstacle types

[ ] 不依赖 map seed

[ ] 不访问网络

[ ] 不访问外部文件

[ ] 不保存跨 Round 状态

[ ] 不启动后台服务

[ ] DSL 符合官方 Schema

[ ] Function 经过 Shooter

[ ] Function 满足 C²

[ ] Convexity Changes <= 100

[ ] AST Nodes <= 128

[ ] AST Depth <= 12

[ ] 无 NaN / Infinity

[ ] result.json 使用官方 Schema

[ ] result.json 使用原子提交

[ ] 不修改 result timestamp

[ ] 不使用 stdout 作为正式结果

[ ] 典型 Round < 2000ms

[ ] 官方 Local Validator PASS

[ ] 官方 Preflight PASS
```

---

# 90. 一句话理解正式接口

对于参赛者来说，整个 Geometry Battle V1.1 可以理解成：

```text
          public_state.json
                  +
          reveal_state.json
                  +
              --team
                  ↓
             solver.py
                  ↓
              2 seconds
                  ↓
             result.json
                  ↓
               Judge
```

你只需要解决：

> **给定当前完整 Round 信息，从人工选择的 Shooter 出发，尽快生成一条合法且尽可能优秀的函数轨迹。**

其他所有事情都由比赛平台负责。

---

# 91. 最终原则

## 输入固定

```text
public_state.json
reveal_state.json
--team
```

## 启动固定

```text
solver.py
```

## 输出固定

```text
result.json
```

## Runtime 固定

```text
Official Python Runtime
```

## 时间固定

```text
2000 ms
```

## 比赛期间没有 AI

```text
Frozen Algorithm Only
```

## 比赛期间没有网络

```text
Offline Sandbox
```

## 每轮重新开始

```text
Fresh Sandbox
```

## 每轮只提交一次

```text
One Round
=
One Function
```

---

# 92. 对参赛者最重要的建议

不要把主要时间花在：

> “怎样绕过规则”。

正式 Sandbox、Validator 和 Judge 会统一控制比赛边界。

真正值得优化的是：

> **怎样在有限时间内，从大量合法函数中找到一个更好的函数。**

这也是 Geometry Battle 的核心算法挑战。