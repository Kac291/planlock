#!/usr/bin/env bash
SCENARIO="S11 status-smoketest"
source "$(dirname "$0")/../lib.sh"
e2e_init_sandbox
e2e_trap_cleanup

run_cli init

# No sessions yet → friendly message.
run_cli status
assert_exit_zero "status (empty)"
assert_contains "empty status stdout" "$CLI_STDOUT" "no sessions recorded yet"

# Seed one session via capture-plan + match-tool, then status should reflect latest.
e2e_set_plans_dir
FIX="$(cd "$(dirname "$0")/../fixtures" && pwd)"
cp "$FIX/plan-b.md" "$PLANS_DIR/plan.md"

SID_OLD="sess-old"
SID_NEW="sess-new"

mk_payload() {
  node -e "console.log(JSON.stringify({session_id:process.argv[1],cwd:process.argv[2],tool_name:process.argv[3],tool_input:{}}))" "$1" "$CWD" "$2"
}

run_cli capture-plan "$(mk_payload "$SID_OLD" ExitPlanMode)"
run_cli match-tool "$(mk_payload "$SID_OLD" Edit)"

sleep 1  # ensure distinct mtime so status picks newer session

run_cli capture-plan "$(mk_payload "$SID_NEW" ExitPlanMode)"
run_cli match-tool "$(mk_payload "$SID_NEW" Bash)"
run_cli match-tool "$(mk_payload "$SID_NEW" Bash)"

run_cli status
assert_exit_zero "status (with sessions)"
assert_contains "status latest id" "$CLI_STDOUT" "$SID_NEW"
assert_contains "status plans count" "$CLI_STDOUT" "plans captured: 1"
assert_contains "status tool calls" "$CLI_STDOUT" "tool calls: 2"
assert_not_contains "status must not show older session" "$CLI_STDOUT" "$SID_OLD"

e2e_finish
