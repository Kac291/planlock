export interface ExtractedCall {
  toolName: string;
  op: string;
  paths: string[];
  isReadOnly: boolean;
}

const READ_ONLY_TOOLS = new Set([
  "Read",
  "NotebookRead",
  "Grep",
  "Glob",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
  "Task",
  "ExitPlanMode",
]);

const WRITE_FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

function pickString(input: unknown, key: string): string | null {
  if (!input || typeof input !== "object") return null;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function extractToolCall(toolName: string, toolInput: unknown): ExtractedCall {
  if (READ_ONLY_TOOLS.has(toolName)) {
    const paths: string[] = [];
    if (toolName === "Read" || toolName === "NotebookRead") {
      const p = pickString(toolInput, "file_path");
      if (p) paths.push(p);
    }
    return { toolName, op: toolName, paths, isReadOnly: true };
  }
  if (WRITE_FILE_TOOLS.has(toolName)) {
    const p = pickString(toolInput, "file_path") ?? pickString(toolInput, "notebook_path");
    return { toolName, op: toolName, paths: p ? [p] : [], isReadOnly: false };
  }
  if (toolName === "Bash") {
    return { toolName, op: "Bash", paths: [], isReadOnly: false };
  }
  return { toolName, op: toolName, paths: [], isReadOnly: false };
}
