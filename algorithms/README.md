# algorithms/ —— 固定算法槽位

本目录是 V1.1 冻结的**唯一算法投放区**（规范 §2/§3/§31/§32/§41）。

```text
algorithms/
├── team-a/          → Team A Algorithm Slot
│   ├── solver.py        ← 唯一正式入口（必需）
│   └── manifest.json    ← 算法包清单（必需，见下）
└── team-b/          → Team B Algorithm Slot
    ├── solver.py
    └── manifest.json
```

> **出厂状态 = canonical starter 的副本。** 两个槽位开箱即与
> [`../starter/`](../starter/) 逐文件一致；`tests/algorithm-slot.ts` 会断言这一点，
> 所以不要单独改某一侧。

## 规则

- 每个槽位根目录**必须**存在 `solver.py`，它是唯一正式入口（规范 §3/§4）。
  不允许 `main.py` / `run.py` / `algorithm.py` 之类的自定义入口。
- **`manifest.json` 是算法包清单，必需**（`name` / `version` / `entry` / `language`）。
  上传流水线用 `inspectPackage` 校验包形态，缺清单的目录在 `validate` 阶段就会被拒绝；
  `entry` 必须写 `solver.py`（自定义入口会被明确拒绝）。
  > 历史说明：早期版本的本目录曾只有 `solver.py`。规范 §3 的措辞是「**至少**包含
  > `solver.py`」，即允许附加文件 —— 清单是其中之一，不是额外约束。
- 除清单与入口外，**允许**携带自己的内部模块与子目录（见下）。
- 允许携带自己的内部模块与子目录：

  ```text
  team-a/
  ├── solver.py
  ├── optimizer.py
  ├── geometry.py
  └── utils/
      └── ...
  ```

- 两个槽位结构必须完全一致（规范 §2）。
- 启动命令固定（规范 §6），双方唯一差异是 `--team`：

  ```bash
  python3 solver.py --team A \
    --public  /input/public_state.json \
    --reveal  /input/reveal_state.json \
    --output  /output/result.json
  ```

- 结果**只能**写 `--output` 指定的 `result.json`，且只含 `schema_version` 与 `dsl`
  两个键（规范 §25/§26）；stdout 不是结果通道（规范 §24）。

## 上传与替换（规范 §31/§32）

赛事方**不会**把压缩包直接解压到槽位。正式流程是：

```text
staging → validate → preflight → hash → seal → replace
```

- `algorithms/.staging/` —— 上传暂存区，坏包在这里就被拦住；
- `algorithms/.slots/` —— 安装记录（哈希 / 安装时间 / preflight 结论）。

这两个目录**不属于算法包**，已被 `.gitignore` 忽略，也不会进入包哈希或被复制进沙箱。
替换槽位是非破坏性的：验证失败时现有槽位一个字节都不会变。

## 参赛者本地自测

```bash
python3 algorithms/team-a/solver.py --team A \
  --public  <某个 public_state.json> \
  --reveal  <配对的 reveal_state.json> \
  --output  /tmp/result.json
cat /tmp/result.json
```

最简模板见 [`../starter/solver.py`](../starter/solver.py)；两个槽位出厂即为该模板的副本。
