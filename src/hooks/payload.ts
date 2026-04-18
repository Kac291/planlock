import { z } from "zod";

const base = z
  .object({
    session_id: z.string(),
    cwd: z.string(),
    hook_event_name: z.string().optional(),
    transcript_path: z.string().optional(),
  })
  .passthrough();

export const PreToolUsePayload = base
  .extend({
    tool_name: z.string(),
    tool_input: z.unknown().optional(),
  })
  .passthrough();

export const StopPayload = base.passthrough();

export const UserPromptSubmitPayload = base
  .extend({
    prompt: z.string().optional(),
  })
  .passthrough();

export type PreToolUse = z.infer<typeof PreToolUsePayload>;
export type Stop = z.infer<typeof StopPayload>;
export type UserPromptSubmit = z.infer<typeof UserPromptSubmitPayload>;
