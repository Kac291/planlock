#!/usr/bin/env bash
SCENARIO="S8 report"
source "$(dirname "$0")/../lib.sh"
e2e_init_sandbox
e2e_trap_cleanup

run_cli init
e2e_set_plans_dir
FIX="$(cd "$(dirname "$0")/../fixtures" && pwd)"
cp "$FIX/plan-b.md" "$PLANS_DIR/plan.md"

SID="sess-S8"

# 1 plan capture
P1=$(node -e "console.log(JSON.stringify({session_id:'$SID',cwd:process.argv[1],tool_name:'ExitPlanMode',tool_input:{}}))" "$CWD")
run_cli capture-plan "$P1"
assert_exit_zero "capture-plan"

# 1 tool call (Edit)
P2=$(node -e "console.log(JSON.stringify({session_id:'$SID',cwd:process.argv[1],tool_name:'Edit',tool_input:{}}))" "$CWD")
run_cli match-tool "$P2"
assert_exit_zero "match-tool Edit"

# Stop -> report
P3=$(node -e "console.log(JSON.stringify({session_id:'$SID',cwd:process.argv[1],hook_event_name:'Stop'}))" "$CWD")
run_cli report "$P3"
assert_exit_zero "report"

report_file="$(e2e_session_report_file "$SID")"
assert_file_exists "$report_file"
report_body="$(cat "$report_file")"
assert_contains "report header" "$report_body" "planlock report — session $SID"
assert_contains "plans count" "$report_body" "Plans captured: 1"
assert_contains "tool-calls count" "$report_body" "Tool calls logged: 1"
assert_contains "breakdown line" "$report_body" "- Edit: 1"

e2e_finish
