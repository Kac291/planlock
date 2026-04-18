import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { StopPayload } from "../hooks/payload.js";
import { readJsonStdin } from "../hooks/stdio.js";
import { readEvents } from "../state/events.js";
import { resolveStateRoot, sessionDir } from "../state/paths.js";

export async function runReport(): Promise<void> {
  const raw = await readJsonStdin<unknown>();
  if (!raw) return;
  const parsed = StopPayload.safeParse(raw);
  if (!parsed.success) return;
  const { session_id: sessionId, cwd } = parsed.data;
  const stateRoot = resolveStateRoot(cwd);
  const events = readEvents(stateRoot, sessionId);
  const planCaptured = events.filter((e) => e.type === "plan-captured").length;
  const toolCalls = events.filter((e) => e.type === "tool-call");
  const byTool = new Map<string, number>();
  for (const e of toolCalls) {
    if (e.type !== "tool-call") continue;
    byTool.set(e.toolName, (byTool.get(e.toolName) ?? 0) + 1);
  }
  const lines = [
    `# planlock v0.1 report — session ${sessionId}`,
    "",
    `Plans captured: ${planCaptured}`,
    `Tool calls logged: ${toolCalls.length}`,
    "",
    "## Tool call breakdown",
    ...(byTool.size === 0
      ? ["(none)"]
      : [...byTool.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([name, count]) => `- ${name}: ${count}`)),
    "",
    "_v0.1 is passive-capture only. Drift detection lands in v0.2._",
    "",
  ].join("\n");
  const dir = sessionDir(stateRoot, sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "report.md"), lines, "utf8");
}
