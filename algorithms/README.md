<div align="right">

**English** | <a href="./README.zh-CN.md">简体中文</a>

</div>

# algorithms/ — Canonical Factory Algorithm Slots (**Read-Only Fixture**)

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

> **Factory state = copy of canonical starter.** Both slots in this directory are byte-for-byte identical to
> [`../starter/`](../starter/) out of the box; `tests/algorithm-slot.ts` and
> `tests/operator-e2e.ts` assert this, so don't modify only one side.

## Rules

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

## Upload and Replacement (Spec §31/§32)

Tournament operators **will NOT** unzip archives directly into slots. The official process is:

```text
staging → validate → preflight → hash → seal → replace
```

- `<slot-root>/.staging/` — Upload staging area, bad packages are rejected here;
- `<slot-root>/.slots/` — Installation records (hash / install time / preflight conclusion / upload origin).

In official tournaments `<slot-root>` = `runs/slots` (see above). These two directories **are not part of the algorithm package**,
they are gitignored, and they do not enter the package hash or get copied into sandboxes.
Slot replacement is non-destructive: when validation fails, the existing slot remains unchanged.

## Local Testing for Participants

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
