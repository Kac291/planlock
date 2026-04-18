import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { readEvents } from "../state/events.js";
import { resolveStateRoot } from "../state/paths.js";

export function runStatus(cwd: string = process.cwd()): void {
  const stateRoot = resolveStateRoot(cwd);
  const sessionsDir = path.join(stateRoot, "sessions");
  if (!existsSync(sessionsDir)) {
    process.stdout.write("planlock: no sessions recorded yet.\n");
    return;
  }
  const sessions = readdirSync(sessionsDir)
    .map((id) => ({ id, mtime: statSync(path.join(sessionsDir, id)).mtime }))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  const latest = sessions[0];
  if (!latest) {
    process.stdout.write("planlock: no sessions recorded yet.\n");
    return;
  }
  const events = readEvents(stateRoot, latest.id);
  const captured = events.filter((e) => e.type === "plan-captured").length;
  const calls = events.filter((e) => e.type === "tool-call").length;
  process.stdout.write(
    [
      `planlock status — latest session ${latest.id}`,
      `  plans captured: ${captured}`,
      `  tool calls: ${calls}`,
      `  events file: ${path.join(sessionsDir, latest.id, "events.jsonl")}`,
      "",
    ].join("\n"),
  );
}
