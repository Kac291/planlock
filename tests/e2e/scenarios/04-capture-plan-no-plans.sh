#!/usr/bin/env bash
SCENARIO="S4 capture-plan-no-plans"
source "$(dirname "$0")/../lib.sh"
e2e_init_sandbox
e2e_trap_cleanup

run_cli init
e2e_set_plans_dir  # points at empty $PLANS_DIR

SID="sess-S4"
PAYLOAD=$(node -e "console.log(JSON.stringify({session_id:'$SID',cwd:process.argv[1],tool_name:'ExitPlanMode'}))" "$CWD")

run_cli capture-plan "$PAYLOAD"
assert_exit_zero "capture-plan (empty plans dir)"
assert_contains "stderr" "$CLI_STDERR" "no plan files"

assert_file_absent "$STATE_ROOT/plans"
assert_file_absent "$(e2e_session_events_file "$SID")"

e2e_finish
