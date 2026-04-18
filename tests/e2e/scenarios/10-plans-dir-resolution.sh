#!/usr/bin/env bash
SCENARIO="S10 plans-dir-resolution"
source "$(dirname "$0")/../lib.sh"

# Variant A: plansDirectory in settings.local.json
# Variant B: plansDirectory only in settings.json
# Variant C: neither — relies on fallback; we stub HOME to an empty tmp dir and
#            expect "no plan files in <HOME>/.claude/plans".

run_variant_a() {
  SCENARIO="S10a local-settings"
  e2e_init_sandbox
  trap 'e2e_cleanup' RETURN
  run_cli init
  e2e_set_plans_dir "$PLANS_DIR"
  FIX="$(cd "$(dirname "$0")/../fixtures" && pwd)"
  cp "$FIX/plan-b.md" "$PLANS_DIR/plan.md"

  SID="sess-S10a"
  PAYLOAD=$(node -e "console.log(JSON.stringify({session_id:'$SID',cwd:process.argv[1],tool_name:'ExitPlanMode'}))" "$CWD")
  run_cli capture-plan "$PAYLOAD"
  assert_exit_zero "variant-a exit"
  assert_contains "variant-a used local" "$CLI_STDOUT" "captured plan"
  assert_eq "variant-a stored" "$(find "$STATE_ROOT/plans" -name '*.md' 2>/dev/null | wc -l | tr -d ' ')" "1"
}

run_variant_b() {
  SCENARIO="S10b workspace-settings"
  e2e_init_sandbox
  trap 'e2e_cleanup' RETURN
  run_cli init
  # Delete plansDirectory from settings.local.json if present; put it in settings.json instead.
  local local_settings="$CWD/.claude/settings.local.json"
  local ws_settings="$CWD/.claude/settings.json"
  FIX="$(cd "$(dirname "$0")/../fixtures" && pwd)"
  cp "$FIX/plan-b.md" "$PLANS_DIR/plan.md"
  node -e "
    const fs=require('fs');
    const j=JSON.parse(fs.readFileSync('$local_settings','utf8'));
    delete j.plansDirectory;
    fs.writeFileSync('$local_settings', JSON.stringify(j,null,2)+'\n');
    fs.writeFileSync('$ws_settings', JSON.stringify({plansDirectory:'$PLANS_DIR'},null,2)+'\n');
  "

  SID="sess-S10b"
  PAYLOAD=$(node -e "console.log(JSON.stringify({session_id:'$SID',cwd:process.argv[1],tool_name:'ExitPlanMode'}))" "$CWD")
  run_cli capture-plan "$PAYLOAD"
  assert_exit_zero "variant-b exit"
  assert_contains "variant-b stdout" "$CLI_STDOUT" "captured plan"
}

run_variant_c() {
  SCENARIO="S10c fallback-HOME"
  e2e_init_sandbox
  trap 'e2e_cleanup' RETURN
  run_cli init
  # Override HOME/USERPROFILE to empty sandbox so fallback is empty.
  local fake_home="$SANDBOX/fakehome"
  mkdir -p "$fake_home/.claude/plans"

  SID="sess-S10c"
  PAYLOAD=$(node -e "console.log(JSON.stringify({session_id:'$SID',cwd:process.argv[1],tool_name:'ExitPlanMode'}))" "$CWD")
  local out_file err_file
  out_file="$(mktemp)"; err_file="$(mktemp)"
  printf '%s' "$PAYLOAD" | (cd "$CWD" && HOME="$fake_home" USERPROFILE="$fake_home" node "$DIST_CLI" capture-plan) >"$out_file" 2>"$err_file"
  CLI_EXIT=$?
  CLI_STDOUT="$(cat "$out_file")"; CLI_STDERR="$(cat "$err_file")"
  rm -f "$out_file" "$err_file"

  assert_exit_zero "variant-c exit"
  # Expect "no plan files in <fake_home>/.claude/plans" because variant-c plan dir is empty
  # and no settings.*.json has plansDirectory for this sandbox.
  # But settings.local.json might have been written by init — remove any plansDirectory to be safe.
  # (init doesn't set plansDirectory, so we're fine.)
  assert_contains "variant-c stderr" "$CLI_STDERR" "no plan files"
  assert_path_contains "variant-c uses fake HOME" "$CLI_STDERR" "$fake_home"
}

run_variant_a
run_variant_b
run_variant_c

e2e_finish
