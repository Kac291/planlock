#!/usr/bin/env bash
SCENARIO="S2 init-idempotent"
source "$(dirname "$0")/../lib.sh"
e2e_init_sandbox
e2e_trap_cleanup

run_cli init
assert_exit_zero "init #1"
first="$(cat "$CWD/.claude/settings.local.json")"

run_cli init
assert_exit_zero "init #2"
second="$(cat "$CWD/.claude/settings.local.json")"

assert_eq "settings unchanged" "$second" "$first"

gi_content="$(cat "$CWD/.gitignore")"
dup_count=$(printf '%s\n' "$gi_content" | grep -c "^\.planlock/$" || true)
assert_eq ".gitignore has one .planlock/ entry" "$dup_count" "1"

e2e_finish
