# Changelog

All notable changes to planlock are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow SemVer once v0.1 ships.

## [Unreleased]

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
