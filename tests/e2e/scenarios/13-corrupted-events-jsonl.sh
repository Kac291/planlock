#!/usr/bin/env bash
# If events.jsonl gets a torn write or manual edit, readEvents currently throws
# uncaught. v0.2 drift engine will read this file on every hook — a single bad
# line must not kill the session. This scenario documents the guard.
SCENARIO="S13 corrupted-events-jsonl"
source "$(dirname "$0")/../lib.sh"
e2e_init_sandbox
e2e_trap_cleanup

run_cli init
e2e_set_plans_dir
FIX="$(cd "$(dirname "$0")/../fixtures" && pwd)"
cp "$FIX/plan-b.md" "$PLANS_DIR/plan.md"

SID="sess-S13"
mk() { node -e "console.log(JSON.stringify({session_id:'$SID',cwd:process.argv[1],tool_name:process.argv[2],tool_input:{}}))" "$CWD" "$1"; }

run_cli capture-plan "$(mk ExitPlanMode)"
run_cli match-tool "$(mk Edit)"

events_file="$(e2e_session_events_file "$SID")"
# Corrupt: append a half-written JSON line (simulates process crash mid-append).
printf '{"type":"tool-call","timestamp":"2026-04\n' >> "$events_file"

# Now a legit line after the torn one.
run_cli match-tool "$(mk Bash)"

# report must not crash.
STOP=$(node -e "console.log(JSON.stringify({session_id:'$SID',cwd:process.argv[1]}))" "$CWD")
run_cli report "$STOP"
if [[ "$CLI_EXIT" -eq 0 ]]; then
  pass "report survived corrupted events.jsonl (exit=0)"
else
  fail "report crashed on corrupted events.jsonl (exit=$CLI_EXIT, stderr=$CLI_STDERR) — v0.2 will hit this every run"
fi

run_cli status
if [[ "$CLI_EXIT" -eq 0 ]]; then
  pass "status survived corrupted events.jsonl"
else
  fail "status crashed on corrupted events.jsonl (stderr=$CLI_STDERR)"
fi

e2e_finish
