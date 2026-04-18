#!/usr/bin/env bash
# v0.3: warn mode surfaces all non-clean verdicts (including partial) with
# a ⚠️ banner, but never blocks.
SCENARIO="S20 warn-mode"
source "$(dirname "$0")/../lib.sh"
e2e_init_sandbox
e2e_trap_cleanup

run_cli init
e2e_set_plans_dir

# Switch config.yaml to mode: warn.
node -e "
const fs=require('fs');
const path='$STATE_ROOT/config.yaml';
const t=fs.readFileSync(path,'utf8').replace(/mode:.*/, 'mode: warn');
fs.writeFileSync(path, t);
"

FIX="$(cd "$(dirname "$0")/../fixtures" && pwd)"
cp "$FIX/plan-auth.md" "$PLANS_DIR/plan.md"

SID="sess-S20"
PAYLOAD=$(node -e "console.log(JSON.stringify({session_id:'$SID',cwd:process.argv[1],tool_name:'ExitPlanMode',tool_input:{}}))" "$CWD")
run_cli capture-plan "$PAYLOAD"
assert_exit_zero "capture-plan"

mk_tool() {
  local tool="$1" input_json="$2"
  node -e "const p={session_id:'$SID',cwd:process.argv[1],tool_name:process.argv[2],tool_input:JSON.parse(process.argv[3])};console.log(JSON.stringify(p))" \
    "$CWD" "$tool" "$input_json"
}

# 1. Legit match — must stay silent even in warn mode.
run_cli match-tool "$(mk_tool Edit '{"file_path":"src/auth/login.ts","old_string":"a","new_string":"b"}')"
assert_exit_zero "match on allowed edit"
assert_not_contains "match is silent" "$CLI_STDERR" "planlock"

# 2. Out-of-scope — warn banner, exit 0 (observe would also surface, but plain
# prefix; warn must use the ⚠️ banner).
run_cli match-tool "$(mk_tool Write '{"file_path":"src/billing/invoice.ts","content":"x"}')"
assert_exit_zero "warn does not block out-of-scope"
assert_contains "warn banner present" "$CLI_STDERR" "⚠️ planlock warn"
assert_contains "verdict labelled" "$CLI_STDERR" "out-of-scope"
assert_not_contains "no strict block header" "$CLI_STDERR" "strict: blocked"

e2e_finish
