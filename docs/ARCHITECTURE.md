<div align="right">

**English** | <a href="./ARCHITECTURE.zh-CN.md">简体中文</a>

</div>

# ARCHITECTURE — Layers & Boundaries

> Structural constraints only, no history. Last updated: 2026-09-11.

---

## 1. Layers

```
                          ┌─────────────────────────┐
                          │   MatchEngine           │  ← Single source of truth
                          │   src/core/Match.ts     │
                          └───────────┬─────────────┘
                                      │ Read-only queries
        ┌─────────────────────────────┼─────────────────────────────┐
        │                             │                             │
   ┌────▼─────┐              ┌────────▼────────┐            ┌───────▼──────┐
   │ CLI      │              │  Web server      │            │  Tests       │
   │ operator/│              │  src/server/     │            │  tests/      │
   │ ui/      │              │  MatchSession    │            └──────────────┘
   └──────────┘              └────────┬─────────┘
                                      │ Board projection (field-by-field allowlist)
                             ┌────────▼─────────┐
                             │  Web frontend    │
                             │  web/src/        │  ← Zero logic, only render & clicks
                             └──────────────────┘
```

**Key point**: CLI and web server are **peer** entry points sharing `MatchSetupUI`
(`src/ui/MatchSetupUI.ts`) for the install/validate/start pipeline. The implementations
will diverge over time, so the web side does not rewrite it.

---

## 2. Three Hard Boundaries

### 2.1 Server adds no game logic

Every command in `src/server/` is **a single call** to `MatchEngine` (or `MatchSetupUI`);
every board field is a **copy** of an engine query result.

The comment at the top of `boards.ts` stating "snapshot must be pure in-memory, no IO"
is also a hard constraint: it runs every 100ms, and any filesystem access would turn
into ten hash operations per second.

### 2.2 Spectator board is a field-by-field allowlist

`spectatorBoard()` **explicitly constructs every field**. Fields not copied never reach
the browser — so "the public screen leaks no developer diagnostics" is a **structural
fact at the transport layer**, not a manually maintained convention.

Enforced by `tests/web-projection.ts` (key-set snapshot) and `tests/web-server.ts`
(running a full match and scanning all channels).

Deliberately excluded: package hash, package name, slot directory, seed, audit log,
isolation profile, any file path.

### 2.3 Frontend must not reimplement

**hit detection / obstacle・boundary semantics / winner / timing / stalemate**
— none may appear in the frontend. They are computed only in `MatchEngine`.

Two corollaries:

- **Availability comes only from the server.** Button `disabled` state reads
  `board.actions[].enabled`; phase name decides **which UI to show**, never whether
  a button should be clickable. V1.1's judge UI guessed availability from
  `phase === 'READY'` and broke (validation passed but match couldn't start).
- **Canvas consumes engine-computed trajectory points.** The browser only reveals
  them frame-by-frame at the reveal ratio; it **never re-evaluates the function**
  — re-evaluation would draw a curve passing through obstacles, while the real
  trajectory terminates permanently at the first obstacle contact.

---

## 3. Protocol Layer

`src/server/protocol.ts` holds **types and message names shared by server and browser**.

> **It must not import any Node built-in module or `src/core`.**
> Vite bundles it into the browser — importing Node dependencies breaks the frontend build.

Therefore `WirePoint` / `WireObstacle` / `WirePhase` are **structural mirrors** of core
types, not re-exports. Mirror drift is caught by **compile-time assertions** at the top
of `boards.ts`: if a real type gains a field but the mirror doesn't follow, `npm run typecheck`
fails immediately.

### Three Boards

| Board | Consumer | Characteristics |
|---|---|---|
| `SpectatorBoard` | `/spectator` | Field-by-field allowlist, **no** diagnostics |
| `JudgeBoard extends SpectatorBoard` | `/judge` | Adds slots, audit, runtime, `emitterSelection`, `SlotView.fileList` |
| `TeamBoard` | `/team/a` `/team/b` | Trimmed by team; opponent's pre-lock choice **not in payload** |

`TeamBoard`'s three hard rules are in its type comment; read that before changing it.

---

## 4. Sandbox & Isolation

Each computation runs in an isolated `sandbox-exec` sandbox: deny-by-default, deny network,
deny `fork`.

Four-zone layout: `app/` (read-only algorithm package), `input/` (two read-only JSONs, mode 0444),
`output/` (write-only `result.json`), `work/` (writable scratch space, the only writable directory).

Several **immutable** design points (each has a regression test):

- Write permissions limited to `file-write-data` / `file-write-create` / `file-write-unlink`;
  **`utimes` is denied** — otherwise an algorithm could rewind the result file's mtime,
  but timing ends precisely at that mtime.
- **Timing ends at the result file's own write timestamp** (mtime, nanosecond precision),
  not the host's polling callback timestamp. Polling callbacks are serial; whichever returns
  first delays the other's reading.
- **Timing anchor is after `write('GO')`**, not before. Delivery happens inside that call,
  and the write itself isn't free; anchoring before the write would give the side that
  releases first a free write duration. Regression in `tests/timing-fairness.ts`.
- **START is a hard gate**: After REVEAL, algorithm processes are still held until the
  judge presses START.
- **Preflight uses a decoy world**: Seed derived from `matchId`, unrelated to the actual
  match seed. Decoy anchors come from `decoyEmitters(map)` (first point for each team on
  the decoy map); **input delivered to the algorithm and input used by engine self-check
  are identical** (`Match.ts:1567`, `LocalPreflight.ts:350`). They used to differ, causing
  false divergence ("local self-check passes, official Preflight fails"); regression in
  `tests/preflight-decoy.ts` (decoy anchors follow same rules as real match anchors).

---

## 5. Complete Timing Sequence for One Computation

```
PRE-REVEAL   public_state.json in place (with this round's anchors), no algorithm process yet
   ↓
REVEAL       reveal_state.json generated (obstacles), algorithm still not running
   ↓  Judge presses START (can pause arbitrarily long; pause duration doesn't affect fairness)
START        Host releases algorithm processes now → countdown 3-2-1 → GO → computation
```

`roundStateHash = SHA256(publicStateHash + revealStateHash)` is written to match log and replay;
can be independently verified afterward with `shasum -a 256`.

---

## 6. Engine Resolution Order Within One Round

1. Both sides compute in their own sandboxes; timing starts from **each side's** GO write timestamp.
2. Whichever submits a valid solution first fires first (within `TIE_EPS_MS = 0.05` counts as
   simultaneous; both sides settle **simultaneously**).
3. For each side: starting from own anchor, evaluate within firing interval → find **first obstacle
   contact / leaving the field** → before that point, opponent's **alive** combat points in the
   attack direction satisfying `|f(x_p) − y_p| ≤ 1e-6` are eliminated.
4. After settlement, check termination: `ELIMINATION` / `MUTUAL_ELIMINATION` / `STALEMATE` /
   `HARD_ROUND_LIMIT`.

**`resolveOrderedShots` has no "cancel" branch** — the first-mover eliminating an opponent point
**does not** terminate the opponent's process; the opponent's attack still executes. This conclusion
came from V1.1 playtesting (speed became the only victory path) and has been abolished in the rules.
