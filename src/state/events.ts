import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AnyEvent } from "../types.js";
import { sessionDir } from "./paths.js";

export function appendEvent(stateRoot: string, sessionId: string, event: AnyEvent): void {
  const dir = sessionDir(stateRoot, sessionId);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "events.jsonl");
  appendFileSync(file, `${JSON.stringify(event)}\n`, "utf8");
}

export function readEvents(stateRoot: string, sessionId: string): AnyEvent[] {
  const file = path.join(sessionDir(stateRoot, sessionId), "events.jsonl");
  if (!existsSync(file)) return [];
  const out: AnyEvent[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as AnyEvent);
    } catch {
      // A torn last line (process killed mid-append) must not poison the whole log.
    }
  }
  return out;
}
