# JSON Schema Reference

本文件描述三个正式 JSON 文件的字段结构。字段来自**真实引擎**产出，
并由 `tests/competitor-kit.ts` 持续核对（真实样例的键集合必须与本文件的机器可读块一致）。

对应的真实样例见：

- [`examples/public_state.json`](examples/public_state.json)
- [`examples/reveal_state.json`](examples/reveal_state.json)
- [`examples/result.json`](examples/result.json)

> 这三份文件是**逐字节**的引擎产物（单行紧凑 JSON，无尾随换行），
> 由 `npx ts-node src/operator/generate-kit-examples.ts` 重新生成，
> 并由 `tests/competitor-kit.ts` 比对防漂移。
> 样例取自 **round 1**，所以 `points[].alive` 全为 `true`；
> 从 round 2 起，被击杀的点会以 `"alive": false` 继续留在 `points` 里（规范 §5）。

---

## 0. 机器可读字段表

测试读取这个块并核对真实样例。

```json
{
  "schema_version": "1.1",
  "public_state": {
    "required": ["schema_version", "match_id", "round", "map", "emitters", "points"],
    "map_fields": ["xmin", "xmax", "ymin", "ymax"],
    "emitter_fields": ["A", "B"],
    "emitter_point_fields": ["x", "y"],
    "point_fields": ["id", "team", "x", "y", "alive"],
    "forbidden": ["seed", "map_seed", "obstacles", "shooters", "map_hash"]
  },
  "reveal_state": {
    "required": ["schema_version", "match_id", "round", "public_state_sha256", "obstacles"],
    "obstacle_rectangle_fields": ["id", "type", "xmin", "xmax", "ymin", "ymax"],
    "obstacle_circle_fields": ["id", "type", "cx", "cy", "radius"]
  },
  "result": {
    "required": ["schema_version", "dsl"],
    "only_keys": ["schema_version", "dsl"]
  }
}
```

---

## 1. `public_state.json`

**位置**：由 `--public` 参数给出（不要硬编码路径）。
**时机**：PUBLIC 阶段生成；此时隐藏信息（障碍物、地图种子）尚未写入。
**两队拿到的字节完全相同。**

> **Revision 3 变化**：`emitters` 进入了 public。固定 Emitter 是整场比赛不变的
> **公开**结构，不是隐藏信息 —— 因此在 PUBLIC 阶段就能看到，不需要等揭盲。

| 字段 | 类型 | 说明 |
|---|---|---|
| `schema_version` | string | 恒为 `"1.1"` |
| `match_id` | string | 本场比赛标识 |
| `round` | integer | 轮次（正式轮从 1 开始；Preflight 用 0） |
| `map` | object | 场地边界 |
| `map.xmin` / `map.xmax` | number | `-20` / `20` |
| `map.ymin` / `map.ymax` | number | `-12` / `12` |
| `emitters` | object | 双方**固定 Emitter** 的坐标（整场不变） |
| `emitters.A` / `emitters.B` | object | `{ "x": number, "y": number }` —— 你本轮的发射锚点 |
| `points` | array | **全部战斗点**，**包含死点**（**不含 Emitter**） |
| `points[].id` | string | 如 `"A1"` / `"B3"`（编号不固定，见 §4） |
| `points[].team` | string | `"A"` 或 `"B"` |
| `points[].x` / `points[].y` | number | 坐标 |
| `points[].alive` | boolean | `false` 表示该点已被击杀 |

**public 里没有的东西**（不要去找）：

```text
障碍物、地图种子（seed / map_seed）、地图哈希
```

> `points` 里**不会**出现 Emitter。它是发射锚点，不是战斗点：
> 不计入存活数、不能被击杀、也不能作为打击目标（Revision 3 §3/§7）。

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "public_state.json",
  "type": "object",
  "required": ["schema_version", "match_id", "round", "map", "emitters", "points"],
  "additionalProperties": false,
  "properties": {
    "schema_version": { "const": "1.1" },
    "match_id": { "type": "string" },
    "round": { "type": "integer", "minimum": 0 },
    "emitters": {
      "type": "object",
      "required": ["A", "B"],
      "additionalProperties": false,
      "properties": {
        "A": { "type": "object", "required": ["x", "y"], "additionalProperties": false,
               "properties": { "x": { "type": "number" }, "y": { "type": "number" } } },
        "B": { "type": "object", "required": ["x", "y"], "additionalProperties": false,
               "properties": { "x": { "type": "number" }, "y": { "type": "number" } } }
      }
    },
    "map": {
      "type": "object",
      "required": ["xmin", "xmax", "ymin", "ymax"],
      "additionalProperties": false,
      "properties": {
        "xmin": { "type": "number" }, "xmax": { "type": "number" },
        "ymin": { "type": "number" }, "ymax": { "type": "number" }
      }
    },
    "points": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "team", "x", "y", "alive"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string" },
          "team": { "enum": ["A", "B"] },
          "x": { "type": "number" }, "y": { "type": "number" },
          "alive": { "type": "boolean" }
        }
      }
    }
  }
}
```

---

## 2. `reveal_state.json`

**位置**：由 `--reveal` 参数给出。
**时机**：REVEAL 阶段生成。
**语义**：这是**增量**文件 —— 它不重复 `points` / `map` / `alive` / `emitters`，只补充隐藏信息。

> **Revision 3 变化**：`shooters` 已从 reveal 删除。每轮的 Shooter Selection 是旧规则，
> 已被固定 Emitter 取代；发射锚点改在 `public_state.emitters` 里给出。
> REVEAL 现在**只剩障碍物**这一项隐藏信息。

| 字段 | 类型 | 说明 |
|---|---|---|
| `schema_version` | string | 恒为 `"1.1"` |
| `match_id` | string | 与 public 相同 |
| `round` | integer | 与 public 相同 |
| `public_state_sha256` | string | public 文件**字节**的 SHA-256（绑定用） |
| `obstacles` | array | 本轮障碍物 |

`obstacles[]` 有两种形态（用 `type` 区分）：

| type | 字段 |
|---|---|
| `"rectangle"` | `id`, `type`, `xmin`, `xmax`, `ymin`, `ymax` |
| `"circle"` | `id`, `type`, `cx`, `cy`, `radius` |

> 发射锚点不在 reveal 里 —— 它在 `public_state.emitters` 里**直接给出坐标**，
> 而且整场比赛都是同一个值。你不需要（也无法）从任何点表里反查它。

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "reveal_state.json",
  "type": "object",
  "required": ["schema_version", "match_id", "round", "public_state_sha256", "obstacles"],
  "additionalProperties": false,
  "properties": {
    "schema_version": { "const": "1.1" },
    "match_id": { "type": "string" },
    "round": { "type": "integer", "minimum": 0 },
    "public_state_sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
    "obstacles": {
      "type": "array",
      "items": {
        "oneOf": [
          {
            "type": "object",
            "required": ["id", "type", "xmin", "xmax", "ymin", "ymax"],
            "additionalProperties": false,
            "properties": {
              "id": { "type": "string" }, "type": { "const": "rectangle" },
              "xmin": { "type": "number" }, "xmax": { "type": "number" },
              "ymin": { "type": "number" }, "ymax": { "type": "number" }
            }
          },
          {
            "type": "object",
            "required": ["id", "type", "cx", "cy", "radius"],
            "additionalProperties": false,
            "properties": {
              "id": { "type": "string" }, "type": { "const": "circle" },
              "cx": { "type": "number" }, "cy": { "type": "number" },
              "radius": { "type": "number" }
            }
          }
        ]
      }
    }
  }
}
```

### 绑定校验（推荐）

```python
import hashlib, json
public_bytes = open(args.public, "rb").read()
reveal = json.load(open(args.reveal))
assert hashlib.sha256(public_bytes).hexdigest() == reveal["public_state_sha256"]
```

绑定失败时平台会拒绝本轮输入（Bootstrap 在启动阶段就会退出）。
普通算法**不需要**自行校验，但校验一次是廉价的自保。

---

## 3. `result.json`

**位置**：由 `--output` 参数给出。
**要求**：顶层**只有**两个键；多一个键即判非法。

| 字段 | 类型 | 说明 |
|---|---|---|
| `schema_version` | string | 必须精确为 `"1.1"` |
| `dsl` | object 或 string | 函数 AST（见 [DSL_SPECIFICATION.md](DSL_SPECIFICATION.md)） |

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "result.json",
  "type": "object",
  "required": ["schema_version", "dsl"],
  "additionalProperties": false,
  "properties": {
    "schema_version": { "const": "1.1" },
    "dsl": { "type": ["object", "string"] }
  }
}
```

写入方式见 [ALGORITHM_REQUIREMENTS.md](ALGORITHM_REQUIREMENTS.md) 的「结果提交」章节
（临时文件 + 原子替换）。

---

## 4. 不要假设的事情

- **不要假设点数固定**：每队点数在 6–10 之间变化。
- **不要假设点位编号固定**：`A1` / `B1` 只是初始编号，会随击杀减少；
  发射锚点则是 `public_state.emitters` 里的**常量**，与点位无关。
- **不要假设障碍物数量或类型固定**：可能 0 个，可能多个；当前类型为 `rectangle` / `circle`。
- **不要根据 JSON 字段顺序推断语义**：解析用键名，不要用位置。
- **不要根据数组顺序推断策略信息**：`points` 的顺序不携带含义。
- **不要依赖地图种子**：它不在 public 里，你拿不到。

---

## 5. 自检

```bash
python3 competitor-kit/tools/validate_submission.py ./my-algorithm
```

工具会用与官方 Preflight 相同的路径校验你的 `result.json`。
