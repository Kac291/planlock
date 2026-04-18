export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readJsonStdin<T>(): Promise<T | null> {
  const raw = await readStdin();
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch (err) {
    // A hook must never abort Claude Code with exit 1 on garbage input.
    process.stderr.write(
      `planlock: invalid stdin JSON — ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return null;
  }
}

export function writeBlock(reason: string): void {
  // Modern Claude Code PreToolUse hook contract: stdout JSON with
  // hookSpecificOutput.permissionDecision = "deny". Stderr + exit 2 remain
  // as a legacy fallback for older Claude Code builds.
  const response = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
  process.stdout.write(`${JSON.stringify(response)}\n`);
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}
