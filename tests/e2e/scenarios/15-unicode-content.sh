#!/usr/bin/env bash
# v0.2 plan parser will do string ops on plan bodies. If v0.1 mangles Unicode at
# either capture (plan copy) or log (tool_input JSON round-trip), every downstream
# match will silently miscompare. Guard it here.
SCENARIO="S15 unicode-content"
source "$(dirname "$0")/../lib.sh"
e2e_init_sandbox
e2e_trap_cleanup

run_cli init
e2e_set_plans_dir

# Plan with CJK + emoji + mixed line endings.
cat > "$PLANS_DIR/plan-u.md" <<'EOF'
# 计划 🔒

- 步骤一：读取 README.md 并总结要点
- 步骤二：修改 src/测试.ts
- 步骤三：运行 pnpm test ✅
EOF

SID="sess-S15"
PAYLOAD=$(node -e "console.log(JSON.stringify({session_id:'$SID',cwd:process.argv[1],tool_name:'ExitPlanMode',tool_input:{}}))" "$CWD")
run_cli capture-plan "$PAYLOAD"
assert_exit_zero "capture-plan unicode"

stored="$(find "$STATE_ROOT/plans" -name '*.md' | head -n1)"
assert_file_exists "$stored"

# Byte-exact equality: no re-encoding, no BOM injected.
if cmp -s "$stored" "$PLANS_DIR/plan-u.md"; then
  pass "stored plan byte-identical to source"
else
  fail "stored plan differs from source (encoding mangled)"
fi

# tool_input round-trip with Chinese + emoji.
TI_PAYLOAD=$(node -e "console.log(JSON.stringify({session_id:'$SID',cwd:process.argv[1],tool_name:'Edit',tool_input:{file_path:'src/测试.ts',note:'修复 🐛'}}))" "$CWD")
run_cli match-tool "$TI_PAYLOAD"
assert_exit_zero "match-tool unicode"

events="$(e2e_session_events_file "$SID")"
# Pull the tool-call event and verify fields survive.
round=$(node -e "
  const fs=require('fs');
  const l=fs.readFileSync('$events','utf8').trim().split('\n').filter(Boolean);
  const ev=l.map(x=>JSON.parse(x)).find(e=>e.type==='tool-call');
  process.stdout.write(JSON.stringify({fp:ev.toolInput.file_path,note:ev.toolInput.note}));
")
assert_eq "unicode fields round-trip" "$round" '{"fp":"src/测试.ts","note":"修复 🐛"}'

e2e_finish
