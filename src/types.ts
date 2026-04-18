export interface PlanCapturedEvent {
  type: "plan-captured";
  timestamp: string;
  sessionId: string;
  cwd: string;
  planId: string;
  sourcePath: string;
  storedPath: string;
  sourceMtime: string;
}

export interface ToolCallEvent {
  type: "tool-call";
  timestamp: string;
  sessionId: string;
  cwd: string;
  toolName: string;
  toolInput: unknown;
}

export interface StepScope {
  files: string[];
  commands: string[];
  operations: string[];
}

export interface Step {
  id: string;
  summary: string;
  scope: StepScope;
  dependencies: string[];
}

export interface PlanParsedEvent {
  type: "plan-parsed";
  timestamp: string;
  sessionId: string;
  cwd: string;
  planId: string;
  parsedPath: string;
  stepCount: number;
  strategy: "heuristic";
}

export type DriftVerdict =
  | "match"
  | "partial"
  | "skip-ahead"
  | "out-of-scope"
  | "extra"
  | "neutral";

export interface DriftEvent {
  type: "drift";
  timestamp: string;
  sessionId: string;
  cwd: string;
  verdict: DriftVerdict;
  toolName: string;
  paths: string[];
  stepId: string | null;
  score: number;
  reason: string;
}

export interface PlanlockConfig {
  mode: "observe" | "warn" | "strict";
  thresholds: {
    match: number;
    partial: number;
  };
  ignoreMinorExtras: boolean;
}

export type AnyEvent = PlanCapturedEvent | ToolCallEvent | PlanParsedEvent | DriftEvent;

export const DEFAULT_CONFIG: PlanlockConfig = {
  mode: "observe",
  thresholds: { match: 0.7, partial: 0.4 },
  ignoreMinorExtras: true,
};
