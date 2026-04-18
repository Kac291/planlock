# planlock

> Keep Claude Code honest to its own plan. Real-time, verifiable drift detection for plan mode.

**Status:** v0.1 alpha — passive capture working. v0.2 (matching + drift report) in progress.

---

## The Problem

You ask Claude to plan first. It produces a tidy 9-step plan. You approve.

Then it executes — and **does 5 steps, skips 2, invents 3 of its own, touches files that were never in scope**. You only notice during code review, or worse, after merge.

Real user report (anthropics/claude-code#32253):
> *"When Claude exits plan mode, Claude abandons our plan and only does parts that Claude wants to do."*

Half-migrated codebases, silent scope creep, plans that Claude wrote but didn't keep.

---

## "Doesn't Claude Code already track this?"

Fair question. It has a plan file and a built-in todo list (`TaskCreate`/`TodoWrite`). So why a separate tool?

**Because Claude is the one filling out both, and grading its own work.**

|                          | `TaskCreate` / `TodoWrite` (built-in) | **planlock**                                       |
| ------------------------ | ------------------------------------- | -------------------------------------------------- |
| Who authors the list     | **Claude**, mid-flight                | The **plan you approved**, frozen at exit          |
| Who marks things done    | **Claude self-reports**               | Tool calls scored against plan scope               |
| Detects skipped steps    | Only if Claude admits it              | Yes — steps without matching calls surface as SKIP |
| Detects out-of-scope edits | No — nothing watches file paths     | Yes — glob match against each step's scope         |
| Detects invented work    | No — Claude can add todos on the fly  | Yes — calls with no matching step flagged as EXTRA |
| Can block a rogue edit   | No — advisory only                    | Yes — `strict` mode returns exit 2 to Claude Code  |
| Survives the session     | No — lives in memory only             | Yes — JSONL audit trail + markdown report on disk  |
| Works without Claude's cooperation | No — Claude narrates itself   | Yes — independent hook pipeline                    |

**The one-liner:** `TaskCreate` is Claude's journal. **planlock is the surveillance camera.** A journal can be edited. A camera cannot.

This matters because the whole failure mode of issue #32253 is **Claude's self-report diverging from reality**. A tool built on self-report cannot detect the problem it is supposed to solve.

---

## What planlock actually does

A watchdog that sits between your approved plan and Claude's execution:

1. **Captures the plan** the moment you exit plan mode (`PreToolUse` hook on `ExitPlanMode` → reads `plansDirectory`)
2. **Parses it into discrete steps** — files touched, commands run, behaviors promised
3. **Intercepts every tool call** and scores it against open steps
4. **Flags deviations in real time** — skipped steps, scope jumps, files outside the plan
5. **Reports on completion** — what landed, what didn't, what was extra

Zero config. `npx planlock init` once. Exit plan mode like usual. planlock handles the rest.

---

## What it catches

```
✅ MATCH    Step 3 "Extract auth middleware to src/auth/"
            Edit(src/auth/middleware.ts)

⚠️  SKIP     Step 2 "Add tests for login flow" — not started after 6 calls

❌ OUT      Tool call touches src/billing/invoice.ts
            — not referenced by any plan step

⚠️  JUMP    Now executing Step 7, but Steps 4-5 incomplete

📦 EXTRA    Created src/utils/debounce.ts — invented, not in plan
```

None of the above is detectable from Claude's own todo list — the todo list is Claude saying "I did step 3 ✅", not the world saying "a file outside scope just got written."

---

## Architecture

```
┌──────────────┐    exit     ┌────────────────────┐
│ Plan Mode    │──plan────►  │  planlock capture  │  (PreToolUse: ExitPlanMode)
│ (Claude)     │             └──────┬─────────────┘
└──────────────┘                    │
                                    ▼
                          ┌────────────────────┐
                          │ Plan parser        │  (heuristic → Haiku fallback)
                          │  → step list       │
                          └──────┬─────────────┘
                                 │
                                 ▼
                          ┌────────────────────┐
┌──────────────┐          │  step-match engine │
│ Claude Code  │──tool──► │  (PreToolUse: *)   │
│  tool calls  │ call     │                    │
└──────────────┘          │  MATCH / SKIP /    │
       ▲                  │  OUT / JUMP /      │
       │                  │  EXTRA             │
       │                  └──────┬─────────────┘
       │                         │
       │                         ▼
       │                  ┌────────────────────┐
       │◄─────warning─────│   Decision         │
              block       │   allow / warn /   │
                          │   block (opt-in)   │
                          └────────────────────┘

                          Stop hook → .planlock/sessions/<id>/report.md
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for data flow, scoring formula, hook registration details.

---

## Modes

| Mode         | Behavior                                                     | When to use                                |
| ------------ | ------------------------------------------------------------ | ------------------------------------------ |
| **observe** (default) | Log every drift event, never block. Report at session end.   | First-time users, CI, safe default         |
| **warn**     | Inject a `<planlock-notice>` into Claude's next turn. Claude sees it, can self-correct. | Daily driver — nudge without interrupting |
| **strict**   | Return exit 2 + `{block, reason}` JSON when a tool call falls outside plan scope. | Large refactors, merge freezes, CI         |

---

## Quick start

```bash
# One-shot setup in your project
npx planlock init

# Next session:
#   Shift+Tab twice → plan mode → get plan → approve
#   planlock auto-activates, watches every tool call

# During session
/planlock status           # progress so far
/planlock report           # drift events accumulated

# After session
cat .planlock/sessions/<id>/report.md
```

To change mode, edit `.planlock/config.yaml`:
```yaml
mode: warn   # observe | warn | strict
```

---

## Roadmap

- [x] v0.1 — Passive capture + audit log (**shipped**)
- [ ] v0.2 — Heuristic + Haiku plan parser, match engine, drift report (launch milestone)
- [ ] v0.3 — Warn mode: inject feedback to Claude mid-session
- [ ] v0.4 — Strict mode: `PreToolUse` block on out-of-scope calls
- [ ] v0.5 — GitHub Action: drift report as PR comment
- [ ] v1.0 — VS Code extension with live drift panel

---

## Why this is the right shape of fix

- **The pain is on Anthropic's own tracker.** Issue #32253, unresolved, active.
- **No direct competitor.** Every existing Claude Code monitor tracks tokens, errors, or costs — none compares plan vs. execution. Checked exhaustively.
- **Uses only public hooks.** No kernel modules, no protocol changes, no upstream dependency. Works today.
- **Orthogonal to built-ins, not redundant.** `TaskCreate` and planlock can run side-by-side — one is Claude's self-narration, the other is the audit.
- **Compounds with plan mode.** The more planlock is trusted, the safer plan mode feels, the more you use plan mode — the more plans it has to guard. Virtuous loop.

---

## Not this project

- **Not a plan generator** — Claude already writes good plans. planlock only enforces.
- **Not a replacement for code review** — drift reports complement, not replace.
- **Not a style/lint tool** — scope, not opinion.
- **Not an IDE rewrite** — just a hook binary + state directory.

---

## Risks & mitigations

| Risk                                                  | Mitigation                                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Plan parser misreads intent                           | Haiku + deterministic fallback; user can edit `parsed.yaml` before first tool call lands       |
| Fuzzy match produces false drift alerts               | Confidence scores; only hard-block above threshold; `ignore_minor_extras` config               |
| Adds latency to every tool call                       | Match runs on cached step list; <50ms target; async for Haiku semantic scoring                 |
| Anthropic ships native plan enforcement               | Pivot to cross-session drift analytics + team dashboards; scoring engine & audit log survive   |
| `ExitPlanMode` or hook schema changes upstream        | Payload schemas use `.passthrough()`; CI matrix runs against latest 2 Claude Code releases     |

---

## Contributing

Design still in flux — not accepting PRs yet. **Issues welcome**, especially:
- Real `.planlock/report.md` files from your sessions (drift patterns help tune the parser)
- Cases where planlock flags something that wasn't actually drift (false positives)
- Plan-mode workflows we haven't considered

## License

MIT — see [LICENSE](./LICENSE).
