import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { Step } from "../types.js";
import { plansStoreDir } from "./paths.js";

export function parsedPlanPath(stateRoot: string, planId: string): string {
  return path.join(plansStoreDir(stateRoot), `${planId}.parsed.yaml`);
}

export function writeParsedPlan(stateRoot: string, planId: string, steps: Step[]): string {
  const dir = plansStoreDir(stateRoot);
  mkdirSync(dir, { recursive: true });
  const file = parsedPlanPath(stateRoot, planId);
  writeFileSync(file, YAML.stringify({ version: 1, steps }), "utf8");
  return file;
}

export function readParsedPlan(file: string): Step[] | null {
  if (!existsSync(file)) return null;
  try {
    const doc = YAML.parse(readFileSync(file, "utf8"));
    const steps = doc?.steps;
    if (!Array.isArray(steps)) return null;
    return steps as Step[];
  } catch {
    return null;
  }
}

export function findLatestParsedPlan(stateRoot: string): { file: string; steps: Step[] } | null {
  const dir = plansStoreDir(stateRoot);
  if (!existsSync(dir)) return null;
  const entries = readdirSync(dir)
    .filter((name) => name.endsWith(".parsed.yaml"))
    .map((name) => {
      const full = path.join(dir, name);
      return { file: full, mtime: statSync(full).mtime };
    })
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  for (const entry of entries) {
    const steps = readParsedPlan(entry.file);
    if (steps) return { file: entry.file, steps };
  }
  return null;
}
