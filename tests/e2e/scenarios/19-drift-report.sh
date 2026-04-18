#!/usr/bin/env bash
# v0.2-a: report.md gains Steps status / Out-of-scope / Extra / Drift score sections
# when a parsed plan exists for the session.
SCENARIO="S19 drift-report"
source "$(dirname "$0")/../lib.sh"
e2e_init_sandbox
e2e_trap_cleanup

run_cli init
e2e_set_plans_dir
FIX="$(cd "$(dirname "$0")/../fixtures" && pwd)"
cp "$FIX/plan-auth.md" "$PLANS_DIR/plan.md"

SID="sess-S19"

mk_tool() {
  local tool="$1" input_json="$2"
  node -e "const p={session_id:'$SID',cwd:process.argv[1],tool_name:process.argv[2],tool_input:JSON.parse(process.argv[3])};console.log(JSON.stringify(p))" \
    "$CWD" "$tool" "$input_json"
}

PAYLOAD=$(node -e "console.log(JSON.stringify({session_id:'$SID',cwd:process.argv[1],tool_name:'ExitPlanMode',tool_input:{}}))" "$CWD")
run_cli capture-plan "$PAYLOAD"

# Match s1 (login.ts), match s2 (middleware.ts), out-of-scope (billing).
run_cli match-tool "$(mk_tool Edit '{"file_path":"src/auth/login.ts","old_string":"a","new_string":"b"}')"
run_cli match-tool "$(mk_tool Write '{"file_path":"src/auth/middleware.ts","content":"x"}')"
run_cli match-tool "$(mk_tool Write '{"file_path":"src/billing/invoice.ts","content":"y"}')"

# Stop → report
STOP=$(node -e "console.log(JSON.stringify({session_id:'$SID',cwd:process.argv[1]}))" "$CWD")
run_cli report "$STOP"
assert_exit_zero "report"

report_file="$(e2e_session_report_file "$SID")"
assert_file_exists "$report_file"
report_body="$(cat "$report_file")"

assert_contains "has Steps status header" "$report_body" "## Steps status"
assert_contains "completed marker present" "$report_body" "✅"
assert_contains "skipped marker present" "$report_body" "⚠️"
assert_contains "out-of-scope section" "$report_body" "## Out-of-scope events"
assert_contains "billing flagged" "$report_body" "src/billing/invoice.ts"
assert_contains "drift score line" "$report_body" "Drift score:"

# Legacy-mode fallback: a session with no parsed plan should fall back to the note.
SID2="sess-S19-legacy"
LEGACY_STOP=$(node -e "console.log(JSON.stringify({session_id:'$SID2',cwd:process.argv[1]}))" "$CWD")
# seed an empty events file so report runs
mkdir -p "$STATE_ROOT/sessions/$SID2"
: > "$STATE_ROOT/sessions/$SID2/events.jsonl"
run_cli report "$LEGACY_STOP"
assert_exit_zero "report (legacy)"
legacy_body="$(cat "$(e2e_session_report_file "$SID2")")"
assert_contains "legacy note present" "$legacy_body" "parsed plan not available"

e2e_finish
