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

export interface PlanlockConfig {
  mode: "observe" | "warn" | "strict";
  thresholds: {
    match: number;
    partial: number;
  };
  ignoreMinorExtras: boolean;
}

export type AnyEvent = PlanCapturedEvent | ToolCallEvent;

export const DEFAULT_CONFIG: PlanlockConfig = {
  mode: "observe",
  thresholds: { match: 0.7, partial: 0.4 },
  ignoreMinorExtras: true,
};
