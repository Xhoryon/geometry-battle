<div align="right">

**English** | <a href="./README.zh-CN.md">简体中文</a>

</div>



**An educational algorithm competition sandbox for computational geometry,
algorithm optimization, and AI-assisted programming.**



---

## Overview



**English.** Both teams submit one algorithm package each, installed into two permanent
slots — `runs/slots/team-a` and `runs/slots/team-b`. The **runtime slot root** is the
official delivery point; the `algorithms/` directory in the repo is only a factory
fixture (see §1). Each round the platform injects **byte-identical** input files into
both sandboxes (`public_state.json` → `reveal_state.json`), and each algorithm returns
one curve `y = f(x)`. The curve leaves that team's **Fixed Emitter** and kills an
opponent point when it passes exactly through it, within range.

Judging is done by the platform's single canonical Judge — algorithms never decide the
outcome themselves. **Not one line of contestant code runs before START**, and results
are delivered only through `output/result.json`; stdout is **not** an IPC channel
(see [the algorithm protocol](#2-algorithm-protocol-two-phase-input-files--argv)).


### V1.2 rules at a glance




**English.** The **only** rule change from V1.1 is the Fixed Emitter: it is no longer a
platform constant but is **chosen before the match by each team from its own points**.
Everything else is unchanged.

| Item | Value |
|------|-----|
| Attack function | One `y = f(x)` per round; it must pass exactly through your own Emitter (`\|f(x_e) − y_e\| ≤ 1e-6`) |
| Fixed Emitter | Chosen and locked by each team from its own starting points **before the match**; fixed for the whole match; a **mathematical anchor**, not a combat point and not killable. Coordinates are in `public_state.emitters[team]` |
| Combat points | Each side's own points (including dead ones, `alive: false`). An opponent combat point that is **alive**, inside range, and passed exactly through by the curve is killed |
| Obstacles / boundary | The trajectory **ends permanently at first obstacle contact**; field is `x ∈ [-20, 20]`, `y ∈ [-12, 12]` |
| Compute budget | **500 ms** per side, measured from that side's own GO write; also 512 MB / 1 core / 1 thread |
| `STALEMATE` | **20** consecutive rounds with **0** kills on both sides combined → DRAW |
| `HARD_ROUND_LIMIT` | Reaching round **60** (whatever the position) → DRAW |

The four end reasons (`ELIMINATION` / `MUTUAL_ELIMINATION` / `STALEMATE` /
`HARD_ROUND_LIMIT`) cover every case; the decision is inside the engine, so no entry
point can produce a match that never terminates — see
[field & judging](#6-field--judging).


---

## Capabilities & versions




**English.** The platform is currently **V1.4**, which stacks four layers:

- **V1.1 — frozen rules and judging.** The two-phase input protocol
  (`public_state.json` → `reveal_state.json`), the 14-operator DSL whitelist, the 500 ms
  compute budget, sandbox isolation with a fair start, and the four-way termination
  guarantee.
- **V1.2 — Interactive Tournament Experience.** Participant pages (`/team/a` `/team/b`),
  browser upload of algorithm packages (ZIP / folder / a single `solver.py`), **each team
  choosing and locking this match's Fixed Emitter before the match**, the organiser
  reading uploaded source in the Web UI, a phase-driven judge wizard, a
  **server-enforced Tournament Mode** (no platform-shipped algorithm may play), and
  per-team capability access tokens.
- **V1.3 — Bilingual Localization.** Chinese and English across all four screens (judge,
  participant, spectator, replay), with one shared language switch on each screen
  (persisted to `localStorage`, surviving refresh and route changes), plus this bilingual
  README.
- **V1.4 — Platform Fairness · Handbook · UX Refresh.** Permanent mirror-fairness tests
  (Levels 1–6, `tests/mirror-*.ts`) plus same-solver self-play / first-solver / map-distribution
  campaigns (verdict: mirror fairness PASS; slot, first-solver and map bias all DISPROVEN — see
  `docs/V1.4_FAIRNESS_REPORT.md`); the one platform asymmetry found (the
  Validator's sampling-grid anchor) is fixed; the competitor handbook gains "Orientation &
  Symmetry" and the `check_mirror.py` self-check; the frontend becomes a tournament system: a
  Home page `/` (choose your role + recent matches), a seven-stage judge wizard, a four-block /
  six-step participant page with an explicit LOCKED state, a scoreboard-style spectator screen,
  a replay player, one status design system and connection-state model, 406 bilingual strings
  per locale, and a four-viewport sweep.

**Exactly two locales are supported, `zh-CN` and `en-US`, resolved in this order: saved
choice → browser language → fallback.** A `zh-*` browser gets Chinese; **everything else
gets English**; a manual choice overrides automatic detection.

---

## Quick Start

### Algorithm package structure (fixed slots, fixed entry)


```
runs/slots/                     ← runtime slot root (official delivery point; ignored by .gitignore)
├── team-a/                     → Team A Algorithm Slot
│   └── solver.py               
├── team-b/                     → Team B Algorithm Slot
│   └── solver.py
├── .staging/                   
└── .slots/                     
```



**manifest.json (optional):**

```json
{
  "name": "My Team",
  "version": "1.0.0",
  "entry": "solver.py",
  "language": "python"
}
```




```
Upload → staging → validate → preflight → hash → seal → replace
```


**English.** A package goes into one of two **permanent** slots. The official delivery
point is the **runtime slot root** (`runs/slots/`, git-ignored); the entry point is
frozen to `solver.py` at the package root — `main.py`, `run.py` or `my_solver.py` are
no longer accepted, and the platform does **not** read `manifest.entry` to decide what
to run. Internal modules and subdirectories (`optimizer.py`, `utils/`…) are allowed.
`manifest.json` is **optional** metadata; if you write `entry`, the only accepted value
is `solver.py` — anything else is rejected explicitly rather than silently ignored.

> **Why not `algorithms/`?** The install pipeline replaces `team-a` / `team-b` wholesale
> via rename. Operating on `algorithms/` would mean a real match rewrites
> **git-tracked** files. So `algorithms/team-a|b` is a tracked, read-only **factory
> fixture**: the runtime slot root is seeded from it once on first start and never
> consulted again. Changing `algorithms/` will not change the algorithm a match runs.

Package limits and the non-destructive upload pipeline:

| Item | Limit |
|------|-------|
| Package size | ≤ 8 MB |
| File count | ≤ 256 |
| Allowed extensions | `.py` `.json` `.txt` `.md` `.csv` `.yaml` `.yml` |
| Symlinks | Not allowed |
| Entry | **`solver.py` at the package root** |

```
Upload → staging → validate → preflight → hash → seal → replace
```

The organiser never unpacks an archive straight into a slot. If any step fails
(bad structure, won't run, illegal output) the existing slot does not change by a
single byte; the bad package stays in `<slot root>/.staging/`. Slot metadata (install
time, package hash, preflight result, upload source) lives in `<slot root>/.slots/`,
which is **not part of the package** — it is excluded from the package hash and is never
copied into a sandbox.


### Algorithm protocol (two-phase input files + argv)


```
python3 solver.py --team A \
  --public  <sandbox>/input/public_state.json \
  --reveal  <sandbox>/input/reveal_state.json \
  --output  <sandbox>/output/result.json
```



```json
{"schema_version": "1.1", "dsl": {"type": "add", "args": [...]}}
```






`public_state.json`：

```json
{"schema_version":"1.1","match_id":"M-1","round":4,"map":{"xmin":-20,"xmax":20,"ymin":-12,"ymax":12},"emitters":{"A":{"x":-18,"y":0},"B":{"x":18,"y":0}},"points":[{"id":"A1","team":"A","x":-14,"y":6,"alive":true},{"id":"A2","team":"A","x":-10,"y":-3,"alive":false}]}
```

`reveal_state.json`：

```json
{"schema_version":"1.1","match_id":"M-1","round":4,"public_state_sha256":"92fa…","obstacles":[{"id":"O1","type":"rectangle","xmin":-1,"xmax":2,"ymin":-5,"ymax":1},{"id":"O2","type":"circle","cx":4,"cy":3,"radius":2}]}
```



```python
import hashlib
assert hashlib.sha256(open(a.public, "rb").read()).hexdigest() == reveal["public_state_sha256"]
```



```
PRE-REVEAL   public_state.json in place (with Fixed Emitter), algorithm process not yet created
   ↓
REVEAL       reveal_state.json generated (obstacles), algorithm still not running
   ↓  judge presses START (can pause as long as needed; no effect on fairness)
START        host releases algorithm process now → countdown 3-2-1 → GO → compute
```





```python
import argparse, hashlib, json, os

ap = argparse.ArgumentParser()
ap.add_argument("--team", required=True, choices=["A", "B"])
ap.add_argument("--public", required=True)
ap.add_argument("--reveal", required=True)
ap.add_argument("--output", required=True)
a = ap.parse_args()

raw = open(a.public, "rb").read()
public = json.loads(raw.decode("utf-8"))
reveal = json.load(open(a.reveal))
assert hashlib.sha256(raw).hexdigest() == reveal["public_state_sha256"]  # binding self-check
```

**English.** The platform no longer writes state to stdin. Each round the host starts
the algorithm process with exactly four arguments:

```
python3 solver.py --team A \
  --public  <sandbox>/input/public_state.json \
  --reveal  <sandbox>/input/reveal_state.json \
  --output  <sandbox>/output/result.json
```

**Team identity travels only through `--team A|B`.** The two JSON files are
**byte-identical** for A and B, so either side can verify them with `sha256`
independently. Apart from the value of `--team`, filenames, argument order, runtime and
I/O format are identical for both sides.

The algorithm writes its result **only** to the file given by `--output`:

```json
{"schema_version": "1.1", "dsl": {"type": "add", "args": [...]}}
```

`dsl` may be an AST object or a JSON string of one. Result-file constraints:

| Constraint | Meaning |
|------|------|
| Exactly two keys | `schema_version` (must be `"1.1"`) and `dsl`; `hits` / `winner` / `computeTime` and the like are all illegal |
| Atomic write | Write `result.json.tmp`, `flush` + `fsync`, then atomically `rename` to `result.json` |
| Deadline | A complete, legal file within 500 ms is accepted; otherwise TIMEOUT |
| ONE OUTPUT ONLY | One result per round — you cannot resubmit |
| stdout | **Not** a result channel; it is captured, length-capped and archived only |
| stderr | Limited debug logging allowed; length-capped, never part of judging |

Input is delivered in two phases:

| Phase | File | Contents |
|------|------|------|
| PRE-REVEAL | `public_state.json` | Round, field, **both teams' Fixed Emitter coordinates**, **all points on both sides** (including `alive: false` dead ones); **no** obstacles, no map seed |
| REVEAL | `reveal_state.json` | Delta: the obstacles, plus `public_state_sha256` |

> **V1.2 §1: the anchor is chosen by each team, not a platform constant, and not a
> per-round "Shooter".** Before the match each side picks one of **its own starting
> points** and locks it. Once locked it is **fixed for the whole match**, cannot be
> killed, is not counted in alive totals and is not a win condition — it is only the
> **mathematical anchor** of the attack function, not a combat point, and therefore
> **not in `points`** (the chosen point is removed from `points`).
>
> Both coordinates become public only **after both sides have locked**; from then on
> `public_state.json`'s `emitters` holds the same pair every round. Before that, a
> caller **without that team's token cannot obtain your choice from the server at all**
> — it is not hidden by the frontend, the server does not send it (see
> [access tokens](#access-tokens-v12-rotated-every-match)). There is no `shooters`
> field in `reveal_state.json`, and there never will be.

Binding self-check (worth copying into your entry point):

```python
import hashlib
assert hashlib.sha256(open(a.public, "rb").read()).hexdigest() == reveal["public_state_sha256"]
```

`roundStateHash = SHA256(publicStateHash + revealStateHash)` (concatenate the two hex
strings, then hash) is written into the match log and the replay, so it can be
re-verified independently afterwards; the exact bytes of the two files are the `sha256`
field values and can be checked with `shasum -a 256`.

**Three-phase rhythm (this is what makes it fair):**

```
PRE-REVEAL   public_state.json in place (with the Fixed Emitter); no process created
   ↓
REVEAL       reveal_state.json produced (obstacles); the algorithm still is not running
   ↓  the judge presses START (it may sit here as long as it likes — no effect on fairness)
START        only now does the host release the process → 3-2-1 countdown → GO → compute
```

There is no per-round manual point selection and no SHOOTER LOCK: the anchor is chosen
and locked once before the match and then fixed. Timing is measured from **each side's
own** GO write.

> **Preflight uses decoy anchors.** The pre-match sandbox smoke run uses a decoy world
> unrelated to this match, and the anchors it hands out come from **the first point of
> each side on the decoy map** — per-match coordinates, not platform constants. An
> algorithm with **hard-coded coordinates** is therefore stopped at Preflight
> (`NOT_THROUGH_SHOOTER`) instead of failing in the real match. The local self-check
> tool follows the same rule.


```python
# Emitter is chosen for this match (varies per match), must read from public, do not hard-code coordinates
s = public["emitters"][a.team]
enemies = [p for p in public["points"] if p["team"] != a.team and p["alive"]]
t = enemies[0]

# f(x) = y_e + m·(x - x_e): passes exactly through own Emitter, and is C^∞
m = 0.0 if abs(t["x"] - s["x"]) < 1e-6 else (t["y"] - s["y"]) / (t["x"] - s["x"])

dsl = {
    "type": "add",
    "args": [
        {"type": "number", "value": s["y"]},
        {"type": "mul", "args": [
            {"type": "number", "value": m},
            {"type": "sub", "args": [{"type": "variable", "value": "x"},
                                     {"type": "number", "value": s["x"]}]},
        ]},
    ],
}

# the only official output channel: tmp + atomic rename (stdout is not IPC)
tmp = a.output + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump({"schema_version": "1.1", "dsl": dsl}, f)
    f.flush()
    os.fsync(f.fileno())
os.replace(tmp, a.output)
```


### DSL whitelist





**English.** Fourteen operators in total:

| Kind | Operators |
|------|--------|
| Leaves | `number` (`value` is numeric), `variable` (`value` must be `"x"`) |
| Binary | `add` `sub` `mul` `div` `pow` |
| Unary | `neg` `sin` `cos` `tan` `sqrt` `log` `exp` |

**Forbidden:** `if` / `else` / `switch` / `?:`, `min` / `max` / `floor` / `ceil` /
`round` / `sign` / `abs` / `step` / `Heaviside`, and any boolean or comparison
operation.

> `abs` / `min` / `max` are forbidden because they can create a non-differentiable
> corner at a point, breaking the C² continuity assumption and making "number of
> convexity sign changes" meaningless.





**English.**

| Limit | Value |
|------|-----|
| AST nodes | ≤ 128 |
| AST depth | ≤ 12 |
| Constant magnitude | ≤ 1000 |
| Convexity sign changes (within the firing interval) | ≤ 100 |
| Anti-aliasing sample budget | ≤ 400,000 points |
| Compute timeout | **500 ms** (each side, from its own GO write) |
| Memory | 512 MB |
| CPU / threads | 1 core / 1 thread (`OMP_NUM_THREADS` etc. all pinned to 1) |
| stdout | 256 KB |
| stderr | 64 KB |

**Hard function requirements:** the curve must pass through your **Fixed Emitter**
(`|f(x_e) − y_e| ≤ 1e-6`, `ε = HIT_EPSILON`) and be finite, continuous and C² over the
firing interval. `x_e` / `y_e` are the **per-match chosen** anchor coordinates — read
them from `public_state.emitters[team]`, never hard-code them. The firing interval
starts at the anchor: A is `x ∈ [x_e, 20]`, B is `x ∈ [-20, x_e]`.
(Note: this 1e-6 and the 1e-6 in hit detection are two **different** things.)


### Frozen runtime (identical for both sides)






**English.** A real match freezes one runtime, item by item identical for both sides:

| Item | Frozen value |
|------|--------|
| Interpreter | CPython 3.9.6 (`/usr/bin/python3`) |
| Third-party packages | **NONE** (standard library only; `numpy` / `scipy` / `sympy` are simply unavailable) |
| CPU quota | 1 core |
| Memory quota | 512 MB |
| Thread cap | 1 (`OMP_NUM_THREADS` / `OPENBLAS_NUM_THREADS` / `MKL_NUM_THREADS` / `NUMEXPR_NUM_THREADS` / `VECLIB_MAXIMUM_THREADS`) |
| Timeout | 500 ms |

The single source of truth for this list is `FROZEN_RUNTIME` in
`src/submission/Runtime.ts`. At match start the platform **measures** the host
interpreter and compares it with the list; the result goes into the audit log (a
`RuntimeFrozen` event). A mismatch does not block the match — it is recorded honestly
for human review.

> **Why "no third-party packages":** the sandbox's `scrubEnv` sets
> `PYTHONNOUSERSITE=1`, and SBPL denies reading `/Users`, so a user-level `numpy` /
> `scipy` on the development machine **cannot be imported** inside the sandbox.
> Early documentation listed the host's `numpy 2.0.2` / `scipy 1.13.1` as frozen
> dependencies — but those packages are **unavailable** inside the sandbox. That was a
> **host observation**, and it would have led contestants to write algorithms that must
> fail with `ModuleNotFoundError`. It has been corrected. The
> authoritative list of modules available inside the sandbox is
> `competitor-kit/RUNTIME_MANIFEST.md`, verified item by item in a real sandbox by
> `tests/runtime-manifest.ts`.

The thread cap is a fairness requirement: by default BLAS/OpenMP saturate every core,
and "whose machine has more cores" would become a timing advantage.


### Field & judging





**English.**

- Field: `x ∈ [-20, 20]`, `y ∈ [-12, 12]`
- Team zones: A `x ∈ [-20, -4]`, B `x ∈ [4, 20]`
- Attack direction: A toward `+x`, B toward `-x`
- **Traversal direction:** the Judge walks the graph in the attack direction — A from `x_e` towards `x = 20` (increasing x), B from `x_e` towards `x = -20` (decreasing x); that interval is the firing domain and function legality is checked only there. "Before the first contact" is direction-relative: for B, "before" means larger x
- **Array order:** `points` lists Team A first, then Team B, each in generation order, identical every round; dead points stay in place (`alive: false`), the two points locked as Emitters are removed and ids are **not renumbered** (`A1` may be absent); `obstacles` are `O1..On` in generation order and never change. **Do not assume array order is geometric order** (not sorted by x or by distance)
- **Both sides:** the same formal submission MUST run correctly as Team A and as Team B. Self-check with `python3 competitor-kit/tools/validate_submission.py <dir>` (the same judging code as the official Preflight, run once per team) and `python3 competitor-kit/tools/check_mirror.py <dir>` (mirror consistency — a development diagnostic the official Preflight does not run)
- **Hit:** `|f(x_p) − y_p| ≤ 1e-6`, the point is in the attack direction, and it lies **before the first obstacle contact**
- **Obstacles:** the trajectory ends at the first contact with any obstacle; points before the contact can be killed, the contact point and everything after it are unaffected
- **First mover:** whichever side returns a legal solution first fires first; the other fires afterwards
- **Locked attack right:** after START each side gets one independent, irrevocable attack for the round. The Fixed Emitter is only the **mathematical anchor** of the attack function; it **never dies** (it is not in `points`) and the function must still satisfy `f(x_e) = y_e`. The only reasons an attack does not execute are `TIMEOUT` / `INVALID` / `CRASH`.
- **Mutual destruction:** if both sides reach zero alive at the end of the same round it is a **DRAW** (`endReason = MUTUAL_ELIMINATION`) — being the first mover must not hand you the win

**Termination guarantee: the four end reasons cover every case, so every legal match
ends in finite time.** The decision lives inside the engine and is not a caller-supplied
option — therefore no entry point (terminal judge console, Web UI) can produce a match
that never terminates.

| End reason | Trigger | Result |
|---|---|---|
| `ELIMINATION` | One side reaches zero alive while the other still has points | Survivor wins |
| `MUTUAL_ELIMINATION` | Both sides reach zero at the end of the same round | DRAW |
| `STALEMATE` | **20 consecutive rounds with 0 kills on both sides combined** | DRAW |
| `HARD_ROUND_LIMIT` | Reaching **round 60** (whatever the position) | DRAW |

The stalemate counter resets on **kills** — not on hits, and not on who moved first:
both sides submitting legal solutions that hit nothing still counts as stalemate.
A draw is a draw — the platform has no hidden scoring and no tiebreak.


---

## Running

### Local Web UI (recommended)

```bash
npm install
npm run app          # build frontend → start service → bind 127.0.0.1:17800 → auto-open browser
```



**English.** No terminal needed for the normal flow.

| Route | Token | Purpose |
|---|---|---|
| `/` | No | **Home** (V1.4): choose your role (Judge / Team A / Team B / Spectator) + recent matches. The judge and team cards say an access link is required (paste a link or token — it navigates via the URL fragment only, is never stored and never enters the query string); **navigation visibility ≠ authorization** |
| `/team/a` `/team/b` | **Yes** (that team's) | **Participant page**: four blocks (Algorithm / Source / Emitter / Status), six steps (Upload → Validate → Preflight → Pick → Lock → Wait for start); upload ZIP / folder / a single `solver.py` → read-only browse of your own source → pick and lock this match's Fixed Emitter; after locking the block reads **LOCKED · cannot be changed for this match** |
| `/judge` | **Yes** (the judge's) | Judge console (seven-stage phase-driven wizard: Match Setup → Algorithm Ready → Emitter Lock → Ready → Reveal → Running → Match End): exactly one primary action per stage, everything else under Advanced; at Match End the primary control is "This match's replay", and **reset / new match needs a two-step confirm** (it clears both Emitter locks and rotates the matchId and participant links). The uploaded source can be read here |
| `/spectator` | No | Spectator screen (scoreboard layout: Team A alive · Emitter │ Round · phase │ Team B alive · Emitter; arena centred; footer A compute │ first solver │ B compute; a terminal band TEAM X WINS / DRAW · reason · ROUND N that never covers the last frame). **Read-only**, no button other than the language switch, no diagnostics at all |
| `/replays` | No | List of finished matches (winner / end reason / rounds / ended at), linking into replays |
| `/replay/:matchId` | No | Replay player: previous / play·pause / next / Round N of M / timeline / 0.5× 1× 2× (animation speed only); replays the stored match/replay **without re-running any algorithm, recomputing any function or re-judging** |


### Access tokens (V1.2, rotated every match)









**English.** `/judge` and `/team/*` both require an access token. It is **not a
username/password** — it is a capability: **whoever holds it can act as that side.**

| Surface | Token |
|---|---|
| Judge console | **Judge token** — process lifetime. Rotating it every match would lock the organiser out of their own open page after one new-match |
| Participant page | **That team's** token, derived as `HMAC(judge token, matchId + team)`. It **expires every match**, because the previous match's people should not keep access to the next one |

How to use it:

1. After `npm run app`, the **terminal prints the judge link** (like
   `http://127.0.0.1:17800/judge#t=…`) and opens it. The token sits in the URL
   **fragment**, which is not sent to the server — so it never reaches the request
   line, the `Referer`, or any log.
2. The judge console's **"Participant entry"** panel gives two copyable links
   (`/team/a#t=…`, `/team/b#t=…`). Send each team its own.
3. **Both links are reissued for every new match** and the old ones stop working
   immediately. The participant page says so plainly ("this match's token is no longer
   valid") and tells the player to ask for a new link — it does not reconnect forever.

> ⚠ **Do not share the judge link.** The judge board legitimately shows both sides'
> choices, so holding the judge token means holding both teams' authority plus the
> ability to issue reveal / START / reset / install. It is for the **organiser**, not
> for players.

The judge console's **main flow is "use the algorithm in the slot"**: once players have
delivered to the **runtime slots** `runs/slots/team-a|team-b`, the judge starts a match
in two clicks without knowing any file path. The two team cards at the top of `/judge`
show the **algorithm name, sealed hash (short form), source status, Preflight, Emitter
lock and compute state**, so "is this the players' package?" is answerable at a glance;
the file list under "Audit · Source review" can be opened file by file to **read the
source directly**. No server absolute path is shown anywhere in the UI.

There are two ways to swap an algorithm: deliver to the runtime slot root (the formal
flow), or type an absolute directory path **on the server** under
`Advanced · replace algorithm & match settings` (temporary). Both write to the same
place.

> Delivering into the repo's `algorithms/` does **not** affect a match — that is only a
> factory fixture.


### Tournament Mode (V1.2, on by default)




```bash
npm run app -- --no-tournament   # development self-test: allow factory starter to play
```



```bash
npm run app:dev      # dev mode: service + vite dev server (HMR)
npm run e2e          # Playwright browser full match rehearsal (real algorithms + real browser)
```


**English.** A real match **does not allow a platform-shipped algorithm to play.** The
server checks four entry points; if the computed package hash hits the **platform
distribution tree** (`starter/`, `algorithms/team-*`, `competitor-kit/starter`,
`demo/*`, `playtest/competitors/*`) it is refused:

| Entry point | Behaviour |
|---|---|
| Participant upload | **Authorise before installing** — on refusal the slot is not written by a single byte |
| `install` (Advanced, by path) | Refused, slot untouched |
| `use-slot` | A bundled algorithm sitting in the slot cannot be sealed into the match |
| `prepare` (the wizard's main button) | Same — this is the easiest one to bypass |

This is not "grey out the button": a button's `enabled` is only a hint. The real refusal
happens **at execution time**, and a direct `POST` cannot get around it.

```bash
npm run app -- --no-tournament   # development only: allow the factory starter to play
```

> `--no-tournament` is for **development smoke testing only**. With it on, a "real
> match" can end up running the template algorithm.
>
> The terminal operator console (`src/operator/cli.ts`) is a dedicated entry point where
> the operator names `--a/--b` explicitly, so it cannot silently fall back to the
> template — it has no such switch.

The server binds `127.0.0.1` only and validates Host + Origin on command requests
(blocking cross-site control and DNS rebinding).

```bash
npm run app:dev      # dev mode: server + vite dev server (HMR)
npm run e2e          # Playwright browser rehearsal of a full match (real algorithms + real browser)
```

> The browser rehearsal uses the **system-installed Google Chrome** by default
> (`channel: 'chrome'`). To use Playwright's bundled engine instead, delete `channel`
> from `web/e2e/playwright.config.ts` and run `npx playwright install chromium` once.


### Terminal (fallback, equivalent to the Web UI)

```bash
npm install

# operator console (official entry) — directly use algorithms ready in slots
npx ts-node src/operator/cli.ts
npx ts-node src/operator/cli.ts --seed 42 --points 8 --difficulty hard
npx ts-node src/operator/cli.ts --auto                              # unattended

# upload new algorithm to slot (staging → validate → preflight → hash → seal → replace)
npx ts-node src/operator/cli.ts --a ./pkgA --b ./pkgB
npx ts-node src/operator/cli.ts --a ./pkgA --slots /tmp/gb-slots    # use different slot root directory

npx ts-node src/operator/cli.ts --replay ./artifacts/matches/<id>   # read-only replay

# type checking (platform + server; frontend has separate typecheck:web)
npm run typecheck
npm run typecheck:web

# regression tests (38 suites, see tests/run-all.ts for list)
npm test
npm test -- web-projection web-server      # run only specified suites

# map generator stress validation (default 300,000 maps)
npm run stress
```

**English.** Every entry point uses `runs/slots` by default and takes `--slots <dir>` to
point elsewhere. `npm test` runs the regression suites (see `tests/run-all.ts` for the
list); `npm test -- <suite> <suite>` runs only the named ones. `npm run stress` is the
map-generator stress check.

---

## Repository structure

```
geometry-battle/
├── runs/              
│   └── slots/         
│       ├── team-a/    
│       ├── team-b/    #     Team B Slot
│       └── .staging/ .slots/   
├── algorithms/        
│   ├── team-a/        
│   └── team-b/        
│                      
├── src/
│   ├── core/          # Ast / Validator / Judge / Match / Round / Rules / RoundState / InputProtocol / Logs
│   ├── field/         
│   ├── obstacle/      
│   ├── map/           
│   ├── submission/    
│   ├── runner/        
│   ├── operator/      
│   ├── ui/            
│   ├── visualizer/    
│   └── server/        
├── web/               
│   ├── src/           
│   └── e2e/           
├── starter/           
├── demo/              
├── tests/             
└── docs/              
```

**English.** `runs/slots/` is the runtime state and the official delivery point (and is
git-ignored). `algorithms/` is the tracked factory fixture — first start seeds
`runs/slots` from it once, and changing it afterwards does not change the algorithm a
match runs. `src/core/` holds the engine and the canonical Judge; `src/server/` is the
local Web server (HTTP + WS + MatchSession); `web/` is the frontend (React + Vite +
Canvas 2D); `tests/` holds the regression suites and algorithm fixtures;
`docs/` contains rules, architecture, release notes, and fairness reports.


---

## Where the local Web UI stops







**English.** The Web UI is a **wrapper**, not a second engine. Three structural
constraints:

1. **The server adds no judging of its own.** Every command in `src/server/` is one call
   into `MatchEngine` (or `MatchSetupUI`, shared with the terminal console), and every
   board field is a copy of an engine query. Hit / first-mover / kills / winner /
   stalemate are computed nowhere else. *The UI must not guess a second rule set* —
   a button's enabling condition is copied line by line from the condition the engine
   itself uses (e.g. `startMatch()` really requires "both uploaded + `preflightDone`",
   so the UI reads `isPreflightPassed()` and must **not** infer it from something like
   `phase === 'READY'`).
2. **The spectator board is a per-field whitelist.** `spectatorBoard()` constructs every
   field explicitly; anything not copied the browser **never receives**. "The big screen
   leaks no developer diagnostics" is therefore a transport-layer fact, not a convention
   someone has to maintain. Two regressions guard it: `tests/web-projection.ts` (the key
   set is pinned) and `tests/web-server.ts` (scans the spectator channel after a real
   match).
3. **Per-team isolation is also at the transport layer.** `teamBoard()` is another
   per-team whitelist: the opponent's choice, slot, source and package hash are all
   absent. **And the server first confirms you are entitled to ask for that team** —
   trimming the payload by team is not enough, because that is "answer anyone, with
   different contents"; without a token anyone could ask as the other team. See
   [access tokens](#access-tokens-v12-rotated-every-match), regression in
   `tests/team-auth.ts`.

> The judge board is the **authoritative view** and **legitimately** contains both
> sides' choices (the judge needs them to run the match). So the isolation boundary is
> "who receives which board", not "does a board contain a given field".

Trajectories follow the same principle: **the canvas only consumes trajectory points the
engine has already judged.** The browser reveals them frame by frame and never evaluates
the function — re-evaluating would draw a curve straight through an obstacle, whereas the
real trajectory ends permanently at first contact.


---

## Isolation & fairness


**English.**

- Every computation runs in its own `sandbox-exec` sandbox: deny by default, deny
  network, deny `fork`. Inside is a **four-zone** layout — `app/` (read-only package),
  `input/` (the two read-only input JSONs, 0444), `output/` (write-only `result.json`),
  `work/` (writable scratch, the only writable directory).
- Write access grants only `file-write-data` / `file-write-create` /
  `file-write-unlink` (enough for tmp + fsync + atomic rename, overwrite, creating
  subdirectories, writing `__pycache__`). **`utimes` is denied** — an algorithm cannot
  roll back its own result file's timestamp, and the timing endpoint is that file's
  mtime; if contestant code could rewrite it, timing could be forged.
- The platform source directory, sealed-package directories, the **algorithm slot
  directories**, `/Users`, the sandbox root and the opponent's sandbox are all
  unreadable.
- Host environment variables are not inherited (only `PATH`/`HOME`/`TMPDIR`/`LANG`/
  `LC_ALL`/`PYTHON*`/`GB_TEAM`, plus the thread-count variables pinned to 1).
- **START is a hard gate:** after REVEAL the algorithm process is still held back until
  the judge presses START. Computing without START is refused by the engine
  (`tests/stage-gating.ts`, `tests/pre-start-execution.ts`). The judge may sit between
  REVEAL and START as long as it likes; that has no effect on fairness.
- **Preflight uses a decoy world:** the pre-match smoke run uses a map generated from a
  seed derived from `matchId`, unrelated to the actual match seed (it re-rolls on
  collision), so it cannot become a preview of this round's obstacles. The audit log
  records both `decoySeed` and `matchSeed` (`tests/preflight-decoy.ts`).
- Fair start: the host writes GO to both sides only after both processes complete their
  READY handshake, and each Runner's compute latency and timeout budget start from
  **its own** GO. `startSkewUs` (audit field `startSkewNs`) is merely the gap between the
  two GO writes and never enters the timing. Before both writes, both pollers and
  timeout budgets are already armed by `prepare()` and the stdin write path is warmed;
  `stdin.end()` (the EOF signal, not part of timing) is deferred to the next tick —
  otherwise host overhead sandwiched between the two writes would be charged in full to
  **whichever side was written first**, a fixed-direction bias.
- **The anchor is taken after `write('GO')`:** delivery happens *inside* that call, and
  the write itself is not free (measured ~10.7 µs the first time, ~3.0 µs the second).
  The anchor used to be taken before the write, so the side released first was charged a
  whole write for free — the two GOs reached their processes only ~4–9 µs apart but were
  recorded as a 5–8 µs difference, systematically marking the first-released side as
  "slower" (7/7 observations had `aFasterRate` below 0.5). With the anchor at the actual
  delivery, `aFasterRate` returned to ~0.5; the permanent regression is the "GO anchor
  must be taken after write()" case in `tests/timing-fairness.ts`. Median `startSkewUs`
  is ~5 µs, an order of magnitude below the first-mover threshold `TIE_EPS_MS = 0.05`
  (50 µs).
- The timing endpoint is the moment the **result file itself was written** (`mtime`,
  nanoseconds), not when the host's polling callback ran: callbacks are serial, so
  whichever side returns first delays the other's reading (measured at ~100 µs during
  V1.1). `mtime` is stamped by the kernel, survives the rename, and cannot be forged
  because the sandbox denies `utimes`; when it is unavailable or inconsistent the poll
  time is used instead.
- `timing-fairness` verifies that slot and order confer no exploitable systematic
  advantage (with identical algorithms the "A was faster" rate is near 0.5 and the
  win-rate gap under swapping is bounded). It is **not** a guarantee of absolute
  fairness.
- A fresh sandbox is used every round and the whole directory is destroyed afterwards
  (no cross-round persistence).


---

## Reproducibility




**English.** A match can be **re-verified independently after the fact**, without
re-running any algorithm:

- `match.json` / `audit.json` / `replay.json` land in `artifacts/matches/<matchId>/`;
- `roundStateHash = SHA256(publicStateHash + revealStateHash)` is recorded per round.
  Anyone holding those two input files can verify **what the algorithms actually saw**
  with `shasum -a 256`;
- a replay consumes only the stored trajectories and results — it **never re-runs an
  algorithm, re-evaluates a function, or recomputes a judgement**;
- the engine's judging is deterministic: same input + same frozen runtime ⇒ same result.

The reference solver has its own regression, `tests/demo-repro`: one **byte-faithful**
input is run ten times down each path — **direct execution** and the **official
sandbox** — and the results must be byte-identical to each other *and* to the shot that
match actually submitted. The fixture's sha256 is also compared against the hash the
engine recorded at the time, so a "reproduction input" that is not the input the
algorithm actually received cannot go unnoticed.

---

## Known limitations


**English.**

- **Stalemate and termination** are the engine's job, see "Termination guarantee" above:
  both STALEMATE (20 consecutive kill-free rounds) and HARD_ROUND_LIMIT (round 60) end
  as a DRAW with a normal match end — there is no "runs forever, judge decides". The
  operator console's `--max-rounds` (defaulting to the engine's own hard limit, 60) is
  only a safety rail on the console side and does not change engine judging. The shipped
  starter playing itself does reach STALEMATE (neither side goes around obstacles) —
  that is a legal draw, not a hang; a real opponent should still replace the starter.
- Uploading with the console's `--a/--b` **installs the algorithm into the slot** (the
  formal §31/§32 flow). The default slot root is `runs/slots` (the runtime slot root
  your current installed build reports, git-ignored), so it does **not** dirty the
  working tree. Pass `--slots <dir>` to point elsewhere.
- This README describes the **V1.3** platform capabilities; final competition usability
  is subject to an independent audit.
- Localization (V1.3) covers every string the **Web layer** authors. Free-form
  diagnostic messages produced by the **server/engine** (tournament refusals, install
  pipeline errors, engine error text) still travel as the platform's canonical Chinese
  text: the browser's locale is presentation-only and must not enter the competition
  payload, so those messages cannot be rendered per-client on the server. Structured,
  machine-readable fields — phase enums, action keys, error codes such as
  `NOT_THROUGH_SHOOTER` — are language-independent and unchanged.


---

## Release provenance



**English.** This repository is the **public release** of Geometry Battle, using an
independent sanitized history.

- **Public tags**: `v1.2.0`, `v1.3.0`, `v1.4.0`.
- **Internal audit provenance**:
  - V1.3 public distribution prepared from independently audited internal snapshot `febf1c69fb6cb78624811513149f477c4e30fac6`.
  - V1.4 public distribution prepared from independently audited internal snapshot `7f6e39d0d4faaa34ca48981aaee44f0213a52337`.
- **Public Git commit identifiers intentionally differ from internal SHAs** because the
  public repository uses a sanitized release history.
- Published tags are **never moved** and the history is **never rewritten** (no force
  push, no rebasing published commits).

---


### Positioning



**English.** Geometry Battle is an **educational algorithm competition sandbox** for:
**education** (classroom demos, self-study of the full platform-plus-algorithm loop);
**algorithm optimisation** (comparing search / fitting / geometry strategies under one
harness); **computational geometry experiments** (obstacle intersection, trajectory
termination, convexity analysis); **AI-assisted / vibecoding practice** (pairing with an
AI to produce a genuinely competitive package); and **programming competitions** (class,
club or self-organised matches).


### License






**English.** This project is licensed under the
**[PolyForm Noncommercial License 1.0.0](LICENSE)**; the full text is in
[`LICENSE`](LICENSE) at the repository root (byte-identical to the
[official text](https://polyformproject.org/licenses/noncommercial/1.0.0), not rewritten
in any way).

> **This is not an OSI-approved open source licence.** The accurate description is
> **source-available for noncommercial use**: the source is publicly visible and free to
> use for noncommercial purposes, but it does not satisfy the OSI open source
> definition's requirement of no field-of-use restriction. Please do not call it
> "open source" or "OSI-approved".

Under **noncommercial purposes** you may use, study, modify and redistribute this
project (original or modified) — for personal research, experiments and testing,
personal study, hobby projects, and use by charitable organisations, educational
institutions, public research institutions, public safety or health organisations,
environmental organisations and government institutions, **regardless of how they are
funded**. Redistribution must include these licence terms (or a URL pointing to them) —
see PolyForm's Notices clause.


### Commercial use



**English.** **Commercial use is not granted by this licence.** Using this project or a
modified version for commercial purposes — including but not limited to paid courses,
commercial training, commercial competition platforms, hosted services, consulting
deliverables, or integration into a commercial product — **requires a separate licence
from the author first.**


### Copyright

Copyright (c) 2026 Jiayi Huang — <https://github.com/Xhoryon>
