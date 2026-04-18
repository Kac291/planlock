import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { DEFAULT_CONFIG, type PlanlockConfig } from "../types.js";

function configPath(stateRoot: string): string {
  return path.join(stateRoot, "config.yaml");
}

export function loadConfig(stateRoot: string): PlanlockConfig {
  const p = configPath(stateRoot);
  if (!existsSync(p)) return { ...DEFAULT_CONFIG };
  const raw = parse(readFileSync(p, "utf8")) as Partial<PlanlockConfig> | null;
  if (!raw) return { ...DEFAULT_CONFIG };
  return {
    mode: raw.mode ?? DEFAULT_CONFIG.mode,
    thresholds: { ...DEFAULT_CONFIG.thresholds, ...(raw.thresholds ?? {}) },
    ignoreMinorExtras: raw.ignoreMinorExtras ?? DEFAULT_CONFIG.ignoreMinorExtras,
  };
}

export function writeDefaultConfig(stateRoot: string): void {
  const p = configPath(stateRoot);
  if (existsSync(p)) return;
  writeFileSync(p, stringify(DEFAULT_CONFIG), "utf8");
}
