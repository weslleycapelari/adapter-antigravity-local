import type { AdapterModelProfileKey } from "@paperclipai/adapter-utils";

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
  /** The AI model identifier (e.g., "gemini-3.5-flash"). */
  model?: string;
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
  /** The global run timeout in seconds for agent execution. */
  timeoutSec?: unknown;
  /** The grace period in seconds before forcibly killing the process with SIGKILL. */
  graceSec?: unknown;
  /** The timeout in seconds specifically for the initial connection probe (Self-test). */
  helloProbeTimeoutSec?: unknown;
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
  /** The unique model identifier (e.g., "claude-sonnet-4.6-thinking" or "auto"). */
  model: string;
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
  /** The probe timeout in seconds. Defaults to 60. */
  helloProbeTimeoutSec?: number;
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
  /** Technical ID passed to the ANTIGRAVITY_MODEL environment variable (e.g., "claude-sonnet-4.6-thinking"). */
  id: string;
  /** User-friendly label displayed in Paperclip's web console (e.g., "Claude Sonnet 4.6 (Thinking)"). */
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
