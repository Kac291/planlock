import fc from "fast-check";
import { scoreCall } from "../../src/match/engine.js";
import { extractToolCall } from "../../src/match/extract.js";
import { parsePlanHeuristic } from "../../src/parser/heuristic.js";

let ok = 0;
let bad = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    ok++;
    process.stdout.write(`  ok   ${name}\n`);
  } catch (e) {
    bad++;
    const msg = e instanceof Error ? e.message : String(e);
    failures.push(`${name}: ${msg}`);
    process.stdout.write(`  FAIL ${name} — ${msg}\n`);
  }
}

// 1. Empty and whitespace inputs never throw, always return ≥1 step.
check("empty string", () => {
  const s = parsePlanHeuristic("");
  if (s.length !== 1 || s[0].summary !== "(unparsed)") throw new Error("expected fallback");
});

check("whitespace only", () => {
  const s = parsePlanHeuristic("   \n\n\t\t\n   ");
  if (s.length !== 1) throw new Error(`expected 1 step got ${s.length}`);
});

check("single bullet", () => {
  const s = parsePlanHeuristic("- do thing");
  if (s.length !== 1 || !s[0].summary.includes("do thing")) throw new Error("missing summary");
});

// 2. Huge input — 1000 numbered steps.
check("1000 numbered steps parse", () => {
  const lines: string[] = [];
  for (let i = 1; i <= 1000; i++) {
    lines.push(`${i}. edit src/file${i}.ts to do thing ${i}`);
  }
  const t0 = Date.now();
  const s = parsePlanHeuristic(lines.join("\n"));
  const dt = Date.now() - t0;
  if (s.length !== 1000) throw new Error(`expected 1000 got ${s.length}`);
  if (dt > 2000) throw new Error(`too slow: ${dt}ms`);
  process.stdout.write(`       (${dt}ms for 1000 steps)\n`);
});

// 3. Unicode + CJK markdown.
check("unicode / CJK", () => {
  const md =
    "## 认证模块\n\n1. 编辑 `src/认证.ts` 添加中间件\n2. 创建 tests/认证/登录.test.ts\n3. 运行 `pnpm test`";
  const s = parsePlanHeuristic(md);
  if (s.length < 3) throw new Error(`expected ≥3 got ${s.length}`);
  if (!s[0].summary) throw new Error("empty summary");
});

// 4. Malformed fence — unclosed code block.
check("unclosed fence", () => {
  const md = "## Step\n\n- do thing\n\n```bash\npnpm test\n- another item\n";
  const s = parsePlanHeuristic(md);
  if (s.length === 0) throw new Error("no steps");
});

// 5. Nested fences / backticks inside content.
check("backticks in summary", () => {
  const md = "- wrap `a` and `b` and `c` into `src/x.ts`";
  const s = parsePlanHeuristic(md);
  if (!s[0].scope.files.includes("src/x.ts")) throw new Error("missing src/x.ts");
});

// 6. URL + path hybrid.
check("url ignored path kept", () => {
  const md = "1. see https://example.com/docs/foo then edit `src/foo.ts`";
  const s = parsePlanHeuristic(md);
  if (s[0].scope.files.some((f) => f.includes("example.com"))) throw new Error("URL leaked");
  if (!s[0].scope.files.includes("src/foo.ts")) throw new Error("missing src/foo.ts");
});

// 7. Property-based: never throws on any ASCII/printable garbage.
check("property: parser never throws on random strings", () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 2000 }), (s) => {
      const out = parsePlanHeuristic(s);
      return Array.isArray(out) && out.length >= 1;
    }),
    { numRuns: 200 },
  );
});

// 8. Property-based on generic mixed markdown tokens.
check("property: markdown-ish input never throws", () => {
  const token = fc.oneof(
    fc.constant("\n"),
    fc.constant("\n\n"),
    fc.constantFrom("# ", "## ", "### ", "- ", "* ", "1. ", "2. "),
    fc.constantFrom("```bash\n", "```\n", "`src/x.ts`", "`pnpm test`"),
    fc.string({ maxLength: 40 }),
  );
  fc.assert(
    fc.property(fc.array(token, { maxLength: 60 }), (arr) => {
      const md = arr.join("");
      const out = parsePlanHeuristic(md);
      return Array.isArray(out) && out.every((s) => typeof s.summary === "string");
    }),
    { numRuns: 300 },
  );
});

// 9. Engine: never throws on arbitrary tool names + paths.
check("property: scoreCall never throws", () => {
  const steps = parsePlanHeuristic(
    "## Auth\n- edit `src/auth/login.ts`\n- create `tests/auth/login.test.ts`\n",
  );
  fc.assert(
    fc.property(
      fc.string({ maxLength: 40 }),
      fc.array(fc.string({ maxLength: 60 }), { maxLength: 3 }),
      (toolName, paths) => {
        const toolInput =
          paths.length > 0 ? { file_path: paths[0] } : ({} as Record<string, unknown>);
        const call = extractToolCall(toolName, toolInput);
        const r = scoreCall(
          call,
          steps,
          steps.map((s) => s.id),
          { match: 0.7, partial: 0.4 },
          "D:/test",
        );
        return typeof r.verdict === "string" && typeof r.reason === "string";
      },
    ),
    { numRuns: 200 },
  );
});

// 10. Extreme whitespace variations (CRLF, mixed).
check("CRLF input", () => {
  const md = "1. edit src/a.ts\r\n2. edit src/b.ts\r\n3. run `pnpm test`\r\n";
  const s = parsePlanHeuristic(md);
  if (s.length !== 3) throw new Error(`expected 3 got ${s.length}`);
});

// 11. Binary-ish garbage.
check("null bytes / control chars", () => {
  const md = "1. edit src/a.ts\u0000\u0001\u0002\n2. edit \u007fsrc/b.ts\n";
  const s = parsePlanHeuristic(md);
  if (s.length < 1) throw new Error("crashed");
});

process.stdout.write(`\n[fuzz] ok=${ok} fail=${bad}\n`);
if (bad > 0) {
  for (const f of failures) process.stderr.write(`  ${f}\n`);
  process.exit(1);
}
