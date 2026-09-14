# DSL Specification

<div align="right">

**English** | <a href="./DSL_SPECIFICATION.zh-CN.md">简体中文</a>

</div>

---

This document is the **formal specification** of the function DSL, derived directly from the platform's parser and validator.
All examples are verified line by line against the real parser / validator through permanent regression tests (`tests/competitor-kit.ts`).

**Example annotation conventions (verified line by line by `tests/competitor-kit.ts`):**

| Annotation | Meaning |
|---|---|
| `AST-VALID` | Passes both parser **and** function validity checks |
| `AST-PARSE-OK` | Parser accepts only (fragment example, full validity not asserted) |
| `AST-INVALID: <CODE>` | Rejected with error code `<CODE>` |

---

## 1. Result File Format

```text
output/result.json
```

```json
{
  "schema_version": "1.1",
  "dsl": <AST>
}
```

- Top level MUST contain **only** these two keys. Any additional key makes it invalid.
- `schema_version` MUST be exactly the string `"1.1"`.
- `dsl` can be either the AST object itself, or a JSON **string** of the AST (both are accepted).

---

## 2. Node Representation

Each node is a JSON object:

```json
{ "type": "<node_type>", "value": <number_or_string>, "args": [<child_nodes>...] }
```

- The canonical key is `type`; `op` is accepted as an alias (`{"op":"add",...}` is equivalent to `{"type":"add",...}`).
- `number` nodes use `value` (finite numeric value).
- `variable` nodes MUST explicitly include `"value": "x"` (see §3).
- Operator nodes use `args` array, with length exactly matching the operator's arity.

---

## 3. Allowed Node Types (All 14 Types)

| type | arity | field | description |
|---|---|---|---|
| `number` | 0 | `value: number` | Finite constant, `|value| ≤ 1000` |
| `variable` | 0 | `value: "x"` | MUST be explicit and can only be `"x"` |
| `add` | 2 | `args` | Addition |
| `sub` | 2 | `args` | Subtraction |
| `mul` | 2 | `args` | Multiplication |
| `div` | 2 | `args` | Division |
| `pow` | 2 | `args` | Power |
| `neg` | 1 | `args` | Negation |
| `sin` | 1 | `args` | Sine |
| `cos` | 1 | `args` | Cosine |
| `tan` | 1 | `args` | Tangent |
| `sqrt` | 1 | `args` | Square root |
| `log` | 1 | `args` | Natural logarithm |
| `exp` | 1 | `args` | Exponential |

### The Only Valid Form for variable

<!-- AST-PARSE-OK -->
```json
{ "type": "variable", "value": "x" }
```

The following forms are ALL rejected (older documentation used `name`, now deprecated):

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

> Frozen rule: missing `value`, using `name` as the key, or a value other than `"x"` all result in `INVALID`.
> The platform will no longer silently interpret a missing `value` as `x`.

---

## 4. Forbidden Node Types

The following types are ALL rejected (error code `FORBIDDEN_OPERATOR`). They can all construct piecewise / non-smooth behavior:

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

## 5. Unknown Operators

Any type name not in the §3 whitelist is rejected with error code `UNSUPPORTED_OPERATOR`:

<!-- AST-INVALID: UNSUPPORTED_OPERATOR -->
```json
{ "type": "tanh", "args": [{ "type": "variable", "value": "x" }] }
```

---

## 6. Structural Limits

| Limit | Value | Error Code |
|---|---|---|
| Total nodes | ≤ 128 | `NODE_LIMIT` |
| Nesting depth | ≤ 12 | `DEPTH_LIMIT` |
| Constant absolute value | ≤ 1000 | `CONST_TOO_LARGE` |
| Arity must be exact | binary 2 / unary 1 | `BAD_ARITY` |
| Constants must be finite | reject `NaN` / `Infinity` | `BAD_VALUE` |

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

> Depth definition: leaves (`number` / `variable`) have depth 1; each wrapping operator adds 1.
> Exceeding 12 layers causes rejection at the 13th layer, and the parser will not expand it.

---

## 7. Function Validity (Numerical Checks)

A structurally valid AST must also pass numerical validation. Validation is performed on the **valid attack range**:

```text
Team A: x ∈ [x_e, 20] (x_e is the Emitter's x coordinate)
Team B: x ∈ [-20, x_e]
```

The validation interval is the Judge's traversal interval: Team A traverses from `x_e` towards `x = 20` (increasing x), Team B from `x_e` towards `x = -20` (decreasing x); the function itself is still a plain `y = f(x)` — the team only decides which segment the platform looks at, and in which direction (see [ALGORITHM_REQUIREMENTS.md](ALGORITHM_REQUIREMENTS.md) §6.2).

The numerical checks sample on a grid that also starts at your own Emitter and walks in the attack direction with step `h` to the field edge (identical for both sides since V1.4): the two teams' sample points are exact mirrors of each other, so the same shot written as an A function or as its B mirror gets the same verdict and the same error code.

| Requirement | Criterion | Error Code |
|---|---|---|
| MUST pass through own fixed Emitter | `|f(x_e) − y_e| ≤ 1e-6` | `NOT_THROUGH_SHOOTER` |
| Finite within attack range | `|f(x)|` finite and ≤ 1e6 at sample points | `NOT_FINITE` |
| Valid domain | e.g., `sqrt` of negative, `log` of non-positive, division by zero | `DOMAIN_ERROR` |
| Continuous | Jump detection | `DISCONTINUOUS` |
| C¹ (first derivative continuous) | Jump detection | `NOT_C2` |
| C² (second derivative continuous) | Jump detection | `NOT_C2` |
| Not abnormally steep | `|f'| ≤ 1e10` | `NOT_C2` |
| Convexity sign changes | ≤ 100 | `CONVEXITY_LIMIT` |
| Oscillation is sampleable | Anti-aliasing sample count ≤ 400000 | `OSCILLATION_LIMIT` |

### Emitter Tolerance

```text
|f(x_e) − y_e| ≤ 1e-6
```

This is the tolerance for **function validity**, and is a **separate concept** from "hit detection": hit detection belongs to Judge rules and is not part of the algorithm interface. Do not confuse the two.

<!-- AST-INVALID: NOT_THROUGH_SHOOTER -->
```json
{ "type": "number", "value": 2 }
```

> The example above, under Team A's Emitter (`public_state.emitters.A`, assuming `y_e = 0`),
> gives `f(x_e) = 2 ≠ 0`, so it does not pass.

---

## 8. Valid Examples

The following examples uniformly use:

```text
Team A, this round's Emitter E = (x_e, y_e)   ← read from public_state.emitters
Valid attack range x ∈ [x_e, 20]
```

> For readability, the examples below write `(x_e, y_e)` concretely as `(-18, 0)`.
> **That is just an example**: real coordinates vary by round; code MUST read from `public_state.emitters`.

### 8.1 Constant

<!-- AST-VALID -->
```json
{ "type": "number", "value": 0 }
```

### 8.2 Linear

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

### 8.3 Polynomial

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

### 8.4 Trigonometric

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

### 8.5 Composite

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

## 9. Construction Technique: Making Functions Strictly Pass Through the Emitter

Numerically, the most stable approach is to write the function as "increments from the Emitter as origin":

```text
u = x − x_e
f(x) = y_e + g(u), where g(0) = 0
```

This way `f(x_e) = y_e + g(0) = y_e` is an **identity**, unaffected by floating-point accumulation errors.
All examples in §8.2–§8.5 above follow this form.

Do not use the "calculate coefficients then substitute back" approach to force `f(x_e) = y_e`, as it can easily fail at the 1e-6 tolerance boundary.

---

## 10. Error Code Quick Reference

| Error Code | Meaning |
|---|---|
| `PARSE_ERROR` | `dsl` is not valid JSON |
| `NOT_AN_OBJECT` | Node is not an object / missing `type` |
| `UNSUPPORTED_OPERATOR` | Not in whitelist |
| `FORBIDDEN_OPERATOR` | Forbidden operator |
| `BAD_ARITY` | Wrong arity |
| `BAD_VALUE` | `number.value` not finite / `variable.value` not `"x"` or missing |
| `CONST_TOO_LARGE` | Constant exceeds 1000 |
| `NODE_LIMIT` | Node count exceeds 128 |
| `DEPTH_LIMIT` | Depth exceeds 12 |
| `EMPTY_DOMAIN` | Valid attack range is empty |
| `DOMAIN_ERROR` | Domain issue (division by zero / negative sqrt / non-positive log) |
| `NOT_FINITE` | `NaN` / `Infinity` appears, or `|f|` exceeds 1e6 |
| `DISCONTINUOUS` | Function not continuous |
| `NOT_C2` | Does not satisfy C¹ / C², or slope too large |
| `CONVEXITY_LIMIT` | Convexity sign changes exceed 100 |
| `OSCILLATION_LIMIT` | Oscillates too fast, cannot sample reliably |
| `NOT_THROUGH_SHOOTER` | `|f(x_e) − y_e| > 1e-6` |

---

## 11. Local Self-Check

```bash
python3 competitor-kit/tools/validate_submission.py ./my-algorithm
```

This command uses the **same** parser / validator and sandbox execution path as official Preflight.
See [README.md](README.md) for details.
