#!/usr/bin/env bash
# E2E helpers for planlock v0.1.
# Each scenario sources this file, then calls `e2e_init_sandbox` to get $SANDBOX/$PLANS_DIR/$CWD.
# All paths are contained inside a mktemp -d so $HOME is never touched.

set -u

# Resolve CLI path once. Scenarios shouldn't have to know where dist lives.
_E2E_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Convert a bash path to a form node (Windows-native) and bash both agree on.
# Git-Bash MSYS paths like "/d/foo" get reinterpreted by Windows node as "D:\d\foo".
# cygpath -m yields "D:/foo" (mixed form) which is safe for both.
_e2e_winpath() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$1"
  else
    printf '%s' "$1"
  fi
}

E2E_ROOT="$(_e2e_winpath "$_E2E_LIB_DIR")"
DIST_CLI="$(_e2e_winpath "$(cd "$_E2E_LIB_DIR/../.." && pwd)")/dist/cli.js"

if [[ ! -f "$DIST_CLI" ]]; then
  echo "FATAL: dist/cli.js missing at $DIST_CLI — run 'pnpm build' first" >&2
  exit 2
fi

# Colors (plain if not a tty)
if [[ -t 1 ]]; then
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RESET=$'\033[0m'
else
  C_RED=''; C_GREEN=''; C_YELLOW=''; C_RESET=''
fi

E2E_FAILS=0

log()  { printf '%s[e2e]%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
pass() { printf '%s  PASS%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
fail() { printf '%s  FAIL%s %s\n' "$C_RED" "$C_RESET" "$*"; E2E_FAILS=$((E2E_FAILS+1)); }

# Run CLI inside $CWD with given stdin (may be empty). Captures stdout/stderr/exit.
# Usage: run_cli <subcommand> [stdin_payload]
# Sets: CLI_STDOUT, CLI_STDERR, CLI_EXIT
run_cli() {
  local subcmd="$1"
  local stdin="${2-}"
  local out_file err_file
  out_file="$(mktemp)"
  err_file="$(mktemp)"
  if [[ -n "$stdin" ]]; then
    printf '%s' "$stdin" | (cd "$CWD" && node "$DIST_CLI" "$subcmd") >"$out_file" 2>"$err_file"
  else
    (cd "$CWD" && node "$DIST_CLI" "$subcmd") >"$out_file" 2>"$err_file" </dev/null
  fi
  CLI_EXIT=$?
  CLI_STDOUT="$(cat "$out_file")"
  CLI_STDERR="$(cat "$err_file")"
  rm -f "$out_file" "$err_file"
  return 0
}

assert_eq() {
  local label="$1" actual="$2" expected="$3"
  if [[ "$actual" == "$expected" ]]; then
    pass "$label = $expected"
  else
    fail "$label: expected '$expected', got '$actual'"
  fi
}

assert_exit_zero() {
  local label="$1"
  if [[ "$CLI_EXIT" -eq 0 ]]; then
    pass "$label exit=0"
  else
    fail "$label exit=$CLI_EXIT (stderr: $CLI_STDERR)"
  fi
}

assert_file_exists() {
  local p="$1"
  if [[ -f "$p" ]]; then pass "file exists: $p"; else fail "file missing: $p"; fi
}

assert_file_absent() {
  local p="$1"
  if [[ ! -e "$p" ]]; then pass "file absent: $p"; else fail "file exists but should not: $p"; fi
}

assert_contains() {
  local label="$1" haystack="$2" needle="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    pass "$label contains '$needle'"
  else
    fail "$label missing '$needle' — got: $(printf '%s' "$haystack" | head -c 200)"
  fi
}

assert_path_contains() {
  local label="$1" haystack="$2" needle="$3"
  local h n
  h="$(printf '%s' "$haystack" | tr '\\' '/')"
  n="$(printf '%s' "$needle" | tr '\\' '/')"
  if [[ "$h" == *"$n"* ]]; then
    pass "$label path contains '$needle'"
  else
    fail "$label path missing '$needle' — got: $(printf '%s' "$haystack" | head -c 200)"
  fi
}

assert_not_contains() {
  local label="$1" haystack="$2" needle="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    pass "$label does not contain '$needle'"
  else
    fail "$label unexpectedly contains '$needle'"
  fi
}

# Count JSONL lines of given event type.
count_events() {
  local file="$1" type="$2"
  if [[ ! -f "$file" ]]; then echo 0; return; fi
  # Use node for robust JSON parsing (avoids jq dependency).
  node -e "
    const fs=require('fs');
    const lines=fs.readFileSync('$file','utf8').split('\n').filter(l=>l.trim());
    let n=0;
    for(const l of lines){try{if(JSON.parse(l).type==='$type')n++;}catch{}}
    process.stdout.write(String(n));
  "
}

# Count total JSONL lines.
count_lines() {
  local file="$1"
  if [[ ! -f "$file" ]]; then echo 0; return; fi
  local n=0
  while IFS= read -r line; do [[ -n "$line" ]] && n=$((n+1)); done < "$file"
  echo "$n"
}

# Create an isolated sandbox. After call:
#   $SANDBOX      — root (safe to rm -rf)
#   $CWD          — the fake project dir (pwd for CLI calls)
#   $PLANS_DIR    — directory that .claude/settings.local.json will point to via plansDirectory
#   $STATE_ROOT   — $CWD/.planlock
#   $SESSION_DIR  — filled once a sessionId is known (use e2e_session_dir)
e2e_init_sandbox() {
  mkdir -p "$E2E_ROOT/.tmp"
  SANDBOX="$(_e2e_winpath "$(mktemp -d "$E2E_ROOT/.tmp/sandbox-XXXXXX")")"
  CWD="$SANDBOX/project"
  PLANS_DIR="$SANDBOX/plans"
  mkdir -p "$CWD" "$PLANS_DIR"
  STATE_ROOT="$CWD/.planlock"
}

# Write plansDirectory into .claude/settings.local.json (merged into whatever init wrote).
e2e_set_plans_dir() {
  local target="${1:-$PLANS_DIR}"
  local settings="$CWD/.claude/settings.local.json"
  mkdir -p "$(dirname "$settings")"
  if [[ -f "$settings" ]]; then
    node -e "
      const fs=require('fs');
      const p='$settings';
      const j=JSON.parse(fs.readFileSync(p,'utf8'));
      j.plansDirectory='$target';
      fs.writeFileSync(p, JSON.stringify(j,null,2)+'\n');
    "
  else
    node -e "
      const fs=require('fs');
      fs.writeFileSync('$settings', JSON.stringify({plansDirectory:'$target'},null,2)+'\n');
    "
  fi
}

e2e_session_events_file() {
  local sid="$1"
  echo "$STATE_ROOT/sessions/$sid/events.jsonl"
}

e2e_session_report_file() {
  local sid="$1"
  echo "$STATE_ROOT/sessions/$sid/report.md"
}

e2e_cleanup() {
  if [[ -n "${SANDBOX:-}" && -d "$SANDBOX" ]]; then
    rm -rf "$SANDBOX"
  fi
}

# Scenarios register cleanup via this trap.
e2e_trap_cleanup() {
  trap 'e2e_cleanup' EXIT
}

# Scenario summary. Returns non-zero if any assertion failed.
e2e_finish() {
  if [[ "$E2E_FAILS" -gt 0 ]]; then
    printf '%s[%s FAILED — %d assertion(s)]%s\n' "$C_RED" "${SCENARIO:-scenario}" "$E2E_FAILS" "$C_RESET"
    exit 1
  fi
  printf '%s[%s OK]%s\n' "$C_GREEN" "${SCENARIO:-scenario}" "$C_RESET"
  exit 0
}
