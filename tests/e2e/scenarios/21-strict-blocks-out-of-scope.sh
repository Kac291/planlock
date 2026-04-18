#!/usr/bin/env bash
# v0.3: strict mode blocks (exit 2) on out-of-scope tool calls, writing a
# structured reason to stderr so Claude Code can surface it.
SCENARIO="S21 strict-blocks-out-of-scope"
source "$(dirname "$0")/../lib.sh"
e2e_init_sandbox
e2e_trap_cleanup

run_cli init
e2e_set_plans_dir
node -e "
const fs=require('fs');
const path='$STATE_ROOT/config.yaml';
const t=fs.readFileSync(path,'utf8').replace(/mode:.*/, 'mode: strict');
fs.writeFileSync(path, t);
"

FIX="$(cd "$(dirname "$0")/../fixtures" && pwd)"
cp "$FIX/plan-auth.md" "$PLANS_DIR/plan.md"

SID="sess-S21"
PAYLOAD=$(node -e "console.log(JSON.stringify({session_id:'$SID',cwd:process.argv[1],tool_name:'ExitPlanMode',tool_input:{}}))" "$CWD")
run_cli capture-plan "$PAYLOAD"
assert_exit_zero "capture-plan"

mk_tool() {
  local tool="$1" input_json="$2"
  node -e "const p={session_id:'$SID',cwd:process.argv[1],tool_name:process.argv[2],tool_input:JSON.parse(process.argv[3])};console.log(JSON.stringify(p))" \
    "$CWD" "$tool" "$input_json"
}

# Out-of-scope write → must exit 2 (block) with strict reason.
run_cli match-tool "$(mk_tool Write '{"file_path":"src/billing/invoice.ts","content":"x"}')"
if [[ "$CLI_EXIT" -eq 2 ]]; then
  pass "strict blocks out-of-scope (exit=2)"
else
  fail "expected exit=2 for strict out-of-scope, got $CLI_EXIT"
fi
assert_contains "strict header in stderr" "$CLI_STDERR" "planlock strict: blocked"
assert_contains "reason mentions no-step-covers" "$CLI_STDERR" "billing/invoice.ts"

# Modern Claude Code hook contract: stdout JSON must carry
# hookSpecificOutput.permissionDecision = "deny".
assert_contains "stdout has PreToolUse hook envelope" "$CLI_STDOUT" '"hookEventName":"PreToolUse"'
assert_contains "stdout has permissionDecision=deny" "$CLI_STDOUT" '"permissionDecision":"deny"'
assert_contains "stdout has permissionDecisionReason" "$CLI_STDOUT" '"permissionDecisionReason"'

# Drift event must still be persisted (block happens after append).
events_file="$(e2e_session_events_file "$SID")"
drift_count=$(count_events "$events_file" drift)
assert_eq "drift event persisted despite block" "$drift_count" "1"

# Legit match in strict → silent, exit 0.
run_cli match-tool "$(mk_tool Edit '{"file_path":"src/auth/login.ts","old_string":"a","new_string":"b"}')"
assert_exit_zero "strict does not block allowed edit"
assert_not_contains "match stays silent" "$CLI_STDERR" "planlock strict"

e2e_finish
