import { Command } from "commander";
import { runCapturePlan } from "./commands/capture-plan.js";
import { runInit } from "./commands/init.js";
import { runMatchTool } from "./commands/match-tool.js";
import { runReport } from "./commands/report.js";
import { runStatus } from "./commands/status.js";

const VERSION = "0.1.0-alpha.0";

const program = new Command();
program
  .name("planlock")
  .description("Real-time plan-drift watchdog for Claude Code")
  .version(VERSION);

program
  .command("init")
  .description("Register planlock hooks in .claude/settings.local.json")
  .action(() => runInit());

program
  .command("capture-plan")
  .description("PreToolUse:ExitPlanMode handler — captures the approved plan")
  .action(async () => {
    await runCapturePlan();
  });

program
  .command("match-tool")
  .description("PreToolUse wildcard handler — logs every tool call")
  .action(async () => {
    await runMatchTool();
  });

program
  .command("report")
  .description("Stop hook handler — writes session report")
  .action(async () => {
    await runReport();
  });

program
  .command("status")
  .description("Print current planlock session state")
  .action(() => runStatus());

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`planlock: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
