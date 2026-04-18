#!/usr/bin/env bash
# v0.3: strict mode surfaces skip-ahead / extra with the ⚠️ warn banner
# but does NOT block (exit 0). Only out-of-scope is blocking.
SCENARIO="S22 strict-warns-skip-ahead"
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

SID="sess-S22"
PAYLOAD=$(node -e "console.log(JSON.stringify({session_id:'$SID',cwd:process.argv[1],tool_name:'ExitPlanMode',tool_input:{}}))" "$CWD")
run_cli capture-plan "$PAYLOAD"
assert_exit_zero "capture-plan"

mk_tool() {
  local tool="$1" input_json="$2"
  node -e "const p={session_id:'$SID',cwd:process.argv[1],tool_name:process.argv[2],tool_input:JSON.parse(process.argv[3])};console.log(JSON.stringify(p))" \
    "$CWD" "$tool" "$input_json"
}

# Jump straight to the tests step while step 1 (login) is still open → skip-ahead.
run_cli match-tool "$(mk_tool Write '{"file_path":"tests/auth/login.test.ts","content":"t"}')"
assert_exit_zero "strict does not block skip-ahead"
assert_contains "skip-ahead surfaced with warn banner" "$CLI_STDERR" "⚠️ planlock warn (skip-ahead)"
assert_not_contains "no strict block" "$CLI_STDERR" "strict: blocked"

# Bash call that no step claims as a path-less action → extra (path-less, no
# match on Bash-operation step).
run_cli match-tool "$(mk_tool Bash '{"command":"git status"}')"
assert_exit_zero "strict does not block extra"
# Verdict may be extra or partial depending on scoring; either way must be warn-styled, never blocked.
if [[ "$CLI_STDERR" == *"⚠️ planlock warn"* ]]; then
  pass "path-less Bash surfaced with warn banner"
else
  fail "expected warn banner, got: $(printf '%s' "$CLI_STDERR" | head -c 200)"
fi
assert_not_contains "no strict block on Bash" "$CLI_STDERR" "strict: blocked"

e2e_finish
