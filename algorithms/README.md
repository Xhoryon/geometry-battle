<!-- bilingual-doc: zh-CN + en-US -->

# algorithms/ —— canonical 出厂算法槽位（**只读 fixture**）

# algorithms/ — Canonical Factory Algorithm Slots (**Read-Only Fixture**)

> **本目录不是投递点。**
>
> 正式比赛的算法投递点是 **运行期槽位根 `runs/slots`**（`runs/slots/team-a|team-b`）。
> 三个入口（`npm run app` / `npm run judge` / `npm run operator`）默认都读它，
> 可以用 `--slots <dir>` 换。
>
> 本目录是**出厂 fixture**：内容受 git 跟踪、语义上只读。首次启动时，运行期槽位根
> 若为空会从它**播种一次**；之后**再也不会参考它** —— 改这里的文件
> **不会**改变比赛用的算法。要让比赛换算法，必须投递进运行期槽位根
> （`/judge` 的「Advanced · 替换算法与比赛设置」，或直接写 `runs/slots/team-a|team-b`）。
>
> 裁判台的「算法槽位」面板会显示**投递点路径 + 算法名 + 来源 + 包哈希**，
> 投的是不是你要的那份，当场可对。

> **This directory is NOT the submission point.**
>
> The official submission point for algorithms is **runtime slot root `runs/slots`** (`runs/slots/team-a|team-b`).
> All three entry points (`npm run app` / `npm run judge` / `npm run operator`) read from it by default,
> and you can switch with `--slots <dir>`.
>
> This directory is the **factory fixture**: its content is tracked by git and semantically read-only. On first startup, if the runtime slot root
> is empty, it will **seed once** from here; after that it **never consults this directory again** — modifying files here
> **will NOT** change the algorithms used in matches. To switch algorithms in a match, you must submit to the runtime slot root
> (via `/judge` "Advanced · Replace Algorithm & Match Config", or directly write to `runs/slots/team-a|team-b`).
>
> The judge panel "Algorithm Slots" will display **submission path + algorithm name + origin + package hash**,
> so you can verify on the spot whether it's the one you intended.

```text
algorithms/                     ← 出厂 fixture（受 git 跟踪，只读语义）
├── team-a/                     → Team A Slot（出厂内容）
│   ├── solver.py               ← 唯一正式入口（必需）
│   └── manifest.json           ← 算法包清单（必需，见下）
└── team-b/                     → Team B Slot（出厂内容）
    ├── solver.py
    └── manifest.json

runs/slots/                     ← 运行期槽位根 = **正式投递点**（被 .gitignore 忽略）
├── team-a/                     → Team A Algorithm Slot
├── team-b/                     → Team B Algorithm Slot
├── .staging/                   ← 上传暂存区（不属于算法包）
└── .slots/                     ← 安装记录（不属于算法包）
```

```text
algorithms/                     ← Factory fixture (git-tracked, read-only semantics)
├── team-a/                     → Team A Slot (factory content)
│   ├── solver.py               ← Sole official entry point (required)
│   └── manifest.json           ← Algorithm package manifest (required, see below)
└── team-b/                     → Team B Slot (factory content)
    ├── solver.py
    └── manifest.json

runs/slots/                     ← Runtime slot root = **Official Submission Point** (gitignored)
├── team-a/                     → Team A Algorithm Slot
├── team-b/                     → Team B Algorithm Slot
├── .staging/                   ← Upload staging area (not part of algorithm package)
└── .slots/                     ← Installation records (not part of algorithm package)
```

> **出厂状态 = canonical starter 的副本。** 本目录的两个槽位开箱即与
> [`../starter/`](../starter/) 逐文件一致；`tests/algorithm-slot.ts` 与
> `tests/operator-e2e.ts` 会断言这一点，所以不要单独改某一侧。

> **Factory state = copy of canonical starter.** Both slots in this directory are byte-for-byte identical to
> [`../starter/`](../starter/) out of the box; `tests/algorithm-slot.ts` and
> `tests/operator-e2e.ts` assert this, so don't modify only one side.

## 规则

## Rules

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
- **单轮计算预算 500 ms**，从本队收到 `GO` 的时刻起算（Rule Revision 3 §11）：
  未在预算内交出合法的 `result.json` 记 `TIMEOUT`。

- Each slot root directory **must** contain `solver.py`, which is the sole official entry point (Spec §3/§4).
  Custom entry points like `main.py` / `run.py` / `algorithm.py` are not allowed.
- **`manifest.json` is the algorithm package manifest and is required** (`name` / `version` / `entry` / `language`).
  The upload pipeline validates package shape with `inspectPackage`; directories missing the manifest are rejected at the `validate` stage;
  `entry` must be `solver.py` (custom entry points are explicitly rejected).
  > Historical note: Early versions of this directory contained only `solver.py`. Spec §3 states "**at least**
  > `solver.py`", which allows additional files — the manifest is one of them, not an extra constraint.
- Beyond the manifest and entry point, you **may** include your own internal modules and subdirectories (see below).
- You may include your own internal modules and subdirectories:

  ```text
  team-a/
  ├── solver.py
  ├── optimizer.py
  ├── geometry.py
  └── utils/
      └── ...
  ```

- Both slots must have identical structure (Spec §2).
- The startup command is fixed (Spec §6); the only difference between the two sides is `--team`:

  ```bash
  python3 solver.py --team A \
    --public  /input/public_state.json \
    --reveal  /input/reveal_state.json \
    --output  /output/result.json
  ```

- Results **must** be written only to the `result.json` specified by `--output`, containing only `schema_version` and `dsl`
  keys (Spec §25/§26); stdout is not a result channel (Spec §24).
- **Single-round computation budget is 500 ms**, counted from the moment the team receives `GO` (Rule Revision 3 §11):
  failure to deliver valid `result.json` within budget is recorded as `TIMEOUT`.

## 上传与替换（规范 §31/§32）

## Upload and Replacement (Spec §31/§32)

赛事方**不会**把压缩包直接解压到槽位。正式流程是：

```text
staging → validate → preflight → hash → seal → replace
```

- `<槽位根>/.staging/` —— 上传暂存区，坏包在这里就被拦住；
- `<槽位根>/.slots/` —— 安装记录（哈希 / 安装时间 / preflight 结论 / 上传来源）。

正式比赛里 `<槽位根>` = `runs/slots`（见上）。这两个目录**不属于算法包**，
已被 `.gitignore` 忽略，也不会进入包哈希或被复制进沙箱。
替换槽位是非破坏性的：验证失败时现有槽位一个字节都不会变。

Tournament operators **will NOT** unzip archives directly into slots. The official process is:

```text
staging → validate → preflight → hash → seal → replace
```

- `<slot-root>/.staging/` — Upload staging area, bad packages are rejected here;
- `<slot-root>/.slots/` — Installation records (hash / install time / preflight conclusion / upload origin).

In official tournaments `<slot-root>` = `runs/slots` (see above). These two directories **are not part of the algorithm package**,
they are gitignored, and they do not enter the package hash or get copied into sandboxes.
Slot replacement is non-destructive: when validation fails, the existing slot remains unchanged.

## 参赛者本地自测

## Local Testing for Participants

出厂 fixture 里的 `solver.py` 可以直接当模板跑（它本身就是一个合法算法包）：

```bash
python3 algorithms/team-a/solver.py --team A \
  --public  <某个 public_state.json> \
  --reveal  <配对的 reveal_state.json> \
  --output  /tmp/result.json
cat /tmp/result.json
```

最简模板见 [`../starter/solver.py`](../starter/solver.py)；两个出厂槽位即为该模板的副本。
换成自己的算法后，请把它投递到 **`runs/slots/team-a|team-b`**（不是本目录）。

The `solver.py` in the factory fixture can be run directly as a template (it is itself a valid algorithm package):

```bash
python3 algorithms/team-a/solver.py --team A \
  --public  <some public_state.json> \
  --reveal  <matching reveal_state.json> \
  --output  /tmp/result.json
cat /tmp/result.json
```

The minimal template is at [`../starter/solver.py`](../starter/solver.py); both factory slots are copies of that template.
After replacing it with your own algorithm, submit it to **`runs/slots/team-a|team-b`** (not this directory).
