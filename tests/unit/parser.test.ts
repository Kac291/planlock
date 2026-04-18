import { describe, expect, it } from "vitest";
import { parsePlanHeuristic } from "../../src/parser/heuristic.js";

describe("parsePlanHeuristic", () => {
  it("returns unparsed fallback for empty input", () => {
    const steps = parsePlanHeuristic("");
    expect(steps).toHaveLength(1);
    expect(steps[0].id).toBe("s1");
    expect(steps[0].summary).toBe("(unparsed)");
  });

  it("splits numbered list as separate steps", () => {
    const md = "1. First thing\n2. Second thing\n3. Third thing\n";
    const steps = parsePlanHeuristic(md);
    expect(steps).toHaveLength(3);
    expect(steps.map((s) => s.summary)).toEqual(["First thing", "Second thing", "Third thing"]);
    expect(steps.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
  });

  it("splits manual 'Step N' style lines", () => {
    const md = "Step 1 — edit src/foo.ts\nStep 2 — run tests\nStep 3 — commit";
    const steps = parsePlanHeuristic(md);
    expect(steps).toHaveLength(3);
    expect(steps[0].summary).toContain("edit src/foo.ts");
  });

  it("extracts backtick-wrapped paths into scope.files", () => {
    const md = "- Refactor `src/auth/middleware.ts` and add tests\n";
    const steps = parsePlanHeuristic(md);
    expect(steps[0].scope.files).toContain("src/auth/middleware.ts");
  });

  it("extracts raw path tokens with slashes", () => {
    const md = "1. Move login handler to src/auth/\n2. Add test in tests/auth/login.test.ts\n";
    const steps = parsePlanHeuristic(md);
    expect(steps[0].scope.files).toContain("src/auth/**");
    expect(steps[1].scope.files).toContain("tests/auth/login.test.ts");
  });

  it("ignores URL-like tokens", () => {
    const md = "1. See https://example.com/docs for reference\n";
    const steps = parsePlanHeuristic(md);
    expect(steps[0].scope.files).not.toContain("https://example.com/docs");
  });

  it("infers Edit/Write op from 'edit' verb", () => {
    const md = "- Edit src/foo.ts to add logging\n";
    const steps = parsePlanHeuristic(md);
    expect(steps[0].scope.operations).toEqual(expect.arrayContaining(["Edit", "Write"]));
  });

  it("infers Bash op from 'run' verb and backtick commands", () => {
    const md = "- Run `pnpm test` to verify\n";
    const steps = parsePlanHeuristic(md);
    expect(steps[0].scope.operations).toContain("Bash");
    expect(steps[0].scope.commands).toContain("pnpm test");
  });

  it("captures fenced bash blocks in scope.commands", () => {
    const md = "## Build step\n\n```bash\npnpm install\npnpm build\n```\n";
    const steps = parsePlanHeuristic(md);
    expect(steps[0].scope.commands.join("\n")).toContain("pnpm install");
    expect(steps[0].scope.operations).toContain("Bash");
  });

  it("splits on headings and list items together", () => {
    const md =
      "## Auth module\n\n- Create src/auth/\n- Add middleware\n\n## Tests\n\n- Write tests/auth/login.test.ts\n";
    const steps = parsePlanHeuristic(md);
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(steps.some((s) => s.scope.files.includes("src/auth/**"))).toBe(true);
    expect(steps.some((s) => s.scope.files.includes("tests/auth/login.test.ts"))).toBe(true);
  });

  it("truncates very long summaries to 120 chars", () => {
    const long = "a".repeat(300);
    const steps = parsePlanHeuristic(`- ${long}`);
    expect(steps[0].summary.length).toBeLessThanOrEqual(120);
  });

  it("assigns sequential ids", () => {
    const md = "- one\n- two\n- three\n- four\n";
    const steps = parsePlanHeuristic(md);
    expect(steps.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("skips H1 title with only a non-path backticked flag", () => {
    const md =
      "# Plan — add `--version` flag to planlock CLI\n\n## Wire the flag\n- Edit `src/cli.ts`\n\n## Verify\n- Run `pnpm test`\n";
    const steps = parsePlanHeuristic(md);
    expect(steps).toHaveLength(2);
    expect(steps[0].summary).toContain("Wire the flag");
    expect(steps[1].summary).toContain("Verify");
  });

  it("keeps a heading that names a runnable command", () => {
    const md = "## Run `pnpm install`\n";
    const steps = parsePlanHeuristic(md);
    expect(steps).toHaveLength(1);
    expect(steps[0].scope.commands).toContain("pnpm install");
  });

  it("keeps a heading that names a file path", () => {
    const md = "## Edit `src/cli.ts`\n";
    const steps = parsePlanHeuristic(md);
    expect(steps).toHaveLength(1);
    expect(steps[0].scope.files).toContain("src/cli.ts");
  });
});
