#!/usr/bin/env bash
SCENARIO="S6 match-tool-normal"
source "$(dirname "$0")/../lib.sh"
e2e_init_sandbox
e2e_trap_cleanup

run_cli init

SID="sess-S6"
PAYLOAD=$(node -e "console.log(JSON.stringify({session_id:'$SID',cwd:process.argv[1],tool_name:'Edit',tool_input:{file_path:'/x',old_string:'a',new_string:'b'}}))" "$CWD")

run_cli match-tool "$PAYLOAD"
assert_exit_zero "match-tool Edit"

events_file="$(e2e_session_events_file "$SID")"
assert_file_exists "$events_file"
assert_eq "tool-call count" "$(count_events "$events_file" tool-call)" "1"

# Inspect the recorded event in detail.
toolName=$(node -e "
  const fs=require('fs');
  const l=fs.readFileSync('$events_file','utf8').trim().split('\n').filter(Boolean);
  const ev=JSON.parse(l[0]);
  process.stdout.write(ev.toolName);
")
assert_eq "recorded toolName" "$toolName" "Edit"

e2e_finish
