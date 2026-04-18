#!/usr/bin/env bash
# Guards readJsonStdin against malformed JSON. v0.1 currently lets JSON.parse throw
# uncaught — this scenario documents the expectation that hooks must NEVER crash
# Claude Code with a non-zero exit on garbage stdin.
SCENARIO="S12 malformed-stdin-json"
source "$(dirname "$0")/../lib.sh"
e2e_init_sandbox
e2e_trap_cleanup

run_cli init

# Truly broken JSON (not just bad schema).
BAD='{"session_id":"x", this is not JSON'

for cmd in capture-plan match-tool report; do
  run_cli "$cmd" "$BAD"
  if [[ "$CLI_EXIT" -eq 0 ]]; then
    pass "$cmd survived malformed JSON (exit=0)"
  else
    fail "$cmd crashed on malformed JSON (exit=$CLI_EXIT) — hook would abort Claude Code tool call"
  fi
done

# State root must not be corrupted — no partial events written.
assert_file_absent "$STATE_ROOT/sessions"
assert_file_absent "$STATE_ROOT/plans"

e2e_finish
