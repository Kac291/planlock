#!/usr/bin/env bash
# Dogfood: run the full PreToolUse → capture → match → Stop → report
# pipeline against planlock's own tree with each config.mode. Mirrors
# how Claude Code would invoke the hooks in practice.

set -u
SCENARIO="dogfood"

_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$_dir/../e2e/lib.sh"

e2e_init_sandbox
e2e_trap_cleanup
run_cli init >/dev/null 2>&1
e2e_set_plans_dir

# Realistic plan — simulates a Claude-written plan for a small CLI feature.
cat > "$PLANS_DIR/realistic-plan.md" <<'MD'
# Plan — add `--version` flag to planlock CLI

## 1. Wire the flag
- Edit `src/cli.ts` to register `.option("--version", ...)` and print `package.json.version`.

## 2. Test the flag
- Write `tests/unit/cli-version.test.ts` asserting `planlock --version` prints the semver string.

## 3. Verify
- Run `pnpm test` and `pnpm build` to confirm nothing regresses.
MD

mk_pre_tool() {
  local sid="$1" tool="$2" input_json="$3"
  node -e "
    const p={
      session_id:process.argv[1], transcript_path:'/tmp/t',
      cwd:process.argv[2], hook_event_name:'PreToolUse',
      tool_name:process.argv[3], tool_input:JSON.parse(process.argv[4]),
    };
    console.log(JSON.stringify(p));
  " "$sid" "$CWD" "$tool" "$input_json"
}

mk_stop() {
  local sid="$1"
  node -e "
    const p={session_id:process.argv[1], transcript_path:'/tmp/t',
      cwd:process.argv[2], hook_event_name:'Stop', stop_hook_active:false};
    console.log(JSON.stringify(p));
  " "$sid" "$CWD"
}

set_mode() {
  local mode="$1"
  node -e "
    const fs=require('fs');
    const p='$STATE_ROOT/config.yaml';
    const t=fs.readFileSync(p,'utf8').replace(/mode:.*/, 'mode: '+process.argv[1]);
    fs.writeFileSync(p, t);
  " "$mode"
}

describe() { printf '\n%s===%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }

# ───────────────────────────────────────────────
describe "0. capture the realistic plan"
SID="dogfood-shared"
run_cli capture-plan "$(mk_pre_tool "$SID" ExitPlanMode '{}')"
assert_exit_zero "capture-plan"
assert_contains "stdout mentions parsed step count" "$CLI_STDOUT" "parsed"
echo "       capture stdout: $CLI_STDOUT"

# Show what the parser produced so we can eyeball heuristic quality.
PARSED=$(ls "$STATE_ROOT/plans"/*.parsed.yaml | head -1)
echo "       parsed plan ($PARSED):"
sed -e 's/^/         /' "$PARSED"

# ───────────────────────────────────────────────
describe "1. OBSERVE mode — happy path + out-of-scope"
set_mode observe

SID="dogfood-observe"
run_cli match-tool "$(mk_pre_tool "$SID" Edit '{"file_path":"src/cli.ts","old_string":"a","new_string":"b"}')"
assert_exit_zero "observe: in-scope edit"
echo "       stderr: [${CLI_STDERR}]"

run_cli match-tool "$(mk_pre_tool "$SID" Write '{"file_path":"src/core/secret-backdoor.ts","content":"evil"}')"
assert_exit_zero "observe: does not block out-of-scope"
assert_contains "observe: surfaces out-of-scope" "$CLI_STDERR" "out-of-scope"
echo "       stderr: [${CLI_STDERR}]"

# ───────────────────────────────────────────────
describe "2. WARN mode — banner for partial too"
set_mode warn

SID="dogfood-warn"
run_cli match-tool "$(mk_pre_tool "$SID" Edit '{"file_path":"src/cli.ts","old_string":"a","new_string":"b"}')"
assert_exit_zero "warn: match stays silent"
assert_not_contains "warn: match is quiet" "$CLI_STDERR" "planlock"

run_cli match-tool "$(mk_pre_tool "$SID" Write '{"file_path":"src/core/secret-backdoor.ts","content":"evil"}')"
assert_exit_zero "warn: no block"
assert_contains "warn: banner present" "$CLI_STDERR" "⚠️ planlock warn"
echo "       stderr: [${CLI_STDERR}]"

# ───────────────────────────────────────────────
describe "3. STRICT mode — actual block (exit 2) for out-of-scope"
set_mode strict

SID="dogfood-strict"
run_cli match-tool "$(mk_pre_tool "$SID" Write '{"file_path":"src/core/secret-backdoor.ts","content":"evil"}')"
if [[ "$CLI_EXIT" -eq 2 ]]; then
  pass "strict: exit=2 (Claude Code will halt the tool call)"
else
  fail "strict expected exit=2, got $CLI_EXIT"
fi
assert_contains "strict: block reason in stderr (visible to Claude)" "$CLI_STDERR" "planlock strict: blocked"
echo "       stderr as Claude Code would show it:"
echo "       [${CLI_STDERR}]"
echo "       stdout (empty is fine for legacy exit-2 contract): [${CLI_STDOUT}]"

# skip-ahead within strict → warn-style, NOT blocked.
run_cli match-tool "$(mk_pre_tool "$SID" Write '{"file_path":"tests/unit/cli-version.test.ts","content":"t"}')"
assert_exit_zero "strict: skip-ahead not blocked"
assert_contains "strict: skip-ahead surfaced" "$CLI_STDERR" "⚠️ planlock warn (skip-ahead)"

# ───────────────────────────────────────────────
describe "4. Full session end-to-end under STRICT — produce a report"
SID="dogfood-report"
# Replay a realistic conversation: happy matches, one drift, then Stop.
run_cli match-tool "$(mk_pre_tool "$SID" Edit '{"file_path":"src/cli.ts","old_string":"a","new_string":"b"}')"   # match
run_cli match-tool "$(mk_pre_tool "$SID" Write '{"file_path":"tests/unit/cli-version.test.ts","content":"t"}')"   # match
run_cli match-tool "$(mk_pre_tool "$SID" Bash '{"command":"pnpm test"}')"                                         # step 3 (partial or match)
run_cli match-tool "$(mk_pre_tool "$SID" Write '{"file_path":"src/core/secret-backdoor.ts","content":"evil"}')"   # out-of-scope → should exit 2
echo "       (last exit above, expecting 2 for strict out-of-scope): $CLI_EXIT"

run_cli report "$(mk_stop "$SID")"
assert_exit_zero "report generation"

REPORT="$STATE_ROOT/sessions/$SID/report.md"
if [[ -f "$REPORT" ]]; then
  pass "report written to $REPORT"
  echo "       ─── report.md preview ───"
  sed -n '1,80p' "$REPORT" | sed -e 's/^/       /'
  echo "       ─── end ───"
else
  fail "report missing"
fi

# ───────────────────────────────────────────────
describe "5. Audit: events.jsonl sanity for strict run"
EVT="$STATE_ROOT/sessions/$SID/events.jsonl"
echo "       events.jsonl (last 6 lines):"
tail -n 6 "$EVT" | sed -e 's/^/       /'

DRIFTS=$(count_events "$EVT" drift)
echo "       drift count: $DRIFTS"

# At least: 1 tool-call + 1 drift per call. 4 calls → expect 4 drifts.
if [[ "$DRIFTS" -ge 4 ]]; then
  pass "≥4 drift events captured"
else
  fail "expected ≥4 drift events, got $DRIFTS"
fi

echo
echo "$C_YELLOW=== dogfood complete ===$C_RESET"
e2e_finish
