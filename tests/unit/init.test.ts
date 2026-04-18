import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInit } from "../../src/commands/init.js";

describe("commands/init", () => {
  let cwd: string;
  let origWrite: typeof process.stdout.write;

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "planlock-init-"));
    origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (() => true) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = origWrite;
    rmSync(cwd, { recursive: true, force: true });
  });

  it("writes hook config + .gitignore entry + default config", () => {
    runInit(cwd);
    const settings = JSON.parse(
      readFileSync(path.join(cwd, ".claude", "settings.local.json"), "utf8"),
    ) as {
      hooks: {
        PreToolUse: { matcher?: string; hooks: { command: string }[] }[];
        Stop: { hooks: { command: string }[] }[];
      };
    };
    const commands = settings.hooks.PreToolUse.flatMap((b) => b.hooks.map((h) => h.command));
    expect(commands).toContain("planlock capture-plan");
    expect(commands).toContain("planlock match-tool");
    expect(settings.hooks.Stop[0]!.hooks[0]!.command).toBe("planlock report");

    const gi = readFileSync(path.join(cwd, ".gitignore"), "utf8");
    expect(gi).toContain(".planlock/");

    expect(existsSync(path.join(cwd, ".planlock", "config.yaml"))).toBe(true);
  });

  it("is idempotent — running twice does not duplicate hook entries", () => {
    runInit(cwd);
    runInit(cwd);
    const settings = JSON.parse(
      readFileSync(path.join(cwd, ".claude", "settings.local.json"), "utf8"),
    ) as { hooks: { PreToolUse: unknown[]; Stop: unknown[] } };
    expect(settings.hooks.PreToolUse).toHaveLength(2);
    expect(settings.hooks.Stop).toHaveLength(1);
  });
});
