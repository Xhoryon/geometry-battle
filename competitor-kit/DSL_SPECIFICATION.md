# DSL Specification

本文件是函数 DSL 的**正式规范**，内容直接来自平台的 parser 与 validator。
所有示例都由永久回归测试逐条提交真实 parser / validator 验证（`tests/competitor-kit.ts`）。

**示例标记约定（由 `tests/competitor-kit.ts` 逐条验证）：**

| 标记 | 含义 |
|---|---|
| `AST-VALID` | 完整通过 parser **与** 函数合法性校验 |
| `AST-PARSE-OK` | 仅保证 parser 接受（片段示例，未断言完整合法性） |
| `AST-INVALID: <CODE>` | 被拒绝，且错误码就是 `<CODE>` |

---

## 1. 结果文件形态

```text
output/result.json
```

```json
{
  "schema_version": "1.1",
  "dsl": <AST>
}
```

- 顶层**只允许**这两个键。多一个键即非法。
- `schema_version` 必须精确为字符串 `"1.1"`。
- `dsl` 可以是 AST 对象本身，也可以是 AST 的 JSON **字符串**（两者都接受）。

---

## 2. 节点表示法

每个节点是一个 JSON 对象：

```json
{ "type": "<节点类型>", "value": <数值或字符串>, "args": [<子节点>...] }
```

- 规范键是 `type`；同时接受 `op` 作为别名（`{"op":"add",...}` 等价于 `{"type":"add",...}`）。
- `number` 节点用 `value`（有限数值）。
- `variable` 节点**必须**显式写 `"value": "x"`（见 §3）。
- 运算符节点用 `args` 数组，长度必须精确等于该运算符的元数。

---

## 3. 允许的节点类型（全部 14 种）

| type | 元数 | 字段 | 说明 |
|---|---|---|---|
| `number` | 0 | `value: number` | 有限常数，`|value| ≤ 1000` |
| `variable` | 0 | `value: "x"` | **必须**显式给出，且只能为 `"x"` |
| `add` | 2 | `args` | 加法 |
| `sub` | 2 | `args` | 减法 |
| `mul` | 2 | `args` | 乘法 |
| `div` | 2 | `args` | 除法 |
| `pow` | 2 | `args` | 幂 |
| `neg` | 1 | `args` | 取负 |
| `sin` | 1 | `args` | 正弦 |
| `cos` | 1 | `args` | 余弦 |
| `tan` | 1 | `args` | 正切 |
| `sqrt` | 1 | `args` | 平方根 |
| `log` | 1 | `args` | 自然对数 |
| `exp` | 1 | `args` | 指数 |

### variable 的唯一合法形态

<!-- AST-PARSE-OK -->
```json
{ "type": "variable", "value": "x" }
```

以下两种写法**都会**被拒绝（旧文档曾用 `name`，已废弃）：

<!-- AST-INVALID: BAD_VALUE -->
```json
{ "type": "variable" }
```

<!-- AST-INVALID: BAD_VALUE -->
```json
{ "type": "variable", "name": "x" }
```

<!-- AST-INVALID: BAD_VALUE -->
```json
{ "type": "variable", "value": "y" }
```

> 冻结规则：`value` 缺失、键名写成 `name`、或值不是 `"x"`，一律 `INVALID`。
> 平台不会再把缺失的 `value` 静默解释成 `x`。

---

## 4. 禁止的节点类型

以下类型**一律拒绝**（错误码 `FORBIDDEN_OPERATOR`）。它们都可以构造分段 / 非光滑行为：

```text
if  else  switch  condition  ternary
min  max  abs  floor  ceil  round  sign  step  heaviside
lt  gt  lte  gte  eq  neq  and  or  not
```

<!-- AST-INVALID: FORBIDDEN_OPERATOR -->
```json
{ "type": "abs", "args": [{ "type": "variable", "value": "x" }] }
```

<!-- AST-INVALID: FORBIDDEN_OPERATOR -->
```json
{ "type": "min", "args": [{ "type": "variable", "value": "x" }, { "type": "number", "value": 0 }] }
```

---

## 5. 未知名运算符

不在 §3 白名单内的任何其它类型名都被拒绝，错误码 `UNSUPPORTED_OPERATOR`：

<!-- AST-INVALID: UNSUPPORTED_OPERATOR -->
```json
{ "type": "tanh", "args": [{ "type": "variable", "value": "x" }] }
```

---

## 6. 结构限制

| 限制 | 值 | 错误码 |
|---|---|---|
| 节点总数 | ≤ 128 | `NODE_LIMIT` |
| 嵌套深度 | ≤ 12 | `DEPTH_LIMIT` |
| 常数绝对值 | ≤ 1000 | `CONST_TOO_LARGE` |
| 元数必须精确 | 二元 2 / 一元 1 | `BAD_ARITY` |
| 常数必须有限 | 拒绝 `NaN` / `Infinity` | `BAD_VALUE` |

<!-- AST-INVALID: BAD_ARITY -->
```json
{ "type": "add", "args": [{ "type": "number", "value": 1 }, { "type": "number", "value": 2 }, { "type": "number", "value": 3 }] }
```

<!-- AST-INVALID: CONST_TOO_LARGE -->
```json
{ "type": "number", "value": 1001 }
```

<!-- AST-INVALID: BAD_VALUE -->
```json
{ "type": "number", "value": null }
```

> 深度定义：叶子（`number` / `variable`）深度为 1；每包一层运算符加 1。
> 超过 12 层会在第 13 层被拒绝，且解析器不会展开它。

---

## 7. 函数合法性（数值校验）

结构合法的 AST 还要通过数值校验。校验在**有效攻击范围**上进行：

```text
Team A：x ∈ [x_e, 20]（x_e 为 Emitter 的 x 坐标）
Team B：x ∈ [-20, x_e]
```

校验区间就是 Judge 的**遍历区间**：Team A 从 `x_e` 向 `x = 20` 遍历（x 增大），Team B 从 `x_e` 向
`x = -20` 遍历（x 减小）；函数本身仍是普通的 `y = f(x)`，队别只决定平台看哪一段、往哪边走
（见 [ALGORITHM_REQUIREMENTS.md](ALGORITHM_REQUIREMENTS.md) §6.2）。
**English.** The validation interval is the Judge's traversal interval: Team A traverses from `x_e` towards
`x = 20` (increasing x), Team B from `x_e` towards `x = -20` (decreasing x); the function itself is still a
plain `y = f(x)` — the team only decides which segment the platform looks at, and in which direction.

数值校验的**采样网格**也从本队 Emitter 出发、沿进攻方向以步长 `h` 推进到场地边界（V1.4 起对双方一致）：
两队的采样点互为精确镜像，因此同一条打法写成 A 的函数与写成 B 的镜像函数，合法性结论与错误码相同。
**English.** The numerical checks sample on a grid that also starts at your own Emitter and walks in the attack
direction with step `h` to the field edge (identical for both sides since V1.4): the two teams' sample points are
exact mirrors of each other, so the same shot written as an A function or as its B mirror gets the same verdict
and the same error code.

| 要求 | 判定 | 错误码 |
|---|---|---|
| 必须经过自己的固定 Emitter | `|f(x_e) − y_e| ≤ 1e-6` | `NOT_THROUGH_SHOOTER` |
| 在攻击范围内有限 | 采样点上 `|f(x)|` 有限且 ≤ 1e6 | `NOT_FINITE` |
| 定义域合法 | 例如 `sqrt` 负数、`log` 非正、除零 | `DOMAIN_ERROR` |
| 连续 | 跳变检测 | `DISCONTINUOUS` |
| 一阶导连续（C¹） | 跳变检测 | `NOT_C2` |
| 二阶导连续（C²） | 跳变检测 | `NOT_C2` |
| 不异常陡峭 | `|f'| ≤ 1e10` | `NOT_C2` |
| 凸性变号次数 | ≤ 100 | `CONVEXITY_LIMIT` |
| 振荡可采样 | 抗混叠采样点数 ≤ 400000 | `OSCILLATION_LIMIT` |

### Emitter 容差

```text
|f(x_e) − y_e| ≤ 1e-6
```

这是**函数合法性**的容差，与「命中判定」是**两个不同的概念**：命中判定属于 Judge 规则，
不参与算法接口。请不要把它们混为一谈。

<!-- AST-INVALID: NOT_THROUGH_SHOOTER -->
```json
{ "type": "number", "value": 2 }
```

> 上例在 Team A 的 Emitter（`public_state.emitters.A`，设其 `y_e = 0`）下
> `f(x_e) = 2 ≠ 0`，因此不通过。

---

## 8. 合法示例

以下示例统一采用：

```text
Team A，本场 Emitter E = (x_e, y_e)   ← 从 public_state.emitters 读
有效攻击范围 x ∈ [x_e, 20]
```

> 为便于阅读，下文示例把 `(x_e, y_e)` 具体写成 `(-18, 0)`。
> **那只是举例**：真实坐标逐场不同，代码里必须从 `public_state.emitters` 取。

### 8.1 常数

<!-- AST-VALID -->
```json
{ "type": "number", "value": 0 }
```

### 8.2 线性

`f(x) = y_e + 0.3·(x − x_e)`

<!-- AST-VALID -->
```json
{
  "type": "add",
  "args": [
    { "type": "number", "value": 0 },
    {
      "type": "mul",
      "args": [
        { "type": "number", "value": 0.3 },
        {
          "type": "sub",
          "args": [
            { "type": "variable", "value": "x" },
            { "type": "number", "value": -18 }
          ]
        }
      ]
    }
  ]
}
```

### 8.3 多项式

`f(x) = y_e + 0.01·(x − x_e)³`

<!-- AST-VALID -->
```json
{
  "type": "add",
  "args": [
    { "type": "number", "value": 0 },
    {
      "type": "mul",
      "args": [
        { "type": "number", "value": 0.01 },
        {
          "type": "pow",
          "args": [
            {
              "type": "sub",
              "args": [
                { "type": "variable", "value": "x" },
                { "type": "number", "value": -18 }
              ]
            },
            { "type": "number", "value": 3 }
          ]
        }
      ]
    }
  ]
}
```

### 8.4 三角函数

`f(x) = y_e + 0.5·sin(0.2·(x − x_e))`

<!-- AST-VALID -->
```json
{
  "type": "add",
  "args": [
    { "type": "number", "value": 0 },
    {
      "type": "mul",
      "args": [
        { "type": "number", "value": 0.5 },
        {
          "type": "sin",
          "args": [
            {
              "type": "mul",
              "args": [
                { "type": "number", "value": 0.2 },
                {
                  "type": "sub",
                  "args": [
                    { "type": "variable", "value": "x" },
                    { "type": "number", "value": -18 }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

### 8.5 复合

`f(x) = y_e + 0.1·(exp(0.05·(x − x_e)) − 1) + 0.3·sin(0.4·(x − x_e))`

<!-- AST-VALID -->
```json
{
  "type": "add",
  "args": [
    { "type": "number", "value": 0 },
    {
      "type": "add",
      "args": [
        {
          "type": "mul",
          "args": [
            { "type": "number", "value": 0.1 },
            {
              "type": "sub",
              "args": [
                {
                  "type": "exp",
                  "args": [
                    {
                      "type": "mul",
                      "args": [
                        { "type": "number", "value": 0.05 },
                        {
                          "type": "sub",
                          "args": [
                            { "type": "variable", "value": "x" },
                            { "type": "number", "value": -18 }
                          ]
                        }
                      ]
                    }
                  ]
                },
                { "type": "number", "value": 1 }
              ]
            }
          ]
        },
        {
          "type": "mul",
          "args": [
            { "type": "number", "value": 0.3 },
            {
              "type": "sin",
              "args": [
                {
                  "type": "mul",
                  "args": [
                    { "type": "number", "value": 0.4 },
                    {
                      "type": "sub",
                      "args": [
                        { "type": "variable", "value": "x" },
                        { "type": "number", "value": -18 }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

---

## 9. 构造技巧：让函数严格经过 Emitter

数值上最稳的写法是把函数写成「以 Emitter 为原点的增量」：

```text
u = x − x_e
f(x) = y_e + g(u)，其中 g(0) = 0
```

这样 `f(x_e) = y_e + g(0) = y_e` 是**恒等式**，不受浮点累积误差影响。
上文 §8.2–§8.5 全部采用这种形式。

不要用「先算系数再回代」的方式硬凑 `f(x_e) = y_e`，容易在 1e-6 容差边缘失败。

---

## 10. 错误码速查

| 错误码 | 含义 |
|---|---|
| `PARSE_ERROR` | `dsl` 不是合法 JSON |
| `NOT_AN_OBJECT` | 节点不是对象 / 缺少 `type` |
| `UNSUPPORTED_OPERATOR` | 不在白名单内 |
| `FORBIDDEN_OPERATOR` | 被禁止的运算符 |
| `BAD_ARITY` | 元数不对 |
| `BAD_VALUE` | `number.value` 非有限 / `variable.value` 不是 `"x"` 或缺失 |
| `CONST_TOO_LARGE` | 常数超过 1000 |
| `NODE_LIMIT` | 节点数超过 128 |
| `DEPTH_LIMIT` | 深度超过 12 |
| `EMPTY_DOMAIN` | 有效攻击范围为空 |
| `DOMAIN_ERROR` | 定义域问题（除零 / 负数开方 / 非正取对数） |
| `NOT_FINITE` | 出现 `NaN` / `Infinity`，或 `|f|` 超过 1e6 |
| `DISCONTINUOUS` | 函数不连续 |
| `NOT_C2` | 不满足 C¹ / C²，或斜率过大 |
| `CONVEXITY_LIMIT` | 凸性变号次数超过 100 |
| `OSCILLATION_LIMIT` | 振荡过快，无法可靠采样 |
| `NOT_THROUGH_SHOOTER` | `|f(x_e) − y_e| > 1e-6` |

---

## 11. 本地自检

```bash
python3 competitor-kit/tools/validate_submission.py ./my-algorithm
```

该命令使用与官方 Preflight **同一套** parser / validator 与沙箱执行路径。
详见 [README.md](README.md)。
