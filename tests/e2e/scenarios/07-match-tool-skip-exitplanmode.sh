#!/usr/bin/env bash
SCENARIO="S7 match-tool-skip-exitplanmode"
source "$(dirname "$0")/../lib.sh"
e2e_init_sandbox
e2e_trap_cleanup

run_cli init

SID="sess-S7"
PAYLOAD=$(node -e "console.log(JSON.stringify({session_id:'$SID',cwd:process.argv[1],tool_name:'ExitPlanMode',tool_input:{}}))" "$CWD")

run_cli match-tool "$PAYLOAD"
assert_exit_zero "match-tool ExitPlanMode"

events_file="$(e2e_session_events_file "$SID")"
# Should not have created events file (early return).
assert_file_absent "$events_file"

e2e_finish
