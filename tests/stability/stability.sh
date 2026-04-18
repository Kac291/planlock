#!/usr/bin/env bash
# Stability / stress scenarios for planlock v0.2-a.
# Exercises resilience + perf beyond the normal e2e suite.

set -u
SCENARIO="stability"

_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$_dir/../e2e/lib.sh"

e2e_init_sandbox
e2e_trap_cleanup
e2e_set_plans_dir "$PLANS_DIR"

run_cli init >/dev/null 2>&1

# ---------------------------------------------------------------
# A. Corrupted parsed.yaml — only-corrupt case
# ---------------------------------------------------------------
log "A. only a corrupt parsed.yaml exists → match-tool falls back gracefully"

STORE_DIR="$STATE_ROOT/plans"
mkdir -p "$STORE_DIR"
printf '::: not yaml : }}}\n- - - - -\n' > "$STORE_DIR/broken-only.parsed.yaml"

SID="sess-stability-A"
PAYLOAD=$(cat <<JSON
{"session_id":"$SID","transcript_path":"/tmp/t","cwd":"$CWD","hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"src/whatever.ts"}}
JSON
)
run_cli match-tool "$PAYLOAD"
assert_exit_zero "match-tool with only-corrupt yaml"

EVT="$(e2e_session_events_file "$SID")"
TC=$(count_events "$EVT" "tool-call")
DR=$(count_events "$EVT" "drift")
assert_eq "tool-call recorded" "$TC" "1"
assert_eq "no drift event (corrupt yaml)" "$DR" "0"

# ---------------------------------------------------------------
# B. Corrupted newest + valid older → picks valid older
# ---------------------------------------------------------------
log "B. newest yaml corrupt, older yaml valid → engine uses older"

cat > "$STORE_DIR/old-good.parsed.yaml" <<'YAML'
version: 1
steps:
  - id: s1
    summary: edit src/billing/invoice.ts
    scope:
      files: ["src/billing/invoice.ts"]
      commands: []
      operations: ["Edit", "Write"]
    dependencies: []
YAML
# Ensure older mtime; then newest = corrupt one already on disk. Touch broken to future.
# On Windows touch -d may differ; use node fs.utimesSync for reliability.
node -e "
const fs=require('fs');
fs.utimesSync('$STORE_DIR/old-good.parsed.yaml', new Date(Date.now()-10000)/1000, new Date(Date.now()-10000)/1000);
fs.utimesSync('$STORE_DIR/broken-only.parsed.yaml', new Date()/1000, new Date()/1000);
"

SID="sess-stability-B"
PAYLOAD=$(cat <<JSON
{"session_id":"$SID","transcript_path":"/tmp/t","cwd":"$CWD","hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"src/billing/invoice.ts"}}
JSON
)
run_cli match-tool "$PAYLOAD"
assert_exit_zero "match-tool skips corrupt, uses valid older"

EVT="$(e2e_session_events_file "$SID")"
DR=$(count_events "$EVT" "drift")
assert_eq "drift emitted from older yaml" "$DR" "1"
VERDICT=$(node -e "
const fs=require('fs');
const lines=fs.readFileSync('$EVT','utf8').split('\n').filter(l=>l.trim());
for (const l of lines) { const e=JSON.parse(l); if(e.type==='drift'){ process.stdout.write(e.verdict); break; } }
")
assert_eq "older yaml produces match" "$VERDICT" "match"

# ---------------------------------------------------------------
# C. Garbage events.jsonl mid-stream
# ---------------------------------------------------------------
log "C. garbage lines in events.jsonl don't crash replay"

SID="sess-stability-C"
EVT="$(e2e_session_events_file "$SID")"
mkdir -p "$(dirname "$EVT")"
# Legitimate tool-call + garbage + legitimate drift.
cat > "$EVT" <<JSONL
{"type":"tool-call","timestamp":"2026-04-18T00:00:00Z","sessionId":"$SID","cwd":"$CWD","toolName":"Edit","toolInput":{"file_path":"src/billing/invoice.ts"}}
THIS IS NOT JSON
{"broken": "missing required fields"}
{"type":"drift","timestamp":"2026-04-18T00:00:01Z","sessionId":"$SID","cwd":"$CWD","verdict":"match","toolName":"Edit","paths":["src/billing/invoice.ts"],"stepId":"s1","score":0.95,"reason":"manual"}
JSONL

# Remove B's corrupt yaml so findLatestParsedPlan picks up only the good one.
rm -f "$STORE_DIR/broken-only.parsed.yaml"

PAYLOAD=$(cat <<JSON
{"session_id":"$SID","transcript_path":"/tmp/t","cwd":"$CWD","hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"src/billing/invoice.ts"}}
JSON
)
run_cli match-tool "$PAYLOAD"
assert_exit_zero "match-tool tolerates garbage events"

# The pre-seeded drift has stepId s1, so s1 is already done → skip-ahead or extra.
DR=$(count_events "$EVT" "drift")
if [[ "$DR" -ge 2 ]]; then
  pass "new drift appended despite garbage (total $DR)"
else
  fail "expected ≥2 drift events, got $DR"
fi

# ---------------------------------------------------------------
# D. Replay perf — 500-event session
# ---------------------------------------------------------------
log "D. 500-event session replay stays under budget"

SID="sess-stability-D"
EVT="$(e2e_session_events_file "$SID")"
mkdir -p "$(dirname "$EVT")"

node -e "
const fs=require('fs');
const lines=[];
for (let i=0;i<500;i++) {
  lines.push(JSON.stringify({
    type:'tool-call', timestamp:new Date().toISOString(),
    sessionId:'$SID', cwd:'$CWD', toolName:'Edit',
    toolInput:{file_path:'src/noise-'+i+'.ts'}
  }));
}
fs.writeFileSync('$EVT', lines.join('\n')+'\n');
"

START=$(node -e "process.stdout.write(String(Date.now()))")
PAYLOAD=$(cat <<JSON
{"session_id":"$SID","transcript_path":"/tmp/t","cwd":"$CWD","hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"src/billing/invoice.ts"}}
JSON
)
run_cli match-tool "$PAYLOAD"
END=$(node -e "process.stdout.write(String(Date.now()))")
DT=$((END-START))
echo "       match-tool wall time with 500-event history: ${DT}ms"

assert_exit_zero "match-tool over 500-event session"
if [[ "$DT" -lt 2000 ]]; then
  pass "replay under 2000ms ($DT ms)"
else
  fail "replay too slow: ${DT}ms"
fi

# ---------------------------------------------------------------
# E. Concurrent match-tool calls — events.jsonl append atomicity
# ---------------------------------------------------------------
log "E. 10 parallel match-tool writes don't corrupt events.jsonl"

SID="sess-stability-E"
EVT="$(e2e_session_events_file "$SID")"
mkdir -p "$(dirname "$EVT")"

PAYLOAD=$(cat <<JSON
{"session_id":"$SID","transcript_path":"/tmp/t","cwd":"$CWD","hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"src/billing/invoice.ts"}}
JSON
)

PIDS=()
for i in $(seq 1 10); do
  (printf '%s' "$PAYLOAD" | (cd "$CWD" && node "$DIST_CLI" match-tool) >/dev/null 2>&1) &
  PIDS+=($!)
done
for p in "${PIDS[@]}"; do wait "$p"; done

# Each CLI invocation writes 2 events (tool-call + drift) → expect 20 lines; all lines must parse.
LINES=$(count_lines "$EVT")
PARSED=$(node -e "
const fs=require('fs');
const lines=fs.readFileSync('$EVT','utf8').split('\n').filter(l=>l.trim());
let ok=0,bad=0;
for (const l of lines) { try { JSON.parse(l); ok++; } catch { bad++; } }
process.stdout.write(ok+' '+bad);
")
OKC=$(echo "$PARSED" | cut -d' ' -f1)
BADC=$(echo "$PARSED" | cut -d' ' -f2)
echo "       events.jsonl lines=$LINES parsed_ok=$OKC parsed_bad=$BADC"

if [[ "$LINES" -ge 18 && "$LINES" -le 22 ]]; then
  pass "event count within tolerance ($LINES)"
else
  fail "event count unexpected: $LINES (expected ~20)"
fi
assert_eq "no corrupt JSONL lines" "$BADC" "0"

# ---------------------------------------------------------------
e2e_finish
