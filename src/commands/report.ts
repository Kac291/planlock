import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { StopPayload } from "../hooks/payload.js";
import { readJsonStdin } from "../hooks/stdio.js";
import { readEvents } from "../state/events.js";
import { resolveStateRoot, sessionDir } from "../state/paths.js";
import { findLatestParsedPlan, readParsedPlan } from "../state/plan-store.js";
import type { AnyEvent, DriftEvent, PlanParsedEvent, Step } from "../types.js";

interface StepTally {
  step: Step;
  matches: number;
  skipAheads: number;
  partials: number;
}

function buildToolBreakdown(events: AnyEvent[]): string[] {
  const byTool = new Map<string, number>();
  for (const e of events) {
    if (e.type !== "tool-call") continue;
    byTool.set(e.toolName, (byTool.get(e.toolName) ?? 0) + 1);
  }
  if (byTool.size === 0) return ["(none)"];
  return [...byTool.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `- ${name}: ${count}`);
}

function computeDriftScore(
  totalSteps: number,
  skippedSteps: number,
  outCount: number,
  extraCount: number,
): number {
  if (totalSteps === 0) return 0;
  const skippedPct = skippedSteps / totalSteps;
  const raw = 40 * skippedPct + Math.min(40, outCount * 8) + Math.min(20, extraCount * 4);
  return Math.min(100, Math.round(raw));
}

function tallyStepStatus(events: AnyEvent[], steps: Step[]): StepTally[] {
  const tallies = new Map<string, StepTally>();
  for (const step of steps) {
    tallies.set(step.id, { step, matches: 0, skipAheads: 0, partials: 0 });
  }
  for (const e of events) {
    if (e.type !== "drift" || !e.stepId) continue;
    const t = tallies.get(e.stepId);
    if (!t) continue;
    if (e.verdict === "match") t.matches += 1;
    else if (e.verdict === "skip-ahead") t.skipAheads += 1;
    else if (e.verdict === "partial") t.partials += 1;
  }
  return steps.map((s) => tallies.get(s.id) as StepTally);
}

function groupOutOfScope(events: AnyEvent[]): string[] {
  const byPath = new Map<string, { tool: string; count: number }>();
  for (const e of events) {
    if (e.type !== "drift" || e.verdict !== "out-of-scope") continue;
    const key = e.paths[0] ?? `(${e.toolName})`;
    const prev = byPath.get(key);
    if (prev) prev.count += 1;
    else byPath.set(key, { tool: e.toolName, count: 1 });
  }
  return [...byPath.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([p, { tool, count }]) => `- ${p} × ${count} (${tool})`);
}

function groupExtra(events: AnyEvent[]): string[] {
  const byTool = new Map<string, number>();
  for (const e of events) {
    if (e.type !== "drift" || e.verdict !== "extra") continue;
    byTool.set(e.toolName, (byTool.get(e.toolName) ?? 0) + 1);
  }
  return [...byTool.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tool, count]) => `- ${tool} × ${count} (no step claimed)`);
}

function latestParsedEvent(events: AnyEvent[]): PlanParsedEvent | null {
  let found: PlanParsedEvent | null = null;
  for (const e of events) {
    if (e.type === "plan-parsed") found = e;
  }
  return found;
}

export async function runReport(): Promise<void> {
  const raw = await readJsonStdin<unknown>();
  if (!raw) return;
  const parsed = StopPayload.safeParse(raw);
  if (!parsed.success) return;
  const { session_id: sessionId, cwd } = parsed.data;
  const stateRoot = resolveStateRoot(cwd);
  const events = readEvents(stateRoot, sessionId);
  const planCaptured = events.filter((e) => e.type === "plan-captured").length;
  const toolCalls = events.filter((e) => e.type === "tool-call") as Array<
    Extract<AnyEvent, { type: "tool-call" }>
  >;
  const header: string[] = [
    `# planlock report — session ${sessionId}`,
    "",
    `Plans captured: ${planCaptured}`,
    `Tool calls logged: ${toolCalls.length}`,
    "",
    "## Tool call breakdown",
    ...buildToolBreakdown(events),
    "",
  ];

  const parsedEvent = latestParsedEvent(events);
  let steps: Step[] | null = parsedEvent ? readParsedPlan(parsedEvent.parsedPath) : null;
  if (!steps) {
    // Session has no plan-parsed event (e.g. the plan was captured by an
    // earlier session), but a parsed.yaml may still exist on disk.
    const latest = findLatestParsedPlan(stateRoot);
    if (latest) steps = latest.steps;
  }

  const body: string[] = [];
  if (!steps) {
    body.push(
      "_parsed plan not available for this session; upgrade to v0.2 to see drift analysis._",
    );
  } else {
    const tallies = tallyStepStatus(events, steps);
    const skipped = tallies.filter((t) => t.matches + t.skipAheads === 0);
    const driftEvents = events.filter((e): e is DriftEvent => e.type === "drift");
    const outOfScopeCount = driftEvents.filter((e) => e.verdict === "out-of-scope").length;
    const extraCount = driftEvents.filter((e) => e.verdict === "extra").length;
    const score = computeDriftScore(steps.length, skipped.length, outOfScopeCount, extraCount);

    body.push(`## Steps status (${steps.length} total)`);
    for (const t of tallies) {
      const hits = t.matches + t.skipAheads;
      if (hits > 0) {
        const note = t.skipAheads > 0 ? ` (incl. ${t.skipAheads} skip-ahead)` : "";
        body.push(`- ✅ ${t.step.id} ${t.step.summary} — ${hits} match(es)${note}`);
      } else if (t.partials > 0) {
        body.push(`- ⚠️ ${t.step.id} ${t.step.summary} — partial only (${t.partials})`);
      } else {
        body.push(`- ⚠️ ${t.step.id} ${t.step.summary} — SKIPPED`);
      }
    }
    body.push("");
    body.push(`## Out-of-scope events (${outOfScopeCount})`);
    const outLines = groupOutOfScope(events);
    body.push(...(outLines.length > 0 ? outLines : ["(none)"]));
    body.push("");
    body.push(`## Extra events (${extraCount})`);
    const extraLines = groupExtra(events);
    body.push(...(extraLines.length > 0 ? extraLines : ["(none)"]));
    body.push("");
    body.push(`## Drift score: ${score}/100`);
  }

  const lines = [...header, ...body, ""].join("\n");
  const dir = sessionDir(stateRoot, sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "report.md"), lines, "utf8");
}
