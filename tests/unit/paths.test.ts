import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolvePlansDir, resolveStateRoot } from "../../src/state/paths.js";

describe("state/paths", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "planlock-paths-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("resolveStateRoot returns cwd/.planlock", () => {
    expect(resolveStateRoot(cwd)).toBe(path.join(cwd, ".planlock"));
  });

  it("resolvePlansDir falls back to ~/.claude/plans when no settings", () => {
    const result = resolvePlansDir(cwd);
    expect(result.endsWith(path.join(".claude", "plans"))).toBe(true);
  });

  it("resolvePlansDir honors settings.local.json over settings.json", () => {
    mkdirSync(path.join(cwd, ".claude"), { recursive: true });
    writeFileSync(
      path.join(cwd, ".claude", "settings.json"),
      JSON.stringify({ plansDirectory: "/shared/plans" }),
    );
    writeFileSync(
      path.join(cwd, ".claude", "settings.local.json"),
      JSON.stringify({ plansDirectory: "/local/plans" }),
    );
    expect(resolvePlansDir(cwd)).toBe(path.resolve("/local/plans"));
  });

  it("resolvePlansDir resolves relative paths against cwd", () => {
    mkdirSync(path.join(cwd, ".claude"), { recursive: true });
    writeFileSync(
      path.join(cwd, ".claude", "settings.local.json"),
      JSON.stringify({ plansDirectory: "./my-plans" }),
    );
    expect(resolvePlansDir(cwd)).toBe(path.resolve(cwd, "my-plans"));
  });
});
