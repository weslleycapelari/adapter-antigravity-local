/**
 * @fileoverview Skills synchronization and registration subsystem for Google Antigravity local CLI plugins.
 * Manages symlinks connecting Paperclip runtime skill definitions into the target `~/.agy/plugins` directory.
 * 
 * @copyright Antigravity Adapter Contributors
 * @license MIT
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AdapterSkillContext,
  AdapterSkillSnapshot,
} from "@paperclipai/adapter-utils";
import {
  buildPersistentSkillSnapshot,
  ensurePaperclipSkillSymlink,
  readPaperclipRuntimeSkillEntries,
  readInstalledSkillTargets,
  resolvePaperclipDesiredSkillNames,
} from "@paperclipai/adapter-utils/server-utils";

import { isNonEmptyString } from "../utils.js";

/** Module level directory path resolution. */
const __moduleDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Trims and returns a string if it is a non-empty string, or returns null otherwise.
 *
 * @param value - The value to inspect.
 * @returns The trimmed string or null.
 */
function readNonEmptyString(value: unknown): string | null {
  return isNonEmptyString(value) ? value.trim() : null;
}

/**
 * Resolves the effective target plugins directory path (`~/.agy/plugins`).
 * Respects customized HOME env variables configured within the adapter runtime context.
 *
 * @param config - The raw configuration object dictionary.
 * @returns Fully qualified absolute path to the Antigravity plugins directory.
 */
function resolveAntigravitySkillsHome(config: Record<string, unknown>): string {
  const env =
    typeof config.env === "object" && config.env !== null && !Array.isArray(config.env)
      ? (config.env as Record<string, unknown>)
      : {};
  const configuredHome = readNonEmptyString(env.HOME);
  const home = configuredHome ? path.resolve(configuredHome) : os.homedir();
  
  return path.join(home, ".agy", "plugins");
}

/**
 * Builds a stateful representation snapshot of available, active, and conflicting skills.
 *
 * @param config - The raw adapter configuration dictionary.
 * @returns Complete persistent skill state snapshot.
 */
async function buildAntigravitySkillSnapshot(config: Record<string, unknown>): Promise<AdapterSkillSnapshot> {
  const availableEntries = await readPaperclipRuntimeSkillEntries(config, __moduleDir);
  const desiredSkills = resolvePaperclipDesiredSkillNames(config, availableEntries);
  const skillsHome = resolveAntigravitySkillsHome(config);
  const installed = await readInstalledSkillTargets(skillsHome);
  
  return buildPersistentSkillSnapshot({
    adapterType: "antigravity_local",
    availableEntries,
    desiredSkills,
    installed,
    skillsHome,
    locationLabel: "~/.agy/plugins",
    missingDetail: "Configured but not currently linked into the Antigravity plugins home.",
    externalConflictDetail: "Plugin name is occupied by an external installation.",
    externalDetail: "Installed outside Paperclip management.",
  });
}

/**
 * Lists all registered, available, and conflicting Antigravity local skills.
 *
 * @param ctx - The adapter skills operation context.
 * @returns Resolved skills state snapshot.
 */
export async function listAntigravitySkills(ctx: AdapterSkillContext): Promise<AdapterSkillSnapshot> {
  return buildAntigravitySkillSnapshot(ctx.config);
}

/**
 * Synchronizes the filesystem target symlinks between Paperclip's repository and 
 * the local `~/.agy/plugins` directory. Establishes missing links and prunes obsolete ones.
 *
 * @param ctx - The adapter skills operation context.
 * @param desiredSkills - List of skill keys chosen by the orchestrator to sync.
 * @returns Refreshed skills snapshot representing the active post-sinc state.
 */
export async function syncAntigravitySkills(
  ctx: AdapterSkillContext,
  desiredSkills: string[],
): Promise<AdapterSkillSnapshot> {
  const availableEntries = await readPaperclipRuntimeSkillEntries(ctx.config, __moduleDir);
  
  // Assemble the unified set of skills to install (explicitly desired + required system skills)
  const desiredSet = new Set([
    ...desiredSkills,
    ...availableEntries.filter((entry) => entry.required).map((entry) => entry.key),
  ]);
  
  const skillsHome = resolveAntigravitySkillsHome(ctx.config);
  await fs.mkdir(skillsHome, { recursive: true });
  
  const installed = await readInstalledSkillTargets(skillsHome);
  const availableByRuntimeName = new Map(availableEntries.map((entry) => [entry.runtimeName, entry]));

  // Step 1: Install and establish symlinks for desired skills
  for (const available of availableEntries) {
    if (!desiredSet.has(available.key)) {
      continue;
    }
    const target = path.join(skillsHome, available.runtimeName);
    await ensurePaperclipSkillSymlink(available.source, target);
  }

  // Step 2: Identify and prune obsolete/orphaned symlinks previously managed by Paperclip
  for (const [name, installedEntry] of installed.entries()) {
    const available = availableByRuntimeName.get(name);
    if (!available) {
      continue;
    }
    if (desiredSet.has(available.key)) {
      continue;
    }
    if (installedEntry.targetPath !== available.source) {
      continue;
    }
    
    const targetLink = path.join(skillsHome, name);
    await fs.unlink(targetLink).catch(() => {});
  }

  return buildAntigravitySkillSnapshot(ctx.config);
}

/**
 * Resolves the final subset of desired skills based on adapter configurations.
 *
 * @param config - The raw configuration object dictionary.
 * @param availableEntries - Read list of locally defined runtime skills.
 * @returns List of finalized desired skill names.
 */
export function resolveAntigravityDesiredSkillNames(
  config: Record<string, unknown>,
  availableEntries: Array<{ key: string; required?: boolean }>,
): string[] {
  return resolvePaperclipDesiredSkillNames(config, availableEntries);
}