import { describe, expect, it } from "vitest";
import { extractToolCall } from "../../src/match/extract.js";

describe("extractToolCall", () => {
  it("Edit → file_path, write, op=Edit", () => {
    const c = extractToolCall("Edit", {
      file_path: "src/foo.ts",
      old_string: "a",
      new_string: "b",
    });
    expect(c).toEqual({ toolName: "Edit", op: "Edit", paths: ["src/foo.ts"], isReadOnly: false });
  });

  it("Write → file_path, write, op=Write", () => {
    const c = extractToolCall("Write", { file_path: "src/new.ts", content: "x" });
    expect(c.paths).toEqual(["src/new.ts"]);
    expect(c.isReadOnly).toBe(false);
  });

  it("MultiEdit → single file_path extracted", () => {
    const c = extractToolCall("MultiEdit", { file_path: "src/bar.ts", edits: [] });
    expect(c.paths).toEqual(["src/bar.ts"]);
    expect(c.isReadOnly).toBe(false);
  });

  it("Read → read-only", () => {
    const c = extractToolCall("Read", { file_path: "README.md" });
    expect(c.isReadOnly).toBe(true);
    expect(c.paths).toEqual(["README.md"]);
  });

  it("Bash → no paths, op=Bash, write", () => {
    const c = extractToolCall("Bash", { command: "rm -rf build" });
    expect(c.paths).toEqual([]);
    expect(c.op).toBe("Bash");
    expect(c.isReadOnly).toBe(false);
  });

  it("Grep → read-only, no path extraction", () => {
    const c = extractToolCall("Grep", { pattern: "foo" });
    expect(c.isReadOnly).toBe(true);
    expect(c.paths).toEqual([]);
  });

  it("TodoWrite / WebFetch / Task → read-only", () => {
    for (const name of ["TodoWrite", "WebFetch", "WebSearch", "Task"]) {
      expect(extractToolCall(name, {}).isReadOnly).toBe(true);
    }
  });

  it("unknown tool → not read-only, paths empty", () => {
    const c = extractToolCall("SomeUnknownTool", { file_path: "x.ts" });
    expect(c.isReadOnly).toBe(false);
    expect(c.paths).toEqual([]);
  });

  it("Edit with missing file_path → empty paths", () => {
    const c = extractToolCall("Edit", {});
    expect(c.paths).toEqual([]);
  });

  it("null/undefined input → empty paths", () => {
    const c = extractToolCall("Edit", null);
    expect(c.paths).toEqual([]);
  });
});
