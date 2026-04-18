#!/usr/bin/env bash
# Two parallel Claude Code windows on the same project produce two session_ids.
# Each must own its own events.jsonl — no cross-contamination. v0.2's drift report
# will be per-session, so mis-attributing events breaks everything downstream.
SCENARIO="S14 multi-session-isolation"
source "$(dirname "$0")/../lib.sh"
e2e_init_sandbox
e2e_trap_cleanup

run_cli init
e2e_set_plans_dir
FIX="$(cd "$(dirname "$0")/../fixtures" && pwd)"
cp "$FIX/plan-b.md" "$PLANS_DIR/plan.md"

A="sess-A"
B="sess-B"
mk() { node -e "console.log(JSON.stringify({session_id:process.argv[1],cwd:process.argv[2],tool_name:process.argv[3],tool_input:{}}))" "$1" "$CWD" "$2"; }

# Interleave: A Edit, B Edit, A Bash, B Bash, B Read, A plan-capture.
run_cli match-tool "$(mk "$A" Edit)"
run_cli match-tool "$(mk "$B" Edit)"
run_cli match-tool "$(mk "$A" Bash)"
run_cli match-tool "$(mk "$B" Bash)"
run_cli match-tool "$(mk "$B" Read)"
run_cli capture-plan "$(mk "$A" ExitPlanMode)"

events_A="$(e2e_session_events_file "$A")"
events_B="$(e2e_session_events_file "$B")"

assert_eq "A plan-captured" "$(count_events "$events_A" plan-captured)" "1"
assert_eq "A tool-calls"    "$(count_events "$events_A" tool-call)"     "2"
assert_eq "B plan-captured" "$(count_events "$events_B" plan-captured)" "0"
assert_eq "B tool-calls"    "$(count_events "$events_B" tool-call)"     "3"

# No line in A's file should mention sess-B, and vice versa.
if grep -q "sess-B" "$events_A"; then
  fail "A's events.jsonl leaked sess-B data"
else
  pass "A's events.jsonl clean of B"
fi
if grep -q "sess-A" "$events_B"; then
  fail "B's events.jsonl leaked sess-A data"
else
  pass "B's events.jsonl clean of A"
fi

# Reports are per-session, must not bleed.
for SID in "$A" "$B"; do
  STOP=$(node -e "console.log(JSON.stringify({session_id:'$SID',cwd:process.argv[1]}))" "$CWD")
  run_cli report "$STOP"
  assert_exit_zero "report $SID"
done

A_report="$(cat "$(e2e_session_report_file "$A")")"
B_report="$(cat "$(e2e_session_report_file "$B")")"
assert_contains "A report header" "$A_report" "session $A"
assert_contains "A plans=1"       "$A_report" "Plans captured: 1"
assert_contains "A tools=2"       "$A_report" "Tool calls logged: 2"
assert_contains "B report header" "$B_report" "session $B"
assert_contains "B plans=0"       "$B_report" "Plans captured: 0"
assert_contains "B tools=3"       "$B_report" "Tool calls logged: 3"

e2e_finish
