import type { DriftVerdict, PlanlockConfig } from "../types.js";

const OBSERVE_SURFACE: ReadonlySet<DriftVerdict> = new Set(["out-of-scope", "skip-ahead", "extra"]);

const WARN_SURFACE: ReadonlySet<DriftVerdict> = new Set([
  "out-of-scope",
  "skip-ahead",
  "extra",
  "partial",
]);

const STRICT_BLOCK: ReadonlySet<DriftVerdict> = new Set(["out-of-scope"]);

export interface PolicyDecision {
  stderr: string | null;
  block: boolean;
}

export function decidePolicy(
  mode: PlanlockConfig["mode"],
  verdict: DriftVerdict,
  reason: string,
): PolicyDecision {
  if (mode === "strict" && STRICT_BLOCK.has(verdict)) {
    return { stderr: `planlock strict: blocked — ${reason}`, block: true };
  }
  const surfaceSet = mode === "observe" ? OBSERVE_SURFACE : WARN_SURFACE;
  if (!surfaceSet.has(verdict)) return { stderr: null, block: false };
  if (mode === "observe") {
    return { stderr: `planlock: ${verdict} — ${reason}`, block: false };
  }
  return { stderr: `⚠️ planlock warn (${verdict}): ${reason}`, block: false };
}
