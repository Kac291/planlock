import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { PreToolUsePayload } from "../hooks/payload.js";
import { readJsonStdin } from "../hooks/stdio.js";
import { appendEvent } from "../state/events.js";
import { plansStoreDir, resolvePlansDir, resolveStateRoot } from "../state/paths.js";
import type { PlanCapturedEvent } from "../types.js";

function newestMarkdown(dir: string): { file: string; mtime: Date } | null {
  if (!existsSync(dir)) return null;
  const entries = readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => {
      const full = path.join(dir, name);
      return { file: full, mtime: statSync(full).mtime };
    })
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return entries[0] ?? null;
}

function timestampId(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}-` +
    `${pad(d.getUTCMilliseconds(), 3)}`
  );
}

export async function runCapturePlan(): Promise<void> {
  const raw = await readJsonStdin<unknown>();
  if (!raw) {
    process.stderr.write("planlock capture-plan: no stdin payload, skipping\n");
    return;
  }
  const parsed = PreToolUsePayload.safeParse(raw);
  if (!parsed.success) {
    process.stderr.write(`planlock capture-plan: invalid payload — ${parsed.error.message}\n`);
    return;
  }
  const { session_id: sessionId, cwd } = parsed.data;
  const plansDir = resolvePlansDir(cwd);
  const newest = newestMarkdown(plansDir);
  if (!newest) {
    process.stderr.write(`planlock capture-plan: no plan files in ${plansDir}\n`);
    return;
  }
  const stateRoot = resolveStateRoot(cwd);
  const storeDir = plansStoreDir(stateRoot);
  mkdirSync(storeDir, { recursive: true });
  const planId = timestampId();
  const storedPath = path.join(storeDir, `${planId}.md`);
  copyFileSync(newest.file, storedPath);
  const event: PlanCapturedEvent = {
    type: "plan-captured",
    timestamp: new Date().toISOString(),
    sessionId,
    cwd,
    planId,
    sourcePath: newest.file,
    storedPath,
    sourceMtime: newest.mtime.toISOString(),
  };
  appendEvent(stateRoot, sessionId, event);
  process.stdout.write(`planlock: captured plan ${planId} from ${newest.file}\n`);
}
