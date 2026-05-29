import { type ServerAdapterModule } from "@paperclipai/adapter-utils";
import { execute, testEnvironment } from "./server/index.js";
import type { AntigravityModelDefinition, AntigravityModelProfileDefinition } from "./types.js";

export const type = "antigravity_local";
export const label = "Antigravity CLI (local)";

// O Antigravity usa scripts diretos de instalação (Go bin) em vez de NPM
export const SANDBOX_INSTALL_COMMAND = "curl -sSL https://antigravity.google/install.sh | bash";

export const DEFAULT_ANTIGRAVITY_LOCAL_MODEL = "auto";

export const models: AntigravityModelDefinition[] = [
  { id: DEFAULT_ANTIGRAVITY_LOCAL_MODEL, label: "Auto (Use global configured default)" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash (Medium)" },
  { id: "gemini-3.1-pro-high", label: "Gemini 3.1 Pro (High)" },
  { id: "gemini-3.1-pro-low", label: "Gemini 3.1 Pro (Low)" },
  { id: "claude-sonnet-4.6-thinking", label: "Claude Sonnet 4.6 (Thinking)" },
  { id: "claude-opus-4.6-thinking", label: "Claude Opus 4.6 (Thinking)" },
  { id: "gpt-oss-120b", label: "GPT-OSS 120B (Medium)" },
];

export const modelProfiles: AntigravityModelProfileDefinition[] = [
  {
    key: "cheap",
    label: "Cheap",
    description: "Use Gemini 3.5 Flash for faster, cost-effective routing.",
    adapterConfig: {
      model: "gemini-3.5-flash",
    },
    source: "adapter_default",
  },
];

export const agentConfigurationDoc = `# antigravity_local agent configuration

Adapter: antigravity_local

Use when:
- You want Paperclip to run the Antigravity CLI locally on the host machine
- You want to leverage native Go performance and improved startup times
- You want Paperclip skills injected locally via Antigravity plugin paths

Core fields:
- cwd (string, optional): default absolute working directory fallback for the agent process
- instructionsFilePath (string, optional): absolute path to a markdown instructions file
- promptTemplate (string, optional): run prompt template
- model (string, optional): Antigravity model id. Defaults to auto.
- command (string, optional): defaults to "agy"
- extraArgs (string[], optional): additional CLI args
- env (object, optional): KEY=VALUE environment variables

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds

Notes:
- Runs use positional prompt arguments.
- Authentication utilizes the native OS keyring or ANTIGRAVITY_API_KEY environment variable.
`;

export function createServerAdapter(): ServerAdapterModule {
  return {
    type,
    execute,
    testEnvironment,
    models,
    modelProfiles,
    supportsInstructionsBundle: true,
    instructionsPathKey: "instructionsFilePath",
    agentConfigurationDoc,
  };
}