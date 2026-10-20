/**
 * @fileoverview Strongly-typed domain models and interface definitions for the Antigravity local CLI adapter.
 * Encapsulates configurations, session parameters, telemetry events, tools, quotas, and account pooling structures.
 *
 * @copyright Antigravity Adapter Contributors
 * @license MIT
 */

import type { ProviderQuotaResult, UsageSummary } from "@paperclipai/adapter-utils";

/**
 * Model profile identifier keys for standard agent performance tiers.
 */
export type AdapterModelProfileKey = "fast" | "standard" | "smart" | "reasoning" | string;

/**
 * Represents an environment variable binding with a literal/plain-text value.
 *
 * @example
 * ```typescript
 * const env: EnvBindingPlain = {
 *   type: "plain",
 *   value: "production"
 * };
 * ```
 */
export interface EnvBindingPlain {
  /** The binding type identifier. Must always be "plain". */
  type: "plain";
  /** The plain-text value of the environment variable. */
  value: string;
}

/**
 * Represents an environment variable binding referencing a secret 
 * securely managed by Paperclip's credentials vault.
 *
 * @example
 * ```typescript
 * const secret: EnvBindingSecretRef = {
 *   type: "secret_ref",
 *   secretId: "DATABASE_PASSWORD",
 *   version: "latest"
 * };
 * ```
 */
export interface EnvBindingSecretRef {
  /** The binding type identifier. Must always be "secret_ref". */
  type: "secret_ref";
  /** The unique identifier of the secret stored securely in Paperclip. */
  secretId: string;
  /**
   * The version of the secret to retrieve.
   * Can be a sequential version number or "latest" to fetch the most recent value.
   */
  version?: number | "latest";
}

/**
 * Union type representing the possible ways to bind environment variables in Paperclip.
 */
export type EnvBinding = EnvBindingPlain | EnvBindingSecretRef;

/**
 * A key-value collection indexed by strings representing strongly-typed environment variables.
 */
export type EnvBindings = Record<string, EnvBinding>;

/**
 * Classification of models into families for quota tracking and quota isolation.
 */
export type AntigravityModelFamily = "argon" | "gemini3" | "claude_gpt";

/**
 * Raw and unstructured configuration values received directly from Paperclip's web console.
 * Contains strings and generic objects entered by the user in the UI.
 */
export interface AntigravityRawConfigValues {
  /** Optional absolute path of the default working directory fallback. */
  cwd?: string;
  /** Optional absolute path of the markdown file (.md) containing system instructions. */
  instructionsFilePath?: string;
  /** The initial prompt execution template containing dynamic wildcards/tags. */
  promptTemplate?: string;
  /** Optional bootstrap prompt template run only on fresh (unresumed) sessions. */
  bootstrapPromptTemplate?: string;
  /** The AI model identifier (e.g., "gemini-3.8-flash-high"). */
  model?: string;
  /** Reasoning effort level passed via --effort ("low", "medium", "high", "xhigh", "max"). */
  effort?: string;
  /** Thinking effort alias captured from Paperclip Web UI. */
  thinkingEffort?: string;
  /** If true, auto-approves CLI tool execution permissions via --dangerously-skip-permissions. */
  dangerouslySkipPermissions?: boolean;
  /** Account profile identifier for multi-account pool routing (e.g., "account-1"). */
  accountProfile?: string;
  /** The terminal command that executes the Antigravity binary. Defaults to "agy". */
  command?: string;
  /** Additional command-line arguments entered via the UI, separated by commas. */
  extraArgs?: string;
  /** Legacy additional command-line arguments, separated by commas. */
  args?: string;
  /** Legacy block of environment variables in KEY=VALUE format per line. */
  envVars?: string;
  /** Dictionary containing the structured environment bindings (plain or secret_ref). */
  envBindings?: unknown;
  /** If true, dangerously bypasses the operating system security sandbox. */
  dangerouslyBypassSandbox?: boolean;
  /** The global run timeout in seconds for agent execution (0 = unlimited). */
  timeoutSec?: unknown;
  /** The grace period in seconds before forcibly killing the process with SIGKILL. */
  graceSec?: unknown;
  /** Grace period in milliseconds for terminal result cleanup. Defaults to 1000ms. */
  terminalResultCleanupGraceMs?: unknown;
  /** The timeout in seconds specifically for the initial connection probe (Self-test). */
  helloProbeTimeoutSec?: unknown;
  /** Whether to automatically failover/rotate accounts upon encountering HTTP 429 rate limits. */
  autoRotateOnRateLimit?: boolean;
  /** Optional git worktree workspace strategy type ("git_worktree"). */
  workspaceStrategyType?: string;
  /** Base git branch ref for worktree checkout. */
  workspaceBaseRef?: string;
  /** Worktree branch naming template. */
  workspaceBranchTemplate?: string;
  /** Parent directory path for worktrees. */
  worktreeParentDir?: string;
  /** JSON payload defining runtime services (e.g., database, redis). */
  runtimeServicesJson?: string;
}

/**
 * Strict and strongly-typed configuration structure used internally 
 * by the adapter's execution engine.
 */
export interface AntigravityAdapterConfig {
  /** The absolute path of the default process working directory. */
  cwd?: string;
  /** The absolute path of the markdown file containing system instructions. */
  instructionsFilePath?: string;
  /** The compiled template of the orchestrator agent prompt. */
  promptTemplate?: string;
  /** Optional bootstrap prompt template run only on fresh conversations. */
  bootstrapPromptTemplate?: string;
  /** The unique model identifier (e.g., "gemini-3.8-flash-high" or "inherit"). */
  model: string;
  /** Reasoning effort level passed to the Antigravity CLI via --effort. */
  effort?: string;
  /** If true, passes --dangerously-skip-permissions to allow autonomous tool execution. Defaults to true. */
  dangerouslySkipPermissions?: boolean;
  /** Account profile identifier for multi-account pool routing (e.g., "account-1"). */
  accountProfile?: string;
  /** The executable binary command. Typically resolves to "agy". */
  command?: string;
  /** Structured list of additional CLI arguments passed to the Antigravity process. */
  extraArgs?: string[];
  /** Structured list of legacy additional arguments passed to the process. */
  args?: string[];
  /** Strongly-typed collection of environment variables injected into the child process. */
  env?: EnvBindings;
  /** Indicates whether CLI terminal and file system security restrictions are enabled. */
  sandbox?: boolean;
  /** The inactivity timeout in seconds. Zero indicates unlimited execution time. */
  timeoutSec?: number;
  /** The process termination grace period in seconds after SIGTERM. Defaults to 15. */
  graceSec?: number;
  /** Grace period in milliseconds before cleaning up after a terminal result event. */
  terminalResultCleanupGraceMs?: number;
  /** The probe timeout in seconds. Defaults to 60. */
  helloProbeTimeoutSec?: number;
  /** Enables automatic pool rotation when rate limits or quota exhaustions occur. Defaults to true. */
  autoRotateOnRateLimit?: boolean;
  /** Optional workspace strategy configuration (e.g., git_worktree). */
  workspaceStrategy?: Record<string, unknown>;
  /** Optional workspace runtime services configuration. */
  workspaceRuntime?: Record<string, unknown>;
}

/**
 * Structured parameters for Antigravity conversation session persistence.
 * Allows restoring the history and state of a prior run in subsequent heartbeats.
 * Extends Record<string, unknown> to remain fully compliant with Paperclip's codec interface.
 */
export interface AntigravitySessionParams extends Record<string, unknown> {
  /** The conversation ID generated natively by the Antigravity CLI. */
  sessionId: string;
  /** The absolute working directory of the active session. */
  cwd?: string;
  /** The account profile associated with this session (isolates credentials and brain transcripts). */
  accountProfile?: string;
  /** The ID of the active workspace associated with this session in Paperclip. */
  workspaceId?: string;
  /** The Git repository URL of the project, if applicable. */
  repoUrl?: string;
  /** The Git reference (branch, commit, or tag) active in the workspace repository. */
  repoRef?: string;
  /** Optional structured metadata of the remote execution environment (SSH/Sandbox). */
  remoteExecution?: Record<string, unknown> | null;
}

/**
 * Structured definition of a model supported by the adapter, mapped to Paperclip's graphical interface.
 */
export interface AntigravityModelDefinition {
  /** Technical ID passed to the CLI via --model or ANTIGRAVITY_MODEL (e.g., "gemini-4-argon-high"). */
  id: string;
  /** User-friendly label displayed in Paperclip's web console (e.g., "Gemini 4 Argon (High)"). */
  label: string;
}

/**
 * Pre-configured default model profile offered within the Paperclip platform.
 */
export interface AntigravityModelProfileDefinition {
  /** The cost/capability profile key identifier (e.g., "cheap", "smart"). */
  key: AdapterModelProfileKey;
  /** The label displayed in the user interface (e.g., "Cheap"). */
  label: string;
  /** A brief explanation of the purpose and model backing this profile. */
  description?: string;
  /** Default configuration values injected when this profile is activated. */
  adapterConfig: {
    /** The AI model pre-selected for this cost profile. */
    model: string;
    [key: string]: unknown;
  };
  /** The definition origin. Must always be "adapter_default" for native profiles. */
  source: "adapter_default";
}

/**
 * Structured result of parsing the Antigravity CLI stream-json output.
 */
export interface AntigravityParseResult {
  /** The conversation ID extracted from init, step_update, or result events. */
  sessionId: string | null;
  /** The accumulated final response summary text. */
  summary: string;
  /** Aggregated token usage across all steps and final results. */
  usage: UsageSummary;
  /** Cost in USD if reported by the Antigravity process. */
  costUsd: number | null;
  /** Error message if execution encountered a step error or terminal failure. */
  errorMessage: string | null;
  /** Final execution status ("SUCCESS", "ERROR", "ACTIVE", or null if incomplete). */
  status: "SUCCESS" | "ERROR" | "ACTIVE" | null;
  /** The raw result event dictionary, if parsed. */
  resultEvent: Record<string, unknown> | null;
}

/**
 * Statistics extracted from parsing historical session transcripts in the brain directory.
 */
export interface TranscriptAccountStats {
  tokens5h: number;
  cached5h: number;
  steps5h: number;
  tokens7d: number;
  cached7d: number;
  steps7d: number;
  totalTokens: number;
  totalCachedTokens: number;
  totalSteps: number;
  conversationsCount: number;
  lastActiveAt: string | null;
  argonTokens5h?: number;
  gemini3Tokens5h?: number;
  claudeGptTokens5h?: number;
  argonSteps5h?: number;
  gemini3Steps5h?: number;
  claudeGptSteps5h?: number;
}

/**
 * Real-time quota payload obtained from Google Cloud Code API.
 */
export interface LiveCloudCodeQuota {
  ok: boolean;
  email?: string;
  tierId?: string | null;
  tierName: string | null;
  projectId: string | null;
  argonWeeklyUsedPct?: number;
  argonWeeklyRemainingPct?: number;
  argonWeeklyResetsAt?: string | null;
  argon5hUsedPct?: number;
  argonRemainingPct?: number;
  argon5hResetsAt?: string | null;
  gemini5hUsedPct: number;
  gemini5hRemainingPct?: number;
  gemini5hResetsAt: string | null;
  claude5hUsedPct: number;
  claude5hRemainingPct?: number;
  claude5hResetsAt: string | null;
  geminiWeeklyUsedPct?: number;
  geminiWeeklyRemainingPct?: number;
  geminiWeeklyResetsAt?: string | null;
  claudeWeeklyUsedPct?: number;
  claudeWeeklyRemainingPct?: number;
  claudeWeeklyResetsAt?: string | null;
  weeklyUsedPct: number;
  weeklyRemainingPct?: number;
  weeklyResetsAt: string | null;
  capturedAt: string;
  error?: string;
}

/**
 * Combined quota inspection result for an Antigravity account.
 */
export interface AntigravityAccountQuotaResult extends ProviderQuotaResult {
  accountKey?: string;
  accountLabel?: string;
  capturedAt?: string;
  isConnected?: boolean;
  email?: string;
  tierName?: string | null;
  inCooldown?: boolean;
  cooldownUntil?: string | null;
  cooldownReason?: string | null;
  familyCooldowns?: Partial<Record<AntigravityModelFamily, { cooldownUntil: string; reason: string }>>;
  argonWeeklyUsedPct?: number;
  argonWeeklyRemainingPct?: number;
  argonWeeklyResetsAt?: string | null;
  argon5hUsedPct?: number;
  argonRemainingPct?: number;
  argon5hResetsAt?: string | null;
  gemini5hUsedPct?: number;
  gemini5hRemainingPct?: number;
  gemini5hResetsAt?: string | null;
  claude5hUsedPct?: number;
  claude5hRemainingPct?: number;
  claude5hResetsAt?: string | null;
  geminiWeeklyUsedPct?: number;
  geminiWeeklyRemainingPct?: number;
  geminiWeeklyResetsAt?: string | null;
  claudeWeeklyUsedPct?: number;
  claudeWeeklyRemainingPct?: number;
  claudeWeeklyResetsAt?: string | null;
  weeklyUsedPct?: number;
  weeklyRemainingPct?: number;
  weeklyResetsAt?: string | null;
  transcriptStats?: TranscriptAccountStats;
}

/**
 * Internal state for an account stored in the local quota usage ledger.
 */
export interface AccountQuotaState {
  accountKey: string;
  accountLabel: string;
  events: Array<{
    timestamp: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
    totalTokens: number;
    success: boolean;
    model?: string;
    modelFamily?: AntigravityModelFamily;
  }>;
  cooldownUntil: number | null;
  cooldownReason: string | null;
  familyCooldowns?: Partial<Record<AntigravityModelFamily, { cooldownUntil: number; reason: string }>>;
  customSessionLimitTokens?: number;
  customWeeklyLimitTokens?: number;
}

/**
 * Execution candidate candidate representation in a multi-account execution plan.
 */
export interface AntigravityExecutionCandidate {
  accountKey: string;
  model: string;
  family: AntigravityModelFamily;
  usagePct: number;
  weeklyUsagePct: number;
}

/**
 * Result returned by the pool execution planner.
 */
export interface AntigravityPoolSelectionResult {
  selected: AntigravityExecutionCandidate;
  candidates: AntigravityExecutionCandidate[];
  wasAutoRotated: boolean;
  status: string;
}

/**
 * Information payload for an Antigravity tool execution step.
 */
export interface ToolInfoPayload {
  name?: string;
  parameters?: Record<string, unknown>;
  output?: unknown;
  result?: unknown;
  error?: string;
}

/**
 * Information payload when a subagent is invoked natively by Antigravity.
 */
export interface SubagentInfoPayload {
  subagent_id?: string;
  subagent_type?: string;
  role?: string;
  prompt?: string;
  status?: string;
  output?: unknown;
}
