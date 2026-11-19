import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AntigravityModelDefinition } from "../types.js";

const execFileAsync = promisify(execFile);
const MODEL_CACHE_MS = 5 * 60_000;
const FAILED_LOOKUP_CACHE_MS = 30_000;
const MODEL_COMMAND_TIMEOUT_MS = 15_000;

async function discoverModels(): Promise<AntigravityModelDefinition[]> {
  try {
    const { stdout } = await execFileAsync("agy", ["models"], {
      timeout: MODEL_COMMAND_TIMEOUT_MS,
      killSignal: "SIGKILL",
      windowsHide: true,
    });
    const models = new Map<string, AntigravityModelDefinition>();
    for (const line of stdout.split(/\r?\n/)) {
      const separator = line.indexOf("\t");
      if (separator === -1) continue;

      const id = line.slice(0, separator).trim();
      const label = line.slice(separator + 1).trim();
      if (/^[a-z0-9][a-z0-9._/-]*$/i.test(id) && id !== "inherit" && label && !models.has(id)) {
        models.set(id, { id, label });
      }
    }
    return [...models.values()];
  } catch {
    // Paperclip falls back to the static catalog when discovery is unavailable.
    return [];
  }
}

export function createModelDiscovery(inheritModel: AntigravityModelDefinition) {
  let cachedModels: AntigravityModelDefinition[] = [];
  let expiresAt = 0;
  let pending: Promise<AntigravityModelDefinition[]> | undefined;

  function refreshModels(): Promise<AntigravityModelDefinition[]> {
    pending ??= discoverModels().then((discovered) => {
      cachedModels = discovered.length > 0 ? [inheritModel, ...discovered] : [];
      expiresAt = Date.now() + (discovered.length > 0 ? MODEL_CACHE_MS : FAILED_LOOKUP_CACHE_MS);
      pending = undefined;
      return cachedModels;
    });
    return pending;
  }

  async function listModels(): Promise<AntigravityModelDefinition[]> {
    if (pending) return pending;
    return Date.now() < expiresAt ? cachedModels : refreshModels();
  }

  return { listModels, refreshModels };
}
