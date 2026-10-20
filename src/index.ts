/**
 * @fileoverview Main entry point for the Antigravity local CLI adapter.
 * Exports adapter identification, model catalogs, profile definitions, and factory functions.
 *
 * @copyright Antigravity Adapter Contributors
 * @license MIT
 */

import { type ServerAdapterModule } from "@paperclipai/adapter-utils";
import { execute, testEnvironment } from "./server/index.js";
import {
  DEFAULT_ANTIGRAVITY_LOCAL_MODEL,
  DEFAULT_LEADERSHIP_ARGON_MODEL,
  DEFAULT_LEADERSHIP_CLAUDE_FALLBACK_MODEL,
  DEFAULT_LEADERSHIP_GEMINI_FALLBACK_MODEL,
  DEFAULT_WORKER_CLAUDE_MODEL,
  DEFAULT_WORKER_GEMINI_MODEL,
  DEFAULT_WORKER_GPT_FALLBACK_MODEL,
} from "./constants.js";
import type { AntigravityModelDefinition, AntigravityModelProfileDefinition } from "./types.js";

export const type = "antigravity_local";
export const label = "Antigravity CLI (local)";

export {
  DEFAULT_ANTIGRAVITY_LOCAL_MODEL,
  DEFAULT_LEADERSHIP_ARGON_MODEL,
  DEFAULT_LEADERSHIP_CLAUDE_FALLBACK_MODEL,
  DEFAULT_LEADERSHIP_GEMINI_FALLBACK_MODEL,
  DEFAULT_WORKER_GEMINI_MODEL,
  DEFAULT_WORKER_CLAUDE_MODEL,
  DEFAULT_WORKER_GPT_FALLBACK_MODEL,
};

/** Common model alias mapping for shorthand references. */
const ANTIGRAVITY_MODEL_ALIASES: Record<string, string> = {
  pro: "gemini-4-argon-high",
  flash: "gemini-3.8-flash-medium",
  flash_lite: "gemini-3.8-flash-low",
};

/**
 * Resolves an effective Antigravity model technical string from explicit configuration or environment.
 * Applies shorthand alias resolution (e.g., 'pro' -> 'gemini-4-argon-high').
 *
 * @param model - Configured model name or alias.
 * @param env - Optional environment variables dictionary.
 * @returns Resolved technical model identifier.
 */
export function resolveAntigravityModel(
  model: unknown,
  env: Record<string, unknown> = {},
): string {
  const configured = typeof model === "string" ? model.trim() : "";
  if (configured) return ANTIGRAVITY_MODEL_ALIASES[configured] ?? configured;
  const envModel = typeof env.ANTIGRAVITY_MODEL === "string" ? env.ANTIGRAVITY_MODEL.trim() : "";
  if (envModel) return ANTIGRAVITY_MODEL_ALIASES[envModel] ?? envModel;
  return DEFAULT_ANTIGRAVITY_LOCAL_MODEL;
}

/** Supported modern models list exposed to Paperclip web console. */
export const models: AntigravityModelDefinition[] = [
  { id: "inherit", label: "Auto (Inherit)" },
  { id: "claude-opus-5-5-high", label: "Claude Opus 5.5 (High)" },
  { id: "claude-opus-5-5-medium", label: "Claude Opus 5.5 (Medium)" },
  { id: "claude-opus-5-5-low", label: "Claude Opus 5.5 (Low)" },
  { id: "claude-sonnet-5-5-high", label: "Claude Sonnet 5.5 (High)" },
  { id: "claude-sonnet-5-5-medium", label: "Claude Sonnet 5.5 (Medium)" },
  { id: "claude-sonnet-5-5-low", label: "Claude Sonnet 5.5 (Low)" },
  { id: "gemini-4-argon-high", label: "Gemini 4 Argon (High)" },
  { id: "gemini-4-argon-medium", label: "Gemini 4 Argon (Medium)" },
  { id: "gemini-4-argon-low", label: "Gemini 4 Argon (Low)" },
  { id: "gemini-3.1-pro-high", label: "Gemini 3.1 Pro (High)" },
  { id: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)" },
  { id: "gemini-3.8-flash-medium", label: "Gemini 3.8 Flash (Medium)" },
  { id: "gemini-3.8-flash-low", label: "Gemini 3.8 Flash (Low)" },
  { id: "gpt-oss-120b-medium", label: "GPT-OSS 120B (Medium)" },
];

/** Preconfigured cost and capability model profiles. */
export const modelProfiles: AntigravityModelProfileDefinition[] = [
  {
    key: "cheap",
    label: "Cheap",
    description: "Use Gemini 3.8 Flash for fast, cost-effective routing.",
    adapterConfig: {
      model: "gemini-3.8-flash-low",
    },
    source: "adapter_default",
  },
  {
    key: "smart",
    label: "Smart",
    description: "Use Gemini 4 Argon for complex architectural analysis and reasoning.",
    adapterConfig: {
      model: "gemini-4-argon-high",
    },
    source: "adapter_default",
  },
];

/** Command executed to ensure Antigravity CLI presence in sandboxed execution targets. */
export const SANDBOX_INSTALL_COMMAND = "which agy || echo 'Antigravity CLI (agy) required'";

/** Documentation displayed in Paperclip Web UI for the adapter. */
export const agentConfigurationDoc = `# antigravity_local agent configuration

Adapter: antigravity_local

Use when:
- You want Paperclip to run the Antigravity CLI (\`agy\`) locally on the host machine
- You want Antigravity sessions resumed across heartbeats with \`--conversation <id>\`
- You want seamless tool approval via \`--dangerously-skip-permissions\`
- You want multi-account pooling and rotation between subscription profiles
- You want real-time streaming of thinking, tools, MCP, and subagents

Core fields:
- cwd (string, optional): default absolute working directory fallback for the agent process
- instructionsFilePath (string, optional): absolute path to markdown instructions file prepended to prompt
- promptTemplate (string, optional): run prompt template
- model (string, optional): model id (e.g. inherit, pro, flash, flash_lite, claude-opus-5-5-high). Defaults to inherit.
- effort (string, optional): reasoning effort (low|medium|high|xhigh|max)
- command (string, optional): defaults to "agy"
- accountProfile (string, optional): profile key for multi-account pool routing (e.g. "account-1", "account-2")
- dangerouslySkipPermissions (boolean, optional): auto-grant tool execution permissions (defaults to true)
- extraArgs (string[], optional): additional CLI args
- env (object, optional): KEY=VALUE environment variables

Operational fields:
- timeoutSec (number, optional): run timeout in seconds (0 = wait until completion)
- graceSec (number, optional): SIGTERM grace period in seconds (default 15)

Notes:
- Runs use \`agy -p <prompt> --output-format stream-json --dangerously-skip-permissions\`.
- Sessions resume with \`--conversation <id>\` matching stored session ID.
- Usage tracking accounts for tokens and rolling windows (5-hour session and 7-day weekly limits).
`;

/**
 * Creates and returns the server adapter module for registration in Paperclip.
 *
 * @returns Fully populated ServerAdapterModule object.
 */
export function createServerAdapter(): ServerAdapterModule {
  return {
    type,
    execute,
    testEnvironment,
    models,
    supportsInstructionsBundle: true,
    instructionsPathKey: "instructionsFilePath",
    agentConfigurationDoc,
  };
}
