#!/usr/bin/env bash
# Round 2 balance playtest -- experiment driver.
#
# PLAYTEST-ONLY.  Drives the official operator CLI as a black box through
# gb_round2.py.  Stages:
#
#   phase 1  screening: 15 conditions x slot swap = 30 matches per pair,
#            for all three pairs, to check for platform anomalies before
#            committing to the larger sample.
#   phase 2  expansion: every pair to the full 30 conditions x slot swap,
#            so the key pair reaches 60 matches.
#
# Re-running is safe: gb_round2.py run skips any match already archived, so
# phase 2 re-uses the 30 screening matches and only plays the remainder.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2

PY=/usr/bin/python3
H=playtest/harness/gb_round2.py
FULL=playtest/harness/conditions-round2.json
SCREEN=playtest/harness/conditions-round2-screening.json
OUT=playtest/results/round-2
PAIRS="fast-vs-hybrid optimizer-vs-hybrid fast-vs-optimizer"

say() { printf '\n=== %s ===\n' "$*"; }

say "install slot roots for all three pairs"
for pair in $PAIRS; do
  $PY "$H" install --pair "$pair" || echo "!! install failed for $pair"
done

say "phase 1 / screening (15 conditions x swap)"
for pair in $PAIRS; do
  say "screening -- $pair"
  $PY "$H" run --pair "$pair" --conditions "$SCREEN" \
      --out "$OUT/raw/$pair" --max-rounds 30
done

say "phase 2 / expansion to the full 30 conditions x swap"
for pair in $PAIRS; do
  say "expansion -- $pair"
  $PY "$H" run --pair "$pair" --conditions "$FULL" \
      --out "$OUT/raw/$pair" --max-rounds 30
done

say "analyze"
for pair in $PAIRS; do
  $PY "$H" analyze --pair "$pair" --raw "$OUT/raw/$pair" \
      --out "$OUT/metrics-$pair.json"
done

say "DONE"
