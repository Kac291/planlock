import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, replaySessionSteps, scoreCall } from "../../src/match/engine.js";
import type { AnyEvent, DriftEvent, Step } from "../../src/types.js";

function step(id: string, files: string[], operations: string[], summary = id): Step {
  return {
    id,
    summary,
    scope: { files, commands: [], operations },
    dependencies: [],
  };
}

const authStep = step("s1", ["src/auth/**"], ["Edit", "Write"], "Create auth module");
const testStep = step("s2", ["tests/auth/**"], ["Write"], "Add auth tests");
const runStep = step("s3", [], ["Bash"], "Run tests");

describe("scoreCall", () => {
  const cwd = "/proj";

  it("returns neutral for read-only tools", () => {
    const r = scoreCall(
      { toolName: "Read", op: "Read", paths: ["README.md"], isReadOnly: true },
      [authStep],
      ["s1"],
      DEFAULT_THRESHOLDS,
      cwd,
    );
    expect(r.verdict).toBe("neutral");
  });

  it("matches Edit against matching step glob", () => {
    const r = scoreCall(
      { toolName: "Edit", op: "Edit", paths: ["src/auth/middleware.ts"], isReadOnly: false },
      [authStep, testStep],
      ["s1", "s2"],
      DEFAULT_THRESHOLDS,
      cwd,
    );
    expect(r.verdict).toBe("match");
    expect(r.stepId).toBe("s1");
  });

  it("flags skip-ahead when later step matches but earlier still open", () => {
    const r = scoreCall(
      { toolName: "Write", op: "Write", paths: ["tests/auth/login.test.ts"], isReadOnly: false },
      [authStep, testStep],
      ["s1", "s2"],
      DEFAULT_THRESHOLDS,
      cwd,
    );
    expect(r.verdict).toBe("skip-ahead");
    expect(r.stepId).toBe("s2");
  });

  it("flags out-of-scope for path not covered by any step", () => {
    const r = scoreCall(
      { toolName: "Edit", op: "Edit", paths: ["src/billing/invoice.ts"], isReadOnly: false },
      [authStep, testStep],
      ["s1", "s2"],
      DEFAULT_THRESHOLDS,
      cwd,
    );
    expect(r.verdict).toBe("out-of-scope");
    expect(r.reason).toContain("src/billing/invoice.ts");
  });

  it("flags extra for path-less call (e.g. Bash) not matching any step", () => {
    const r = scoreCall(
      { toolName: "Bash", op: "Bash", paths: [], isReadOnly: false },
      [authStep, testStep],
      ["s1", "s2"],
      DEFAULT_THRESHOLDS,
      cwd,
    );
    expect(r.verdict).toBe("extra");
  });

  it("matches Bash against step that has Bash op", () => {
    const r = scoreCall(
      { toolName: "Bash", op: "Bash", paths: [], isReadOnly: false },
      [runStep],
      ["s3"],
      DEFAULT_THRESHOLDS,
      cwd,
    );
    expect(r.verdict).toBe("match");
    expect(r.stepId).toBe("s3");
  });

  it("unparsed plan → out-of-scope for writes with paths", () => {
    const unparsed: Step = step("s1", [], [], "(unparsed)");
    const r = scoreCall(
      { toolName: "Edit", op: "Edit", paths: ["anything.ts"], isReadOnly: false },
      [unparsed],
      ["s1"],
      DEFAULT_THRESHOLDS,
      cwd,
    );
    expect(r.verdict).toBe("out-of-scope");
  });

  it("partial when path matches a completed step's glob", () => {
    const r = scoreCall(
      { toolName: "Edit", op: "Edit", paths: ["src/auth/helper.ts"], isReadOnly: false },
      [authStep, testStep],
      ["s2"],
      DEFAULT_THRESHOLDS,
      cwd,
    );
    expect(r.verdict).toBe("partial");
  });

  it("normalizes absolute paths against cwd", () => {
    const r = scoreCall(
      {
        toolName: "Edit",
        op: "Edit",
        paths: ["/proj/src/auth/middleware.ts"],
        isReadOnly: false,
      },
      [authStep],
      ["s1"],
      DEFAULT_THRESHOLDS,
      cwd,
    );
    expect(r.verdict).toBe("match");
  });
});

describe("replaySessionSteps", () => {
  const mk = (verdict: DriftEvent["verdict"], stepId: string | null): DriftEvent => ({
    type: "drift",
    timestamp: "t",
    sessionId: "s",
    cwd: "/",
    verdict,
    toolName: "Edit",
    paths: [],
    stepId,
    score: 0.8,
    reason: "",
  });

  it("marks step done on match or skip-ahead, not on partial/out-of-scope", () => {
    const events: AnyEvent[] = [
      mk("match", "s1"),
      mk("partial", "s2"),
      mk("skip-ahead", "s3"),
      mk("out-of-scope", null),
    ];
    const steps = [
      step("s1", ["a"], []),
      step("s2", ["b"], []),
      step("s3", ["c"], []),
      step("s4", ["d"], []),
    ];
    const r = replaySessionSteps(events, steps);
    expect([...r.doneStepIds].sort()).toEqual(["s1", "s3"]);
    expect(r.openStepIds).toEqual(["s2", "s4"]);
  });
});
