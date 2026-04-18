import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { writeDefaultConfig } from "../state/config.js";
import { resolveStateRoot } from "../state/paths.js";

interface HookEntry {
  type: "command";
  command: string;
}

interface HookBlock {
  matcher?: string;
  hooks: HookEntry[];
}

interface SettingsShape {
  hooks?: {
    PreToolUse?: HookBlock[];
    Stop?: HookBlock[];
    [key: string]: HookBlock[] | undefined;
  };
  [key: string]: unknown;
}

const PLANLOCK_HOOKS: SettingsShape["hooks"] = {
  PreToolUse: [
    {
      matcher: "ExitPlanMode",
      hooks: [{ type: "command", command: "planlock capture-plan" }],
    },
    {
      matcher: "*",
      hooks: [{ type: "command", command: "planlock match-tool" }],
    },
  ],
  Stop: [{ hooks: [{ type: "command", command: "planlock report" }] }],
};

function mergeHookBlocks(existing: HookBlock[] = [], incoming: HookBlock[]): HookBlock[] {
  const seen = new Set(
    existing.map((b) => `${b.matcher ?? ""}|${b.hooks.map((h) => h.command).join(",")}`),
  );
  const merged = [...existing];
  for (const block of incoming) {
    const key = `${block.matcher ?? ""}|${block.hooks.map((h) => h.command).join(",")}`;
    if (!seen.has(key)) merged.push(block);
  }
  return merged;
}

function writeSettings(cwd: string): void {
  const dir = path.join(cwd, ".claude");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "settings.local.json");
  const current: SettingsShape = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as SettingsShape)
    : {};
  current.hooks = current.hooks ?? {};
  current.hooks.PreToolUse = mergeHookBlocks(current.hooks.PreToolUse, PLANLOCK_HOOKS!.PreToolUse!);
  current.hooks.Stop = mergeHookBlocks(current.hooks.Stop, PLANLOCK_HOOKS!.Stop!);
  writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`, "utf8");
}

function ensureGitignoreEntry(cwd: string): void {
  const file = path.join(cwd, ".gitignore");
  const entry = ".planlock/";
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (current.split("\n").some((l) => l.trim() === entry || l.trim() === ".planlock")) return;
  const next = current.endsWith("\n") || current.length === 0 ? current : `${current}\n`;
  writeFileSync(file, `${next}${entry}\n`, "utf8");
}

export function runInit(cwd: string = process.cwd()): void {
  const stateRoot = resolveStateRoot(cwd);
  mkdirSync(stateRoot, { recursive: true });
  writeDefaultConfig(stateRoot);
  writeSettings(cwd);
  ensureGitignoreEntry(cwd);
  process.stdout.write(
    [
      "planlock initialized.",
      `  state root: ${stateRoot}`,
      `  hooks written: ${path.join(cwd, ".claude", "settings.local.json")}`,
      "  mode: observe (edit .planlock/config.yaml to change)",
      "",
    ].join("\n"),
  );
}
