#!/usr/bin/env bash
SCENARIO="S1 init-fresh"
source "$(dirname "$0")/../lib.sh"
e2e_init_sandbox
e2e_trap_cleanup

run_cli init
assert_exit_zero "init"
assert_contains "init stdout" "$CLI_STDOUT" "planlock initialized"

settings="$CWD/.claude/settings.local.json"
assert_file_exists "$settings"

# Verify hook registration shape via node so we don't rely on jq.
node -e "
  const fs=require('fs');
  const s=JSON.parse(fs.readFileSync('$settings','utf8'));
  const pre=(s.hooks||{}).PreToolUse||[];
  const stop=(s.hooks||{}).Stop||[];
  const hasExitPlan=pre.some(b=>b.matcher==='ExitPlanMode' && b.hooks.some(h=>h.command==='planlock capture-plan'));
  const hasStar=pre.some(b=>b.matcher==='*' && b.hooks.some(h=>h.command==='planlock match-tool'));
  const hasStop=stop.some(b=>b.hooks.some(h=>h.command==='planlock report'));
  if(!hasExitPlan){console.error('missing ExitPlanMode hook');process.exit(1);}
  if(!hasStar){console.error('missing wildcard hook');process.exit(1);}
  if(!hasStop){console.error('missing Stop hook');process.exit(1);}
"
assert_eq "hooks shape" "$?" "0"

assert_file_exists "$CWD/.planlock/config.yaml"
cfg_content="$(cat "$CWD/.planlock/config.yaml")"
assert_contains "config.yaml" "$cfg_content" "mode: observe"

assert_file_exists "$CWD/.gitignore"
gi_content="$(cat "$CWD/.gitignore")"
assert_contains ".gitignore" "$gi_content" ".planlock/"

e2e_finish
