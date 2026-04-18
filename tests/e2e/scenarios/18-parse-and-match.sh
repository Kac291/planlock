#!/usr/bin/env bash
# v0.2-a: capture-plan emits parsed.yaml + plan-parsed event; match-tool scores tool
# calls against open steps and emits drift events with match / skip-ahead /
# out-of-scope / extra verdicts.
SCENARIO="S18 parse-and-match"
source "$(dirname "$0")/../lib.sh"
e2e_init_sandbox
e2e_trap_cleanup

run_cli init
e2e_set_plans_dir
FIX="$(cd "$(dirname "$0")/../fixtures" && pwd)"
cp "$FIX/plan-auth.md" "$PLANS_DIR/plan.md"

SID="sess-S18"

# capture-plan
PAYLOAD=$(node -e "console.log(JSON.stringify({session_id:'$SID',cwd:process.argv[1],tool_name:'ExitPlanMode',tool_input:{}}))" "$CWD")
run_cli capture-plan "$PAYLOAD"
assert_exit_zero "capture-plan"
assert_contains "stdout reports parse" "$CLI_STDOUT" "parsed"

parsed_count=$(find "$STATE_ROOT/plans" -maxdepth 1 -name '*.parsed.yaml' | wc -l | tr -d ' ')
assert_eq "parsed.yaml count" "$parsed_count" "1"

events_file="$(e2e_session_events_file "$SID")"
assert_eq "plan-parsed emitted" "$(count_events "$events_file" plan-parsed)" "1"

# Helper: build PreToolUse payload with tool_name + tool_input (JSON string).
mk_tool() {
  local tool="$1" input_json="$2"
  node -e "const p={session_id:'$SID',cwd:process.argv[1],tool_name:process.argv[2],tool_input:JSON.parse(process.argv[3])};console.log(JSON.stringify(p))" \
    "$CWD" "$tool" "$input_json"
}

# 1. Edit src/auth/login.ts → should match
run_cli match-tool "$(mk_tool Edit '{"file_path":"src/auth/login.ts","old_string":"a","new_string":"b"}')"
assert_exit_zero "match-tool Edit login"

# 2. Write src/auth/middleware.ts → should match a different step
run_cli match-tool "$(mk_tool Write '{"file_path":"src/auth/middleware.ts","content":"x"}')"
assert_exit_zero "match-tool Write middleware"

# 3. Write src/billing/invoice.ts → should be flagged out-of-scope
run_cli match-tool "$(mk_tool Write '{"file_path":"src/billing/invoice.ts","content":"x"}')"
assert_exit_zero "match-tool Write invoice"
assert_contains "stderr flags out-of-scope" "$CLI_STDERR" "out-of-scope"

# 4. Read src/foo.ts → neutral (read-only)
run_cli match-tool "$(mk_tool Read '{"file_path":"src/foo.ts"}')"
assert_exit_zero "match-tool Read neutral"

# 5. Write tests/auth/login.test.ts → should match tests step
run_cli match-tool "$(mk_tool Write '{"file_path":"tests/auth/login.test.ts","content":"t"}')"
assert_exit_zero "match-tool Write test"

drift_count=$(count_events "$events_file" drift)
if [[ "$drift_count" -ge 5 ]]; then
  pass "drift events emitted ($drift_count ≥ 5)"
else
  fail "drift events expected ≥5, got $drift_count"
fi

# Verify at least one match and one out-of-scope verdict in the JSONL.
verdicts=$(node -e "
  const fs=require('fs');
  const lines=fs.readFileSync('$events_file','utf8').split('\n').filter(Boolean);
  const v=[];
  for(const l of lines){try{const e=JSON.parse(l); if(e.type==='drift') v.push(e.verdict);}catch{}}
  process.stdout.write(v.join(','));
")
assert_contains "verdicts include match" "$verdicts" "match"
assert_contains "verdicts include out-of-scope" "$verdicts" "out-of-scope"
assert_contains "verdicts include neutral" "$verdicts" "neutral"

e2e_finish
