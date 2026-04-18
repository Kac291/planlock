import type { Step } from "../types.js";
import { parsePlanHeuristic } from "./heuristic.js";

export type ParseStrategy = "heuristic";

export function parsePlan(markdown: string, strategy: ParseStrategy = "heuristic"): Step[] {
  if (strategy === "heuristic") return parsePlanHeuristic(markdown);
  return parsePlanHeuristic(markdown);
}

export { parsePlanHeuristic };
