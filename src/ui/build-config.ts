/**
 * @fileoverview Configuration builder mapping Web UI settings into strongly-typed Antigravity configs.
 * Parses raw text-based envs, process variables bindings, reasoning effort, tool permissions, and model preferences.
 *
 * @copyright Antigravity Adapter Contributors
 * @license MIT
 */

import { buildAdapterEnvConfig, type CreateConfigValues } from "@paperclipai/adapter-utils";
import { DEFAULT_ANTIGRAVITY_LOCAL_MODEL } from "../constants.js";
import type { AntigravityAdapterConfig, AntigravityRawConfigValues } from "../types.js";
import { parseCommaArgs } from "../utils.js";

/**
 * Parses a JSON string safely into a generic object, returning null on syntax errors.
 */
function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Builds the strongly-typed Antigravity local config structure from Web UI values.
 * Applies model fallbacks, sandboxing bypass, extra args parsing, effort selection, and merges environment bindings.
 *
 * @param v - Raw configuration values captured by Paperclip's Web UI.
 * @returns A validated, fully-typed Antigravity configuration structure.
 */
export function buildAntigravityLocalConfig(
  v: CreateConfigValues & Partial<AntigravityRawConfigValues>,
): AntigravityAdapterConfig {
  const ac: AntigravityAdapterConfig = {
    model: v.model || DEFAULT_ANTIGRAVITY_LOCAL_MODEL,
    timeoutSec: typeof v.timeoutSec === "number" ? v.timeoutSec : 0,
    graceSec: 15,
    dangerouslySkipPermissions:
      typeof v.dangerouslySkipPermissions === "boolean" ? v.dangerouslySkipPermissions : true,
  };

  if (v.cwd) ac.cwd = v.cwd;
  if (v.instructionsFilePath) ac.instructionsFilePath = v.instructionsFilePath;
  if (v.promptTemplate) ac.promptTemplate = v.promptTemplate;
  if (v.bootstrapPromptTemplate) ac.bootstrapPromptTemplate = v.bootstrapPromptTemplate;

  const effortValue = v.effort || v.thinkingEffort;
  if (effortValue && typeof effortValue === "string") {
    ac.effort = effortValue.trim();
  }

  if (v.accountProfile && typeof v.accountProfile === "string") {
    ac.accountProfile = v.accountProfile.trim();
  }

  const env = buildAdapterEnvConfig(v.envBindings, v.envVars);
  if (Object.keys(env).length > 0) {
    ac.env = env as any;
  }

  if (v.workspaceStrategyType === "git_worktree") {
    ac.workspaceStrategy = {
      type: "git_worktree",
      ...(v.workspaceBaseRef ? { baseRef: v.workspaceBaseRef } : {}),
      ...(v.workspaceBranchTemplate ? { branchTemplate: v.workspaceBranchTemplate } : {}),
      ...(v.worktreeParentDir ? { worktreeParentDir: v.worktreeParentDir } : {}),
    };
  }

  const runtimeServices = parseJsonObject(v.runtimeServicesJson ?? "");
  if (runtimeServices && Array.isArray(runtimeServices.services)) {
    ac.workspaceRuntime = runtimeServices;
  }

  ac.sandbox = !v.dangerouslyBypassSandbox;

  if (v.command) {
    ac.command = v.command;
  }
  if (v.extraArgs) {
    ac.extraArgs = parseCommaArgs(v.extraArgs);
  }

  return ac;
}
