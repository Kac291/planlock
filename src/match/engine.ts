import path from "node:path";
import micromatch from "micromatch";
import type { AnyEvent, DriftVerdict, Step } from "../types.js";
import type { ExtractedCall } from "./extract.js";

export interface ScoreResult {
  verdict: DriftVerdict;
  stepId: string | null;
  score: number;
  reason: string;
}

export interface Thresholds {
  match: number;
  partial: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { match: 0.7, partial: 0.4 };

function normalizePath(p: string, cwd: string): string {
  let candidate = p;
  if (path.isAbsolute(p)) {
    const rel = path.relative(cwd, p);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) candidate = rel;
  }
  return candidate.replace(/\\/g, "/");
}

function matchesAny(p: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  return micromatch.isMatch(p, patterns);
}

export interface ReplayState {
  openStepIds: string[];
  doneStepIds: Set<string>;
}

export function replaySessionSteps(events: AnyEvent[], steps: Step[]): ReplayState {
  const done = new Set<string>();
  for (const e of events) {
    if (e.type !== "drift") continue;
    if ((e.verdict === "match" || e.verdict === "skip-ahead") && e.stepId) {
      done.add(e.stepId);
    }
  }
  const openStepIds = steps.map((s) => s.id).filter((id) => !done.has(id));
  return { openStepIds, doneStepIds: done };
}

export function scoreCall(
  call: ExtractedCall,
  steps: Step[],
  openStepIds: string[],
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
  cwd: string = process.cwd(),
): ScoreResult {
  if (call.isReadOnly) {
    return { verdict: "neutral", stepId: null, score: 0, reason: "read-only tool" };
  }
  const isUnparsed = steps.length === 1 && steps[0].summary === "(unparsed)";
  if (steps.length === 0 || isUnparsed) {
    if (call.paths.length > 0) {
      return {
        verdict: "out-of-scope",
        stepId: null,
        score: 0,
        reason: `no parsed plan — ${call.paths[0]} unclaimed`,
      };
    }
    return {
      verdict: "extra",
      stepId: null,
      score: 0,
      reason: `no parsed plan — ${call.toolName} unclaimed`,
    };
  }
  const openSteps = openStepIds
    .map((id) => steps.find((s) => s.id === id))
    .filter((s): s is Step => Boolean(s));
  const normalizedPaths = call.paths.map((p) => normalizePath(p, cwd));
  let best: { step: Step | null; total: number; pathScore: number } = {
    step: null,
    total: 0,
    pathScore: 0,
  };
  for (let i = 0; i < openSteps.length; i++) {
    const step = openSteps[i];
    const pathScore =
      step.scope.files.length === 0 && normalizedPaths.length === 0
        ? 0.5
        : step.scope.files.length === 0
          ? 0
          : normalizedPaths.length > 0 &&
              normalizedPaths.some((p) => matchesAny(p, step.scope.files))
            ? 1
            : 0;
    const opScore =
      step.scope.operations.length === 0 ? 0.5 : step.scope.operations.includes(call.op) ? 1 : 0;
    const seqScore = 1 - i / Math.max(1, openSteps.length);
    const total = 0.6 * pathScore + 0.3 * opScore + 0.1 * seqScore;
    if (total > best.total) best = { step, total, pathScore };
  }
  const rounded = Number(best.total.toFixed(3));
  const firstOpen = openSteps[0]?.id ?? null;
  const pathTag = normalizedPaths[0] ? `(${normalizedPaths[0]})` : "";
  if (best.step && best.total >= thresholds.match) {
    const skipAhead = best.step.id !== firstOpen;
    return {
      verdict: skipAhead ? "skip-ahead" : "match",
      stepId: best.step.id,
      score: rounded,
      reason: `${call.toolName}${pathTag} matches ${best.step.id} (score ${best.total.toFixed(2)})${
        skipAhead ? ` — skipped ahead of ${firstOpen}` : ""
      }`,
    };
  }
  if (best.step && best.total >= thresholds.partial && best.pathScore > 0) {
    return {
      verdict: "partial",
      stepId: best.step.id,
      score: rounded,
      reason: `partial match for ${best.step.id} (score ${best.total.toFixed(2)})`,
    };
  }
  if (normalizedPaths.length > 0) {
    const anyCovers = steps.some((s) => normalizedPaths.some((p) => matchesAny(p, s.scope.files)));
    if (anyCovers) {
      return {
        verdict: "partial",
        stepId: best.step?.id ?? null,
        score: rounded,
        reason: `${normalizedPaths[0]} already covered by a completed step`,
      };
    }
    return {
      verdict: "out-of-scope",
      stepId: null,
      score: rounded,
      reason: `no step covers ${normalizedPaths[0]}`,
    };
  }
  return {
    verdict: "extra",
    stepId: null,
    score: rounded,
    reason: `${call.toolName} call not claimed by any step`,
  };
}
