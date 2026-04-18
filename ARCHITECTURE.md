# Architecture — planlock

## What plan mode gives us

When a user invokes plan mode (Shift+Tab twice):

1. Claude thinks and **writes the plan to a markdown file** at `~/.claude/plans/<random-name>.md` (default; configurable via `plansDirectory` in `settings.json`, can be resolved to project root)
2. Claude calls the `ExitPlanMode` tool — **no arguments**; it just signals "plan file is ready, please approve"
3. User approves (or rejects); on approve Claude leaves plan mode and begins executing against that file

This means the plan is on disk **before** `ExitPlanMode` fires. We don't need to read args from the tool call — we read the file.

Hook-points for capture (in order of preference):

- **PreToolUse on `ExitPlanMode`** → resolve `plansDirectory` from settings → read the newest `.md` file there. Reliable: the file is guaranteed to exist at this point.
- **Filesystem watcher on `plansDirectory`** — fallback for environments where hooks aren't available.
- **User-driven** — `/planlock lock <plan-path>` slash command. Last-resort fallback.

v0.1 uses PreToolUse + plan-file read. Matches official behavior.

### Plan file → session correlation

`plansDirectory` is **user-level by default** (shared across projects). The same directory accumulates plans from every project. To correlate plan → current session:

- The hook receives the session id + cwd in its stdin payload
- Store `{plan_file, session_id, cwd, mtime}` in `.planlock/sessions/<id>/plan.json` at capture time
- If multiple sessions run in parallel, mtime + cwd in the plan file's frontmatter (if present) disambiguates. Worst case: ask user.

## Why not just subscribe to `TaskCreate` / `TodoWrite`?

Claude Code ships a built-in todo list (`TaskCreate`, `TaskUpdate`) that Claude uses mid-session to track its own work. At first glance it looks overlapping with planlock. It is not — and the data model tells you why.

### Three structural gaps

**1. Authorship.** `TaskCreate` lists are **authored by Claude at execution time**, not by the user at plan-approval time. Nothing ties a task entry back to the approved plan. Claude can:
- Skip tasks it decides are unnecessary
- Invent tasks that were never in the plan
- Rephrase plan steps into tasks that look different enough to lose their identity

The approved plan file is the only artifact that is **frozen at the moment of user consent**. planlock treats that file as the source of truth. `TaskCreate` lists are downstream narration.

**2. Data shape.** A `TaskCreate` entry carries a subject + status. It has **no scope field**: no file globs, no command list, no operation whitelist. So even a perfect `TaskCreate` subscriber could not answer "is this `Edit(src/billing/invoice.ts)` call inside or outside the plan?" — the data to answer that question is not on the task.

planlock's `Step.scope = { files, commands, operations }` is purpose-built for matching. It is generated from parsing the plan text, not from reading tasks.

**3. Ground truth.** `TaskCreate` status transitions are **self-reported by Claude**. A task marked `completed` does not mean the promised work actually shipped — it means Claude chose to mark it complete. Real user report from anthropics/claude-code#32253 is exactly this drift between self-report and reality.

planlock verdicts are derived from **observed tool calls** (via `PreToolUse` payload, which Claude cannot forge — the hook fires before execution). The audit is tool-call-level, not narrative-level.

### What this means in practice

| Question                                           | `TaskCreate` subscriber | planlock        |
| -------------------------------------------------- | ----------------------- | --------------- |
| Did tool call X match the approved plan?           | Cannot tell (no scope)  | Scored 0–1      |
| Did Claude quietly skip a planned step?            | Only if Claude says so  | Detectable      |
| Did Claude edit a file outside the plan?           | Invisible               | Flagged as OUT  |
| Can we block a rogue edit before it lands?         | No                      | `strict` mode   |
| Is the audit trail tamper-proof vs. Claude's narrative? | No                  | Yes             |

`TaskCreate` and planlock operate on **different layers**: `TaskCreate` is Claude's self-narration layer, planlock is the tool-call audit layer. They are designed to coexist, not replace each other. `TaskCreate` still helps the human operator skim progress mid-session; planlock still tells them whether the progress was real.

### Corollary: we can't shortcut the parser

A tempting shortcut would be: "skip the plan-markdown parser, just listen to `TaskCreate` events and match tool calls against task subjects." This fails for all three reasons above — most fatally, task subjects carry no scope, so the match engine has nothing to match against. The markdown parser is load-bearing: it is what extracts file globs, command patterns, and operation hints out of the frozen plan. There is no substitute on the built-in side of the wall.

## Data flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. CAPTURE                                                  │
│                                                             │
│  ExitPlanMode call  ──►  raw plan markdown                  │
│                          ↓                                  │
│                          save to .planlock/plans/<id>.md    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. PARSE                                                    │
│                                                             │
│  plan markdown  ──►  structured steps                       │
│                                                             │
│  Step {                                                     │
│    id: "s3",                                                │
│    summary: "Extract auth middleware to src/auth/",         │
│    scope: {                                                 │
│      files: ["src/auth/**", "src/middleware/auth*"],        │
│      commands: [],                                          │
│      operations: ["Edit", "Write"],                         │
│    },                                                       │
│    dependencies: ["s1", "s2"],                              │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. MATCH (per tool call)                                    │
│                                                             │
│  PreToolUse hook fires → ToolCall payload                   │
│                          ↓                                  │
│  extract(payload) → { tool, path?, cmd? }                   │
│                          ↓                                  │
│  score each open Step → best match                          │
│                          ↓                                  │
│  verdict: match | skip-ahead | out-of-scope | extra         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. ACT                                                      │
│                                                             │
│  observe  → append to drift log, return 0                   │
│  warn     → append + inject system message to next turn     │
│  strict   → block with exit code 2 + explanation            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. REPORT (on Stop hook)                                    │
│                                                             │
│  Emit .planlock/report.md:                                  │
│   - Completed steps                                         │
│   - Skipped steps                                           │
│   - Out-of-scope events                                     │
│   - Extra work (not in plan)                                │
│   - Drift score (0-100)                                     │
└─────────────────────────────────────────────────────────────┘
```

## Step parsing

Plans are free-form markdown. We need structured steps. Two strategies layered:

### Strategy 1: Deterministic heuristics (fast, free)

- Split on headings (`##`, `###`) and numbered lists
- Extract glob-like paths (`src/...`, `*.ts`)
- Extract commands (backtick-wrapped shell)
- Assign sequential IDs

Works on most Claude-generated plans because Claude tends to produce consistent structure.

### Strategy 2: Haiku-powered parse (fallback)

When deterministic parse yields fewer than N steps or low structural confidence, call Haiku with a fixed prompt:

```
You receive a Claude Code plan as markdown.
Output JSON: { steps: [{ summary, scope: { files, commands, ops }, deps }] }
Do not invent scope. If the plan doesn't specify files, leave files empty.
```

One call per plan, cached to disk.

### User override

After parse, write to `.planlock/plans/<id>.parsed.yaml`. User can edit before first tool call lands. If edited, planlock uses the edited version.

## Match scoring

For each incoming tool call, score each open (not-yet-completed) step:

```
path_match_score    = 0..1   (glob overlap with step.scope.files)
op_match_score      = 0..1   (tool name in step.scope.operations)
semantic_score      = 0..1   (Haiku: "does this call advance this step?", cached)
sequence_penalty    = 0..1   (how many earlier steps are still open)

total = 0.4*path + 0.2*op + 0.3*semantic + 0.1*(1 - sequence_penalty)
```

**Verdict rules:**

- `total ≥ 0.7` → **match**, advance step
- `0.4 ≤ total < 0.7` **and** path matches → **partial**, log but accept
- `total < 0.4` → examine why:
  - path outside any step's scope → **out-of-scope**
  - step jump detected → **skip-ahead**
  - no corresponding step at all → **extra**

## Semantic scoring with Haiku

Only invoked when path/op scoring is ambiguous (saves cost). Prompt:

```
Given plan step: "{summary}"
And tool call: {tool}({args})
Does this call directly advance the step? yes/no/partial, reason under 10 words.
```

Response cached by (step_id, hash(tool_args)) so repeated similar calls don't re-spend.

## Hook registration

`.claude/settings.local.json` additions (planlock writes these during `planlock init`):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "ExitPlanMode",
        "hooks": [{ "type": "command", "command": "planlock capture-plan" }]
      },
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": "planlock match-tool" }]
      }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "planlock report" }] }
    ]
  }
}
```

All hook commands are single binary invocations; planlock keeps state in `.planlock/state.json` (append-only events, rebuilt on startup).

## State layout

```
.planlock/
├── config.yaml              # mode (observe|warn|strict), thresholds
├── plans/
│   └── <plan-id>.md         # raw captured plan
│   └── <plan-id>.parsed.yaml# structured steps (user-editable)
├── sessions/
│   └── <session-id>/
│       ├── events.jsonl     # every tool call + verdict
│       ├── state.json       # current step progress
│       └── report.md        # on session end
└── cache/
    └── haiku-semantic.json  # semantic scoring cache
```

All paths relative to project root. Added to `.gitignore` by default (contains session data).

## Injecting feedback in warn mode

`UserPromptSubmit` hook scans recent drift events. If any since last turn, prepends to the user message (system-style):

```
<planlock-notice>
2 drift events since last turn:
- Out-of-scope edit to src/billing/invoice.ts (no step covers this path)
- Step "Add login tests" skipped (6 calls without touching tests/auth/)
Continue, or correct course?
</planlock-notice>
```

Claude sees this, can self-correct, and the user sees a condensed version in their terminal.

## Strict-mode blocking

PreToolUse hooks can return exit code 2 with a message on stderr to block the tool call. In strict mode, out-of-scope calls return:

```json
{
  "block": true,
  "reason": "planlock: src/billing/invoice.ts is outside the plan scope. Current plan covers: src/auth/**, tests/auth/**. Run /planlock unlock if you need to expand scope."
}
```

Claude receives this, can either argue scope in plan mode (recommended) or the user runs `/planlock unlock` to amend.

## Report format

`.planlock/sessions/<id>/report.md`:

```markdown
# planlock report — session 2026-04-18-a1b2c3

**Plan:** plans/p42.md (9 steps)
**Drift score:** 34/100 (moderate)

## Completed (6/9)
- ✅ s1 Create auth module directory
- ✅ s2 Move login handler to auth/
- ...

## Incomplete (3/9)
- ⚠️ s4 Add auth middleware tests — never started
- ⚠️ s7 Update route registrations — partial (3 of 7 routes)
- ⚠️ s9 Update CHANGELOG — skipped

## Out-of-scope (4 events)
- src/billing/invoice.ts × 2 edits
- package.json × 1 edit (added dep "zod" — not in plan)
- src/utils/debounce.ts × 1 creation

## Extra work (1 step invented)
- "Refactor error handler" — done in full, not in plan

## Recommendations
- Re-enter plan mode to formalize the error-handler refactor if you want to keep it
- The billing/invoice edits look unrelated; consider reverting
```

## Testing strategy

- **Unit:** step parser against a corpus of 30 real Claude plans (anonymized)
- **Property test:** `parse(plan) → scope.files` is always a valid glob
- **Integration:** scripted session with a fake Claude client that produces plan → known drift pattern → assert report matches
- **Dogfood:** run planlock on planlock's own development sessions

## Open questions

- How stable is `ExitPlanMode` tool name across Claude Code versions? (Monitor changelog, version-gate.)
- Do we support nested sub-agent tool calls (via Task tool)? v0.1: no, treat sub-agent work as opaque. v0.3: drill-down.
- Should "extra work" be always logged, or suppressed when it's small (e.g. a .gitignore edit)? Config flag `ignore_minor_extras`.
- `plansDirectory` resolution: honor `settings.local.json` > `settings.json` > default `~/.claude/plans/`. What if user sets a project-relative path? Resolve from session cwd (provided in hook payload).
- Multi-session concurrency: if two Claude Code windows run plan mode at once, newest-file heuristic can race. v0.1: log a warning if two plans appear within 5s; v0.3: plan files gain a session-id frontmatter (requires upstream support or wrapping).
