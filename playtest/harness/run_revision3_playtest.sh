#!/usr/bin/env bash
#
# Revision 3 final playtest (task brief §32).
#
# Same 30 map conditions as round-1 / round-2 (so the three rounds stay
# comparable), against the Revision 3 rules: fixed Emitter, no per-round
# shooter selection, 500 ms budget, engine-level stalemate + hard round limit.
#
# Writes to its own tree -- never into results/round-2 or
# results/shooter-rule-revision, which are evidence under older rules.
#
# Not set -e: a single failed match must not abort the remaining 179.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

PY=/usr/bin/python3
H=playtest/harness/gb_round2.py
FULL=playtest/harness/conditions-round2.json
SCREEN=playtest/harness/conditions-round2-screening.json
OUT=playtest/results/revision-3
PAIRS="fast-vs-hybrid optimizer-vs-hybrid fast-vs-optimizer"

echo "### 0. reinstall the three pairs (competitors were ported to public.emitters)"
for p in $PAIRS; do
  "$PY" "$H" install --pair "$p" || exit 1
done

echo "### 1. phase 1 -- screening subset (30 matches/pair)"
for p in $PAIRS; do
  "$PY" "$H" run --pair "$p" --conditions "$SCREEN" --out "$OUT/raw/$p" --max-rounds 60
done

echo "### 2. phase 2 -- full 30 conditions (60 matches/pair, 180 total)"
for p in $PAIRS; do
  "$PY" "$H" run --pair "$p" --conditions "$FULL" --out "$OUT/raw/$p" --max-rounds 60
done

echo "### 3. fold the archive into metrics + summary"
for p in $PAIRS; do
  "$PY" "$H" analyze --pair "$p" --raw "$OUT/raw/$p" --out "$OUT/metrics-$p.json"
done
"$PY" playtest/harness/analyze_round2.py --root "$OUT"

echo DONE
