#!/usr/bin/env bash
#
# Rebalance playtest after the Shooter Cancellation Rule Amendment.
#
# Plays the SAME 30 map conditions as round 1 / round 2 (so the two rounds are
# comparable) but against the amended production rule: Locked Attack Right.
# Writes to its own tree -- never into playtest/results/round-2, whose archive
# is round-2 evidence under the repealed rule.
#
# Not set -e: a single failed match must not abort the remaining 179.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

PY=/usr/bin/python3
H=playtest/harness/gb_round2.py
CF=playtest/harness/gb_counterfactual.py
FULL=playtest/harness/conditions-round2.json
SCREEN=playtest/harness/conditions-round2-screening.json
OUT=playtest/results/shooter-rule-revision
PAIRS="fast-vs-hybrid optimizer-vs-hybrid fast-vs-optimizer"

echo "### 0. hybrid self-check (must be PRE-FLIGHT PASS before any match)"
npx --no-install ts-node src/operator/validate-submission.ts playtest/competitors/solver-hybrid

echo "### 1. install the three pair arrangements"
for p in $PAIRS; do
  "$PY" "$H" install --pair "$p"
done

echo "### 2. phase 1 -- screening subset (30 matches/pair)"
for p in $PAIRS; do
  "$PY" "$H" run --pair "$p" --conditions "$SCREEN" --out "$OUT/raw/$p" --max-rounds 30
done

echo "### 3. phase 2 -- full 30 conditions (60 matches/pair, 180 total)"
for p in $PAIRS; do
  "$PY" "$H" run --pair "$p" --conditions "$FULL" --out "$OUT/raw/$p" --max-rounds 30
done

echo "### 4. fold the archive into metrics + summary"
for p in $PAIRS; do
  "$PY" "$H" analyze --pair "$p" --raw "$OUT/raw/$p" --out "$OUT/metrics-$p.json"
done
"$PY" playtest/harness/analyze_round2.py --root "$OUT"

echo "### 5. counterfactual: model-agreement gate, then legacy-cancel attribution"
for p in $PAIRS; do
  "$PY" "$CF" verify --raw "$OUT/raw/$p" --out "$OUT/cf/verify-$p.json"
done
for p in $PAIRS; do
  "$PY" "$CF" rounds --pair "$p" --raw "$OUT/raw/$p" \
      --cache "$OUT/cf/fn-$p.json" --out "$OUT/cf/rounds-$p.json"
done
for p in $PAIRS; do
  "$PY" "$CF" simulate --pair "$p" --conditions "$FULL" \
      --out "$OUT/cf/sim-$p" --cache "$OUT/cf/fn-$p.json" \
      --ref-root "$OUT/raw" \
      --modes locked-attack cf-legacy-cancel
done

# NOTE: the round-60 absorption probe is deliberately NOT here.  Which
# conditions need it is only knowable after step 4 -- it is the set of
# conditions whose matches ran into the 30-round cap.  Build that subset from
# the archive and run it separately, so this script stays replayable.

echo DONE
