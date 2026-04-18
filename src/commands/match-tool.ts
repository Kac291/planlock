import { PreToolUsePayload } from "../hooks/payload.js";
import { readJsonStdin, writeBlock } from "../hooks/stdio.js";
import { replaySessionSteps, scoreCall } from "../match/engine.js";
import { extractToolCall } from "../match/extract.js";
import { decidePolicy } from "../match/policy.js";
import { loadConfig } from "../state/config.js";
import { appendEvent, readEvents } from "../state/events.js";
import { resolveStateRoot } from "../state/paths.js";
import { findLatestParsedPlan } from "../state/plan-store.js";
import type { DriftEvent, ToolCallEvent } from "../types.js";

export async function runMatchTool(): Promise<void> {
  const raw = await readJsonStdin<unknown>();
  if (!raw) return;
  const parsed = PreToolUsePayload.safeParse(raw);
  if (!parsed.success) {
    process.stderr.write(`planlock match-tool: invalid payload — ${parsed.error.message}\n`);
    return;
  }
  const { session_id: sessionId, cwd, tool_name: toolName, tool_input } = parsed.data;
  if (toolName === "ExitPlanMode") return;
  const stateRoot = resolveStateRoot(cwd);
  const callEvent: ToolCallEvent = {
    type: "tool-call",
    timestamp: new Date().toISOString(),
    sessionId,
    cwd,
    toolName,
    toolInput: tool_input ?? null,
  };
  appendEvent(stateRoot, sessionId, callEvent);

  const latest = findLatestParsedPlan(stateRoot);
  if (!latest) return;
  const config = loadConfig(stateRoot);
  const events = readEvents(stateRoot, sessionId);
  const { openStepIds } = replaySessionSteps(events, latest.steps);
  const call = extractToolCall(toolName, tool_input ?? null);
  const result = scoreCall(call, latest.steps, openStepIds, config.thresholds, cwd);
  const driftEvent: DriftEvent = {
    type: "drift",
    timestamp: new Date().toISOString(),
    sessionId,
    cwd,
    verdict: result.verdict,
    toolName,
    paths: call.paths,
    stepId: result.stepId,
    score: result.score,
    reason: result.reason,
  };
  appendEvent(stateRoot, sessionId, driftEvent);
  const decision = decidePolicy(config.mode, result.verdict, result.reason);
  if (decision.block) {
    writeBlock(decision.stderr ?? `planlock strict: blocked — ${result.reason}`);
    return;
  }
  if (decision.stderr) process.stderr.write(`${decision.stderr}\n`);
}
