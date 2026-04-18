#!/usr/bin/env bash
SCENARIO="S3 capture-plan-happy"
source "$(dirname "$0")/../lib.sh"
e2e_init_sandbox
e2e_trap_cleanup

run_cli init
assert_exit_zero "init"

# Point plansDirectory at our fixture dir and place two plans with distinct mtimes.
e2e_set_plans_dir
FIX="$(cd "$(dirname "$0")/../fixtures" && pwd)"
cp "$FIX/plan-a.md" "$PLANS_DIR/plan-a.md"
sleep 1
cp "$FIX/plan-b.md" "$PLANS_DIR/plan-b.md"  # newer mtime

SID="sess-S3"
PAYLOAD=$(node -e "console.log(JSON.stringify({session_id:'$SID',cwd:process.argv[1],hook_event_name:'PreToolUse',tool_name:'ExitPlanMode',tool_input:{}}))" "$CWD")

run_cli capture-plan "$PAYLOAD"
assert_exit_zero "capture-plan"
assert_contains "stdout" "$CLI_STDOUT" "captured plan"

stored_count=$(find "$STATE_ROOT/plans" -maxdepth 1 -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
assert_eq "stored plan count" "$stored_count" "1"

stored_file="$(find "$STATE_ROOT/plans" -maxdepth 1 -name '*.md' | head -n1)"
expected_body="$(cat "$PLANS_DIR/plan-b.md")"
actual_body="$(cat "$stored_file")"
assert_eq "stored plan is newest (plan-b)" "$actual_body" "$expected_body"

events_file="$(e2e_session_events_file "$SID")"
assert_file_exists "$events_file"
assert_eq "plan-captured count" "$(count_events "$events_file" plan-captured)" "1"

e2e_finish
