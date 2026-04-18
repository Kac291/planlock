import { describe, expect, it } from "vitest";
import { decidePolicy } from "../../src/match/policy.js";
import type { DriftVerdict } from "../../src/types.js";

const ALL_VERDICTS: DriftVerdict[] = [
  "match",
  "neutral",
  "partial",
  "out-of-scope",
  "skip-ahead",
  "extra",
];

describe("decidePolicy — observe mode", () => {
  it("surfaces out-of-scope / skip-ahead / extra with plain prefix", () => {
    for (const v of ["out-of-scope", "skip-ahead", "extra"] as DriftVerdict[]) {
      const d = decidePolicy("observe", v, "some reason");
      expect(d.stderr).toBe(`planlock: ${v} — some reason`);
      expect(d.block).toBe(false);
    }
  });

  it("stays silent on match / neutral / partial", () => {
    for (const v of ["match", "neutral", "partial"] as DriftVerdict[]) {
      expect(decidePolicy("observe", v, "r")).toEqual({ stderr: null, block: false });
    }
  });

  it("never blocks in observe mode", () => {
    for (const v of ALL_VERDICTS) {
      expect(decidePolicy("observe", v, "r").block).toBe(false);
    }
  });
});

describe("decidePolicy — warn mode", () => {
  it("surfaces partial too, with ⚠️ prefix", () => {
    const d = decidePolicy("warn", "partial", "score 0.5");
    expect(d.stderr).toBe("⚠️ planlock warn (partial): score 0.5");
    expect(d.block).toBe(false);
  });

  it("surfaces out-of-scope with ⚠️ prefix", () => {
    const d = decidePolicy("warn", "out-of-scope", "no step covers x");
    expect(d.stderr).toBe("⚠️ planlock warn (out-of-scope): no step covers x");
    expect(d.block).toBe(false);
  });

  it("stays silent on match / neutral", () => {
    expect(decidePolicy("warn", "match", "r")).toEqual({ stderr: null, block: false });
    expect(decidePolicy("warn", "neutral", "r")).toEqual({ stderr: null, block: false });
  });

  it("never blocks in warn mode", () => {
    for (const v of ALL_VERDICTS) {
      expect(decidePolicy("warn", v, "r").block).toBe(false);
    }
  });
});

describe("decidePolicy — strict mode", () => {
  it("blocks on out-of-scope with strict prefix", () => {
    const d = decidePolicy("strict", "out-of-scope", "no step covers x");
    expect(d.block).toBe(true);
    expect(d.stderr).toBe("planlock strict: blocked — no step covers x");
  });

  it("does NOT block on skip-ahead, falls through to warn-style surfacing", () => {
    const d = decidePolicy("strict", "skip-ahead", "earlier step open");
    expect(d.block).toBe(false);
    expect(d.stderr).toBe("⚠️ planlock warn (skip-ahead): earlier step open");
  });

  it("does NOT block on extra, surfaces warn-style", () => {
    const d = decidePolicy("strict", "extra", "Bash not claimed");
    expect(d.block).toBe(false);
    expect(d.stderr).toBe("⚠️ planlock warn (extra): Bash not claimed");
  });

  it("does NOT block on partial, surfaces warn-style", () => {
    const d = decidePolicy("strict", "partial", "low score");
    expect(d.block).toBe(false);
    expect(d.stderr).toBe("⚠️ planlock warn (partial): low score");
  });

  it("stays silent on match / neutral", () => {
    expect(decidePolicy("strict", "match", "r")).toEqual({ stderr: null, block: false });
    expect(decidePolicy("strict", "neutral", "r")).toEqual({ stderr: null, block: false });
  });
});
