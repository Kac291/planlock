#!/usr/bin/env bash
SCENARIO="S5 capture-plan-bad-payload"
source "$(dirname "$0")/../lib.sh"
e2e_init_sandbox
e2e_trap_cleanup

run_cli init

run_cli capture-plan '{"foo":"bar"}'
assert_exit_zero "capture-plan (bad payload)"
assert_contains "stderr" "$CLI_STDERR" "invalid payload"

# No session dir should have been created because schema rejected before any write.
assert_file_absent "$STATE_ROOT/sessions"
assert_file_absent "$STATE_ROOT/plans"

# Also verify truly empty stdin doesn't crash.
run_cli capture-plan ""
assert_exit_zero "capture-plan (empty stdin)"
assert_contains "stderr empty-stdin" "$CLI_STDERR" "no stdin payload"

e2e_finish
