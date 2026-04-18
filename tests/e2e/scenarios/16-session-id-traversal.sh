#!/usr/bin/env bash
# session_id is user-controlled (comes from Claude Code JSON). It goes directly
# into path.join(stateRoot, "sessions", sessionId) — if Claude Code ever passes
# a string like "../foo" (or a malicious payload in a fake hook call), files
# land outside the state root. This scenario documents the current behavior so
# v0.2 can lock it down.
SCENARIO="S16 session-id-traversal"
source "$(dirname "$0")/../lib.sh"
e2e_init_sandbox
e2e_trap_cleanup

run_cli init

EVIL='../escape'
PAYLOAD=$(node -e "console.log(JSON.stringify({session_id:process.argv[1],cwd:process.argv[2],tool_name:'Edit',tool_input:{}}))" "$EVIL" "$CWD")

run_cli match-tool "$PAYLOAD"
# We do NOT assert exit code here — crash-or-succeed is part of what we're documenting.

# Critical check: nothing got written OUTSIDE stateRoot.
# stateRoot = $CWD/.planlock. Escape target would be $CWD/escape or similar.
escape_dir="$CWD/escape"
if [[ -d "$escape_dir" || -f "$escape_dir" ]]; then
  fail "SECURITY: session_id '$EVIL' wrote outside state root → $escape_dir"
else
  pass "no path traversal outside state root"
fi

# Also check sibling (.planlock parent's parent)
if [[ -d "$SANDBOX/escape" || -f "$SANDBOX/escape" ]]; then
  fail "SECURITY: session_id escaped sandbox → $SANDBOX/escape"
else
  pass "no escape to sandbox root"
fi

e2e_finish
