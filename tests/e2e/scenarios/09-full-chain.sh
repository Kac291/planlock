#!/usr/bin/env bash
SCENARIO="S9 full-chain"
source "$(dirname "$0")/../lib.sh"
e2e_init_sandbox
e2e_trap_cleanup

run_cli init
e2e_set_plans_dir
FIX="$(cd "$(dirname "$0")/../fixtures" && pwd)"
cp "$FIX/plan-b.md" "$PLANS_DIR/plan.md"

SID="sess-S9"

mk_payload() {
  node -e "console.log(JSON.stringify({session_id:'$SID',cwd:process.argv[1],tool_name:process.argv[2],tool_input:{}}))" "$CWD" "$1"
}

# Order: ExitPlanMode (capture-plan), then Edit/Bash/Read (match-tool x3 + ExitPlanMode skipped), then Stop.
run_cli capture-plan "$(mk_payload ExitPlanMode)"
assert_exit_zero "capture-plan"

for tool in Edit Bash Read Bash; do
  run_cli match-tool "$(mk_payload "$tool")"
  assert_exit_zero "match-tool $tool"
done

# ExitPlanMode via match-tool should be ignored.
run_cli match-tool "$(mk_payload ExitPlanMode)"
assert_exit_zero "match-tool ExitPlanMode (skipped)"

events_file="$(e2e_session_events_file "$SID")"
assert_eq "plan-captured total" "$(count_events "$events_file" plan-captured)" "1"
assert_eq "tool-call total" "$(count_events "$events_file" tool-call)" "4"

# Stop -> report
STOP=$(node -e "console.log(JSON.stringify({session_id:'$SID',cwd:process.argv[1]}))" "$CWD")
run_cli report "$STOP"
assert_exit_zero "report"

report_body="$(cat "$(e2e_session_report_file "$SID")")"
assert_contains "plans=1" "$report_body" "Plans captured: 1"
assert_contains "tools=4" "$report_body" "Tool calls logged: 4"
# Breakdown sorted by count desc: Bash:2 > Edit:1, Read:1
assert_contains "Bash top" "$report_body" "- Bash: 2"
assert_contains "Edit listed" "$report_body" "- Edit: 1"
assert_contains "Read listed" "$report_body" "- Read: 1"

# Bash should appear before Edit and Read (sorted desc).
bash_line=$(printf '%s\n' "$report_body" | grep -n '^- Bash:' | cut -d: -f1)
edit_line=$(printf '%s\n' "$report_body" | grep -n '^- Edit:' | cut -d: -f1)
if [[ "$bash_line" -lt "$edit_line" ]]; then
  pass "breakdown sorted desc (Bash before Edit)"
else
  fail "breakdown order wrong: Bash@$bash_line Edit@$edit_line"
fi

e2e_finish
