/**
 * @fileoverview Skills synchronization and registration subsystem for Google Antigravity local CLI plugins.
 * Manages symlinks connecting Paperclip runtime skill definitions into the target `~/.gemini/antigravity-cli/skills` directory,
 * with support for per-account isolated profile directories.
 *
 * @copyright Antigravity Adapter Contributors
 * @license MIT
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AdapterSkillContext, AdapterSkillSnapshot } from "@paperclipai/adapter-utils";
import {
  buildPersistentSkillSnapshot,
  ensurePaperclipSkillSymlink,
  readPaperclipRuntimeSkillEntries,
  readInstalledSkillTargets,
  resolveLegacyPaperclipDesiredSkillNames,
} from "@paperclipai/adapter-utils/server-utils";
import { getAntigravityProfileHome, resolveRealHomeDir } from "./quota.js";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolves the effective target skills directory path (`~/.gemini/antigravity-cli/skills`).
 * Respects customized HOME env variables or account profiles configured within the adapter runtime context.
 *
 * @param config - The raw configuration object dictionary.
 * @param overrideAccountProfile - Optional explicit account profile key.
 * @returns Fully qualified absolute path to the Antigravity skills directory.
 */
export function resolveAntigravitySkillsHome(
  config: Record<string, unknown>,
  overrideAccountProfile?: string | null,
): string {
  const env =
    typeof config.env === "object" && config.env !== null && !Array.isArray(config.env)
      ? (config.env as Record<string, unknown>)
      : {};
  const configuredHome = typeof env.HOME === "string" && env.HOME.trim() ? env.HOME.trim() : null;
  const accountProfile =
    (typeof overrideAccountProfile === "string" && overrideAccountProfile.trim()) ||
    (typeof config.accountProfile === "string" && config.accountProfile.trim()) ||
    null;
  const home = configuredHome
    ? path.resolve(configuredHome)
    : accountProfile
      ? getAntigravityProfileHome(accountProfile)
      : resolveRealHomeDir();

  return path.join(home, ".gemini", "antigravity-cli", "skills");
}

/**
 * Builds a stateful representation snapshot of available, active, and conflicting skills.
 *
 * @param config - The raw adapter configuration dictionary.
 * @returns Complete persistent skill state snapshot.
 */
async function buildSkillSnapshot(config: Record<string, unknown>): Promise<AdapterSkillSnapshot> {
  const availableEntries = await readPaperclipRuntimeSkillEntries(config, __moduleDir);
  const desiredSkills = resolveLegacyPaperclipDesiredSkillNames(config, availableEntries);
  const skillsHome = resolveAntigravitySkillsHome(config);
  const installed = await readInstalledSkillTargets(skillsHome);

  return buildPersistentSkillSnapshot({
    adapterType: "antigravity_local",
    availableEntries,
    desiredSkills,
    installed,
    skillsHome,
    locationLabel: "~/.gemini/antigravity-cli/skills",
    missingDetail: "Configured but not currently linked into Antigravity skills.",
    externalConflictDetail: "Skill name is occupied by an external installation.",
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
  return buildSkillSnapshot(ctx.config);
}

/**
 * Synchronizes the filesystem target symlinks between Paperclip's repository and 
 * the local `~/.gemini/antigravity-cli/skills` directory. Establishes missing links and prunes obsolete ones.
 *
 * @param ctx - The adapter skills operation context.
 * @param desiredSkills - List of skill keys chosen by the orchestrator to sync.
 * @returns Refreshed skills snapshot representing the active post-sync state.
 */
export async function syncAntigravitySkills(
  ctx: AdapterSkillContext,
  desiredSkills: string[],
): Promise<AdapterSkillSnapshot> {
  const availableEntries = await readPaperclipRuntimeSkillEntries(ctx.config, __moduleDir);
  const desiredSet = new Set([
    ...desiredSkills,
    ...availableEntries
      .filter((entry) => (entry as { required?: boolean }).required)
      .map((entry) => entry.key),
  ]);
  const skillsHome = resolveAntigravitySkillsHome(ctx.config);
  await fs.mkdir(skillsHome, { recursive: true });
  const installed = await readInstalledSkillTargets(skillsHome);
  const availableByRuntimeName = new Map(availableEntries.map((entry) => [entry.runtimeName, entry]));

  const linkSkill = async (src: string, tgt: string) => {
    try {
      await fs.symlink(src, tgt, process.platform === "win32" ? "junction" : "dir");
    } catch {
      await fs.symlink(src, tgt);
    }
  };

  for (const available of availableEntries) {
    if (!desiredSet.has(available.key)) continue;
    const target = path.join(skillsHome, available.runtimeName);
    await ensurePaperclipSkillSymlink(available.source, target, linkSkill);
  }

  for (const [name, installedEntry] of installed.entries()) {
    const available = availableByRuntimeName.get(name);
    if (!available) continue;
    if (desiredSet.has(available.key)) continue;
    if (installedEntry.targetPath !== available.source) continue;
    await fs.unlink(path.join(skillsHome, name)).catch(() => {});
  }

  return buildSkillSnapshot(ctx.config);
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
  return resolveLegacyPaperclipDesiredSkillNames(config, availableEntries);
}
