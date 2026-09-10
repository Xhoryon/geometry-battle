# Geometry Battle V1.1 — 参赛工具包（Competitor Kit）

这是你写算法需要的**全部**资料。读完这一页就可以开工。

```text
你要交付的：一个目录，根目录里有一个 solver.py
每轮它拿到：public_state.json + reveal_state.json
每轮它给出：一个数学函数 f(x)（写进 output/result.json）
```

---

## 1. 五分钟上手

```bash
# 1) 复制官方 starter 作为你的算法目录
cp -r competitor-kit/starter ./my-algorithm

# 2) 自检（必须全 PASS 再提交）
python3 competitor-kit/tools/validate_submission.py ./my-algorithm

# 3) 改 solver.py，重复第 2 步
```

自检输出长这样：

```text
── Team A ──
  Entrypoint         PASS 包根目录存在 solver.py
  Package            PASS 2 个文件 / 5969 字节 / hash=30cb9f2d1d22…
  Runtime            PASS sandbox-exec 可用，算法将在与官方比赛相同的沙箱内运行
  CLI / startup      PASS READY 握手成功，GO 已释放（release_ns=…）
  Input              PASS public_state.json (1439 B) + reveal_state.json (680 B)，sha256 绑定已由启动壳复核
  Result JSON        PASS schema_version="1.1"，键集合恰好为 {schema_version, dsl}
  DSL                PASS 结构合法（7 个节点）
  Function legality  PASS f(-6.4859) = 6.7318（Shooter 残差 0.00e+0），凸性变号 0，采样 2649 点
  Timeout            PASS 耗时 19.4 ms（上限 2000 ms）
── Team B ──
  …（同上）
PRE-FLIGHT PASS — 2 个队别 × 9 个分节全部通过
```

`PRE-FLIGHT PASS` 表示接口与函数合法性都没问题。判定代码与官方 Preflight 是**同一份**，
差别只在于官方用另一份 decoy 世界 —— 所以**不要把样例世界里的具体数值写死进算法**，
否则本地 PASS 不代表官方也 PASS。

---

## 2. 文件索引

| 文件 | 内容 | 什么时候看 |
|---|---|---|
| [ALGORITHM_REQUIREMENTS.md](ALGORITHM_REQUIREMENTS.md) | **主文档**：提交形态、启动契约、输入输出、MUST/SHOULD/MAY | 先读这个 |
| [RUNTIME_MANIFEST.md](RUNTIME_MANIFEST.md) | 沙箱里有什么 Python、哪些模块能用（**第三方包：无**） | 写 import 之前 |
| [DSL_SPECIFICATION.md](DSL_SPECIFICATION.md) | 函数 DSL 的全部节点、限制、错误码、合法/非法示例 | 构造函数之前 |
| [JSON_SCHEMA.md](JSON_SCHEMA.md) | 三个 JSON 文件的字段结构 + JSON Schema | 写解析代码之前 |
| [starter/solver.py](starter/solver.py) | 官方 starter（接口正确、可直接运行） | 一开始 |
| [examples/](examples/) | 真实引擎产出的输入/输出样例 | 想对照格式时 |
| [tools/validate_submission.py](tools/validate_submission.py) | 本地自检工具 | 每次提交前 |

---

## 3. 你只需要记住的六件事

1. **入口固定**：包根目录的 `solver.py`，四个参数 `--team / --public / --reveal / --output`。
2. **输入只走文件**：两份 JSON，由参数给出路径；stdin 不是输入通道。
3. **结果只走文件**：`{"schema_version":"1.1","dsl":<AST>}` 写进 `--output`；顶层只有这两个键，stdout 不是结果通道。
4. **函数必须经过自己的 Shooter**：`|f(x_s) − y_s| ≤ 1e-6`。用 `f(x) = y_s + g(x − x_s)` 这种增量写法最稳。
5. **没有第三方包**：`numpy` / `scipy` 在沙箱里**不可用**，只用标准库。
6. **2000 ms 内出结果**，每轮沙箱重建、不跨轮保存状态。

---

## 4. 提交格式

```text
my-algorithm/          ← 提交这个目录（不是 zip）
├── solver.py          ← 必须
├── manifest.json      ← 可选
└── 你的其它模块/数据
```

限制：≤ 8 MB、≤ 256 个文件、不允许符号链接，扩展名限
`.py .json .txt .md .csv .yaml .yml`。

---

## 5. 自检工具做了什么（以及它不是什么）

```bash
python3 competitor-kit/tools/validate_submission.py ./my-algorithm
python3 competitor-kit/tools/validate_submission.py ./my-algorithm --team A
python3 competitor-kit/tools/validate_submission.py ./my-algorithm --json
```

它把你的算法放进**真实的沙箱**（`sandbox-exec`，与正式比赛同一套），用一份
**与比赛无关的 decoy 世界**跑一遍，然后逐项检查九个分节。

判定逻辑**不是**在工具里重新实现的（那必然会与平台漂移）——
它调用的就是平台生产代码本身：

```text
inspectPackage / buildPublicState / buildRevealState
prepareSandbox / spawnRunner / parseResultFile
parseCanonicalDSL / validateAttackFunction
```

所以：**本地自检的规则 == 官方 Preflight 的规则**，是同一份代码，不是两份要人工同步的规则表。

它**不检查**策略强度：能通过自检只说明接口和函数合法性没问题，不代表你能赢。

需要 Node.js（比赛仓库自带）；Python 前端只是调用它。

---

## 6. 官方 Preflight 与本地自检的关系

| | 本地自检 | 官方 Preflight |
|---|---|---|
| 判定代码 | 同一份 | 同一份 |
| 沙箱 | 真实沙箱 | 真实沙箱 |
| 世界 | 固定 decoy 种子（可复现） | `matchId` 派生的 decoy 世界 |
| 队别 | A、B 各跑一次 | 按你的槽位跑一次 |
| 结论 | `PRE-FLIGHT PASS` / `FAIL` | `Preflight: PASS` / `FAIL` |

两者都**不会**泄漏比赛信息：decoy 世界与正式比赛的种子无关。

---

## 7. 版本与冻结

```text
协议版本      1.1
Runtime       CPython 3.9.6，第三方包 NONE
DSL           14 个白名单节点，节点 ≤128 / 深度 ≤12 / 常数 ≤1000
结果通道      output/result.json（唯一）
计时          各自 GO 起算，2000 ms
比赛终止      ELIMINATION（STALEMATE: NOT YET IMPLEMENTED）
```

`competitor-kit/` 里的每一份文件都由平台测试持续核对：

- `tests/competitor-kit.ts` —— 文档示例、引用完整性、examples 防漂移、CRASH 可读性、starter 首跑
- `tests/runtime-manifest.ts` —— Manifest 声称可 import 的模块，在真实沙箱里必须真的可 import

也就是说：**这一页写的东西，有测试在盯着它不许过期。**
