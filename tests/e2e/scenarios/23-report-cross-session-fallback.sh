#!/usr/bin/env bash
# v0.3.1: a second session that never captured a plan itself should still be
# able to produce a drift report by reading the most recent parsed.yaml on
# disk — previously the report fell back to "parsed plan not available".
SCENARIO="S23 report-cross-session-fallback"
source "$(dirname "$0")/../lib.sh"
e2e_init_sandbox
e2e_trap_cleanup

run_cli init
e2e_set_plans_dir

FIX="$(cd "$(dirname "$0")/../fixtures" && pwd)"
cp "$FIX/plan-auth.md" "$PLANS_DIR/plan.md"

# Session A captures + parses the plan.
SID_A="sess-S23-capture"
PAYLOAD=$(node -e "console.log(JSON.stringify({session_id:'$SID_A',cwd:process.argv[1],tool_name:'ExitPlanMode',tool_input:{}}))" "$CWD")
run_cli capture-plan "$PAYLOAD"
assert_exit_zero "session A capture-plan"

# Session B never runs capture-plan but issues tool calls and hits Stop.
SID_B="sess-S23-consumer"
mk_pre() {
  local tool="$1" input_json="$2"
  node -e "const p={session_id:'$SID_B',cwd:process.argv[1],tool_name:process.argv[2],tool_input:JSON.parse(process.argv[3])};console.log(JSON.stringify(p))" \
    "$CWD" "$tool" "$input_json"
}

run_cli match-tool "$(mk_pre Edit '{"file_path":"src/auth/login.ts","old_string":"a","new_string":"b"}')"
assert_exit_zero "session B match"
run_cli match-tool "$(mk_pre Write '{"file_path":"src/billing/invoice.ts","content":"x"}')"
assert_exit_zero "session B out-of-scope"

STOP_PAYLOAD=$(node -e "console.log(JSON.stringify({session_id:'$SID_B',cwd:process.argv[1],hook_event_name:'Stop',stop_hook_active:false}))" "$CWD")
run_cli report "$STOP_PAYLOAD"
assert_exit_zero "session B report"

REPORT="$(e2e_session_report_file "$SID_B")"
assert_file_exists "$REPORT"
REPORT_CONTENT="$(cat "$REPORT")"
assert_contains "steps status header present" "$REPORT_CONTENT" "## Steps status"
assert_contains "out-of-scope section present" "$REPORT_CONTENT" "## Out-of-scope events"
assert_contains "drift score present" "$REPORT_CONTENT" "Drift score:"
assert_not_contains "no legacy-fallback note" "$REPORT_CONTENT" "parsed plan not available"

e2e_finish
