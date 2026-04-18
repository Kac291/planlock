#!/usr/bin/env bash
# If a user hand-edits .claude/settings.local.json into invalid JSON, what happens?
# - init re-runs: readFileSync + JSON.parse throws uncaught → init crashes, no recovery
# - capture-plan: resolvePlansDir's readJsonSafely swallows parse error → falls through to next candidate (safe)
# Behavior divergence between these two code paths is itself a latent bug.
SCENARIO="S17 malformed-settings-json"
source "$(dirname "$0")/../lib.sh"
e2e_init_sandbox
e2e_trap_cleanup

# Pre-seed a malformed settings.local.json BEFORE init.
mkdir -p "$CWD/.claude"
printf '%s' '{ "hooks": { "PreToolUse": [  invalid' > "$CWD/.claude/settings.local.json"

# init should either recover OR fail gracefully. Not crash unhandled.
run_cli init
if [[ "$CLI_EXIT" -eq 0 ]]; then
  pass "init recovered from malformed settings.local.json"
  # And the file should now be valid JSON with planlock hooks.
  if node -e "JSON.parse(require('fs').readFileSync('$CWD/.claude/settings.local.json','utf8'))" 2>/dev/null; then
    pass "settings.local.json is valid JSON after init"
  else
    fail "init wrote invalid JSON or didn't repair"
  fi
else
  # Expected to fail right now — document the bug path for v0.2 hardening.
  fail "init crashed on malformed settings.local.json (exit=$CLI_EXIT) — users can get stuck"
fi

# capture-plan with same malformed file should NOT crash (readJsonSafely catches).
e2e_set_plans_dir  # overwrites with valid JSON now
# Re-corrupt for this test:
printf '%s' '{ not json' > "$CWD/.claude/settings.local.json"

SID="sess-S17"
PAYLOAD=$(node -e "console.log(JSON.stringify({session_id:'$SID',cwd:process.argv[1],tool_name:'ExitPlanMode'}))" "$CWD")
run_cli capture-plan "$PAYLOAD"
if [[ "$CLI_EXIT" -eq 0 ]]; then
  pass "capture-plan tolerates malformed settings (falls through)"
else
  fail "capture-plan crashed on malformed settings (exit=$CLI_EXIT)"
fi

e2e_finish
