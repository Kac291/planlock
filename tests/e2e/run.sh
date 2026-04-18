#!/usr/bin/env bash
# planlock v0.1 E2E runner. Executes each scenario in its own subshell so one
# failure doesn't abort the rest. Exits non-zero if any scenario fails.
#
# Usage:
#   bash tests/e2e/run.sh                    # run all
#   bash tests/e2e/run.sh 03 06              # run only matching scenarios

set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Auto-build if dist is missing (keeps CI ergonomic; no-op locally if recent).
if [[ ! -f "$DIR/../../dist/cli.js" ]]; then
  echo "[e2e] dist/cli.js missing — running pnpm build" >&2
  (cd "$DIR/../.." && pnpm build) >/dev/null
fi

mapfile -t all_scenarios < <(ls "$DIR/scenarios"/*.sh | sort)

filter=("$@")
selected=()
if [[ "${#filter[@]}" -eq 0 ]]; then
  selected=("${all_scenarios[@]}")
else
  for s in "${all_scenarios[@]}"; do
    base="$(basename "$s")"
    for f in "${filter[@]}"; do
      if [[ "$base" == *"$f"* ]]; then selected+=("$s"); break; fi
    done
  done
fi

if [[ "${#selected[@]}" -eq 0 ]]; then
  echo "[e2e] no scenarios matched filter: ${filter[*]}" >&2
  exit 2
fi

total=0; failed=0; failed_list=()
for s in "${selected[@]}"; do
  total=$((total+1))
  name="$(basename "$s" .sh)"
  echo "── $name ──"
  if bash "$s"; then
    :
  else
    failed=$((failed+1))
    failed_list+=("$name")
  fi
  echo
done

echo "============================================="
echo "[e2e] total=$total passed=$((total-failed)) failed=$failed"
if [[ "$failed" -gt 0 ]]; then
  printf '[e2e] failed:\n'
  for f in "${failed_list[@]}"; do echo "  - $f"; done
  exit 1
fi
