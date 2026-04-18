# Changelog

All notable changes to planlock are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow SemVer once v0.1 ships.

## [Unreleased]

### v0.1 — Passive capture

- PreToolUse hook on `ExitPlanMode` copies plan from `plansDirectory` into `.planlock/plans/<id>.md`
- PreToolUse wildcard logs every tool call to `.planlock/sessions/<id>/events.jsonl`
- `planlock init` writes hook registration + `.gitignore`
- No parsing, no matching, no reporting — purely audit trail
