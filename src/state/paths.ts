import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

function readJsonSafely(p: string): Record<string, unknown> | null {
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractPlansDirectory(json: Record<string, unknown> | null): string | null {
  if (!json) return null;
  const direct = json.plansDirectory;
  if (typeof direct === "string" && direct.length > 0) return direct;
  return null;
}

export function resolvePlansDir(cwd: string): string {
  const candidates = [
    path.join(cwd, ".claude", "settings.local.json"),
    path.join(cwd, ".claude", "settings.json"),
    path.join(homedir(), ".claude", "settings.json"),
  ];
  for (const p of candidates) {
    const value = extractPlansDirectory(readJsonSafely(p));
    if (value) return resolvePlanPath(value, cwd);
  }
  return path.join(homedir(), ".claude", "plans");
}

function resolvePlanPath(value: string, cwd: string): string {
  if (value.startsWith("~")) return path.resolve(path.join(homedir(), value.slice(1)));
  if (path.isAbsolute(value)) return path.resolve(value);
  return path.resolve(cwd, value);
}

export function resolveStateRoot(cwd: string): string {
  return path.join(cwd, ".planlock");
}

export function sessionDir(stateRoot: string, sessionId: string): string {
  return path.join(stateRoot, "sessions", sessionId);
}

export function plansStoreDir(stateRoot: string): string {
  return path.join(stateRoot, "plans");
}
