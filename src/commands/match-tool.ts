import { PreToolUsePayload } from "../hooks/payload.js";
import { readJsonStdin } from "../hooks/stdio.js";
import { appendEvent } from "../state/events.js";
import { resolveStateRoot } from "../state/paths.js";
import type { ToolCallEvent } from "../types.js";

export async function runMatchTool(): Promise<void> {
  const raw = await readJsonStdin<unknown>();
  if (!raw) return;
  const parsed = PreToolUsePayload.safeParse(raw);
  if (!parsed.success) {
    process.stderr.write(`planlock match-tool: invalid payload — ${parsed.error.message}\n`);
    return;
  }
  const { session_id: sessionId, cwd, tool_name: toolName, tool_input } = parsed.data;
  if (toolName === "ExitPlanMode") return;
  const event: ToolCallEvent = {
    type: "tool-call",
    timestamp: new Date().toISOString(),
    sessionId,
    cwd,
    toolName,
    toolInput: tool_input ?? null,
  };
  appendEvent(resolveStateRoot(cwd), sessionId, event);
}
