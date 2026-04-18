import type { Step } from "../types.js";

interface Fence {
  lang: string;
  body: string;
}

const LIST_MARKER = /^\s*(?:\d+[.)]\s|[-*]\s|Step\s+\d+\b[\s—:-]*)/i;
const HEADING = /^#{1,3}\s+/;
const FENCE_SENTINEL = /__PLANLOCK_FENCE_(\d+)__/g;
const CMD_PREFIXES = new Set([
  "npm",
  "pnpm",
  "yarn",
  "git",
  "node",
  "tsc",
  "vitest",
  "bash",
  "sh",
  "curl",
  "rm",
  "mv",
  "cp",
  "mkdir",
  "make",
]);

function extractFences(md: string): { stripped: string; fences: Fence[] } {
  const fences: Fence[] = [];
  const stripped = md.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, body) => {
    const idx = fences.length;
    fences.push({ lang: String(lang || "").toLowerCase(), body: String(body) });
    return `__PLANLOCK_FENCE_${idx}__`;
  });
  return { stripped, fences };
}

function splitListItems(md: string): string[] {
  const lines = md.split(/\r?\n/);
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (LIST_MARKER.test(lines[i])) starts.push(i);
  }
  if (starts.length === 0) return [];
  const items: string[] = [];
  for (let i = 0; i < starts.length; i++) {
    const begin = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : lines.length;
    items.push(lines.slice(begin, end).join("\n"));
  }
  return items;
}

function splitIntoStepBlocks(md: string): string[] {
  if (/^#{1,3}\s+/m.test(md)) {
    const lines = md.split(/\r?\n/);
    const sections: string[] = [];
    let current: string[] = [];
    for (const line of lines) {
      if (HEADING.test(line)) {
        if (current.length) sections.push(current.join("\n"));
        current = [line];
      } else {
        current.push(line);
      }
    }
    if (current.length) sections.push(current.join("\n"));
    const out: string[] = [];
    for (const section of sections) {
      const items = splitListItems(section);
      if (items.length > 1) {
        out.push(...items);
        continue;
      }
      if (section.trim().length === 0) continue;
      const nonEmpty = section.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const onlyHeading = nonEmpty.length === 1 && HEADING.test(nonEmpty[0]);
      if (onlyHeading) {
        // Bare-heading section with no body — keep only if the heading itself
        // carries a path or a runnable command (e.g. "## Run `pnpm test`"), not
        // just any backticked token (e.g. a flag name like `--version`).
        const probe = stepSummary(nonEmpty[0]);
        if (extractFiles(probe).length === 0 && extractCommands(probe, []).length === 0) continue;
      }
      out.push(section);
    }
    return out;
  }
  const items = splitListItems(md);
  if (items.length > 0) return items;
  return md
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function stepSummary(block: string): string {
  const first = block.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  return first
    .replace(/^#{1,6}\s*/, "")
    .replace(LIST_MARKER, "")
    .replace(FENCE_SENTINEL, "")
    .trim()
    .slice(0, 120);
}

function isPathLike(token: string): boolean {
  if (!token) return false;
  if (/\s/.test(token)) return false;
  if (/^https?:\/\//i.test(token)) return false;
  if (token.startsWith("@")) return false;
  if (token.includes("/")) return true;
  return /\.[a-zA-Z0-9]{1,6}$/.test(token);
}

function normalizePath(token: string): string {
  if (token.endsWith("/")) return `${token}**`;
  return token;
}

function extractFiles(block: string): string[] {
  const set = new Set<string>();
  for (const m of block.matchAll(/`([^`\n]+)`/g)) {
    const token = m[1].trim();
    if (isPathLike(token)) set.add(normalizePath(token));
  }
  const rawRe = /(?<![`\w/])((?:[\w.-]+\/)+(?:[\w.*-]+(?:\.[\w]+)?)?(?:\/\*+)?)/g;
  for (const m of block.matchAll(rawRe)) {
    const token = m[1];
    if (isPathLike(token)) set.add(normalizePath(token));
  }
  return [...set];
}

function extractCommands(block: string, fences: Fence[]): string[] {
  const out: string[] = [];
  for (const m of block.matchAll(FENCE_SENTINEL)) {
    const f = fences[Number(m[1])];
    if (!f) continue;
    if (["bash", "sh", "shell", "zsh", ""].includes(f.lang)) {
      const body = f.body.trim();
      if (body.length > 0) out.push(body);
    }
  }
  for (const m of block.matchAll(/`([^`\n]+)`/g)) {
    const token = m[1].trim();
    const first = token.split(/\s+/)[0];
    if (CMD_PREFIXES.has(first)) out.push(token);
  }
  return out;
}

function inferOperations(block: string, hasCommands: boolean): string[] {
  const text = block.toLowerCase();
  const ops = new Set<string>();
  if (/\b(edit|update|modify|change|rewrite|refactor|fix|patch)\b/.test(text)) {
    ops.add("Edit");
    ops.add("Write");
  }
  if (/\b(create|add|write|generate|implement|introduce|scaffold)\b/.test(text)) {
    ops.add("Write");
  }
  if (/\b(read|inspect|review|check|look)\b/.test(text)) {
    ops.add("Read");
  }
  if (
    hasCommands ||
    /\b(run|execute|test|build|install|commit|deploy|lint|typecheck)\b/.test(text)
  ) {
    ops.add("Bash");
  }
  return [...ops];
}

export function parsePlanHeuristic(markdown: string): Step[] {
  const { stripped, fences } = extractFences(markdown);
  const blocks = splitIntoStepBlocks(stripped);
  const steps: Step[] = [];
  for (const block of blocks) {
    const summary = stepSummary(block);
    if (summary.length === 0) continue;
    const files = extractFiles(block);
    const commands = extractCommands(block, fences);
    const operations = inferOperations(block, commands.length > 0);
    steps.push({
      id: `s${steps.length + 1}`,
      summary,
      scope: { files, commands, operations },
      dependencies: [],
    });
  }
  if (steps.length === 0) {
    return [
      {
        id: "s1",
        summary: "(unparsed)",
        scope: { files: [], commands: [], operations: [] },
        dependencies: [],
      },
    ];
  }
  return steps;
}
