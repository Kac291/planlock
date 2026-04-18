import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AnyEvent } from "../../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CLI_SRC = path.join(REPO_ROOT, "src", "cli.ts");
const TSX_BIN = path.join(
  REPO_ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsx.cmd" : "tsx",
);

function runCli(
  args: string[],
  _opts: { cwd: string; stdin?: string },
): {
  stdout: string;
  stderr: string;
  status: number;
} {
  const quoted = [TSX_BIN, CLI_SRC, ...args].map((a) => `"${a}"`).join(" ");
  try {
    const stdout = execSync(quoted, {
      cwd: REPO_ROOT,
      input: _opts.stdin ?? "",
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout, stderr: "", status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", status: e.status ?? 1 };
  }
}

describe("capture-plan integration", () => {
  let cwd: string;
  let plansDir: string;

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "planlock-cap-"));
    plansDir = path.join(cwd, "custom-plans");
    mkdirSync(plansDir, { recursive: true });
    mkdirSync(path.join(cwd, ".claude"), { recursive: true });
    writeFileSync(
      path.join(cwd, ".claude", "settings.local.json"),
      JSON.stringify({ plansDirectory: plansDir }),
    );
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("copies newest plan and writes plan-captured event", () => {
    const planFile = path.join(plansDir, "happy-otter.md");
    writeFileSync(planFile, "# test plan\n\n- step 1\n");
    const payload = JSON.stringify({
      session_id: "sess-abc",
      cwd,
      hook_event_name: "PreToolUse",
      tool_name: "ExitPlanMode",
      tool_input: {},
    });
    const result = runCli(["capture-plan"], { cwd, stdin: payload });
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    const storeDir = path.join(cwd, ".planlock", "plans");
    expect(existsSync(storeDir)).toBe(true);
    const stored = readdirSync(storeDir);
    const mdFiles = stored.filter((f) => f.endsWith(".md"));
    const parsedFiles = stored.filter((f) => f.endsWith(".parsed.yaml"));
    expect(mdFiles).toHaveLength(1);
    expect(parsedFiles).toHaveLength(1);
    const [firstStored] = mdFiles;
    expect(firstStored).toBeDefined();
    expect(readFileSync(path.join(storeDir, firstStored as string), "utf8")).toContain(
      "# test plan",
    );

    const eventsPath = path.join(cwd, ".planlock", "sessions", "sess-abc", "events.jsonl");
    expect(existsSync(eventsPath)).toBe(true);
    const events = readFileSync(eventsPath, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as AnyEvent);
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("plan-captured");
    expect(events[1]?.type).toBe("plan-parsed");
  });
});
