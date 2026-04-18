# Changelog

All notable changes to planlock are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow SemVer once v0.1 ships.

## [Unreleased]

### v0.3.1 — Dogfood-driven patches

- Parser no longer turns an H1 document title containing only a non-path backticked token (e.g. a flag name like `--version`) into a spurious Step; bare headings are kept only when the heading itself carries a real path or a runnable command. Fixes cascading skip-ahead / partial misclassifications where the phantom first step stayed perpetually open.
- Report now falls back to the latest on-disk `parsed.yaml` when a session has no `plan-parsed` event (e.g. the plan was captured by an earlier session). Previously such sessions always rendered the legacy "parsed plan not available" note.
- `strict` mode block now emits the modern Claude Code hook JSON on stdout (`{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":...}}`) in addition to exit 2 + stderr, so newer Claude Code builds that key off the JSON contract see a structured deny reason rather than scraping stderr. `writeBlock` (previously dead) is now the canonical block path.

### v0.3 — Warn / strict modes

- `config.mode` is now live. `observe` (default) keeps the v0.2-a stderr output. `warn` prints a `⚠️ planlock warn (<verdict>)` banner for every non-clean verdict (out-of-scope, skip-ahead, extra, partial) but still exits 0. `strict` blocks `out-of-scope` tool calls with exit 2 and a `planlock strict: blocked — <reason>` stderr line that Claude Code surfaces as the block reason; `skip-ahead` / `extra` / `partial` continue to warn without blocking to avoid over-triggering on legitimate reordering or path-less commands.
- Pure policy function `src/match/policy.ts` decides `{stderr, block}` from `(mode, verdict, reason)` — fully unit tested (12 cases covering every mode × verdict pairing).
- Drift events are still persisted before blocking, so reports remain complete.

### v0.2-a — Heuristic parse + path/op match (observe only)

- Heuristic plan parser (`src/parser/heuristic.ts`) extracts steps, file globs, commands, and operation hints from plan markdown; writes `.planlock/plans/<id>.parsed.yaml` on capture and emits a `plan-parsed` event.
- Match engine (`src/match/engine.ts` + `extract.ts`) scores each tool call against open steps using `0.6·path + 0.3·op + 0.1·seq` and classifies as match / partial / skip-ahead / out-of-scope / extra / neutral. Drift events append to `events.jsonl`.
- `match-tool` reports `out-of-scope` / `skip-ahead` / `extra` verdicts on stderr in observe mode.
- Report upgraded with per-step status, grouped out-of-scope and extra sections, and a 0–100 drift score. Sessions without a parsed plan fall back to the v0.1 note.
- Config `thresholds.match` / `thresholds.partial` now drive match/partial cutoffs (defaults 0.7 / 0.4). `mode: warn|strict` still behaves as `observe` — wired in v0.3+.

### v0.1 — Passive capture

- PreToolUse hook on `ExitPlanMode` copies plan from `plansDirectory` into `.planlock/plans/<id>.md`
- PreToolUse wildcard logs every tool call to `.planlock/sessions/<id>/events.jsonl`
- `planlock init` writes hook registration + `.gitignore`
- No parsing, no matching, no reporting — purely audit trail
