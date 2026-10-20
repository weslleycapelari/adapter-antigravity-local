/**
 * @fileoverview Core execution engine for Google Antigravity local CLI integrations.
 * Decomposes process spawning, multi-account routing, stream telemetry, token checkpoints,
 * tools/MCP tracking, rate-limit failovers, and autonomous error recovery into a robust pipeline.
 *
 * @copyright Antigravity Adapter Contributors
 * @license MIT
 */

import { createProviderStoppedBoundary } from "@paperclipai/adapter-utils/provider-stopped-boundary";
import { createUsageCheckpointLog } from "./usage-checkpoint.js";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import {
  asBoolean,
  asNumber,
  asString,
  asStringArray,
  buildPaperclipEnv,
  buildRuntimeToolsEnv,
  buildInvocationEnvForLogs,
  ensureAbsoluteDirectory,
  ensurePaperclipSkillSymlink,
  ensurePathInEnv,
  isPaperclipSkillSourceMissing,
  joinPromptSections,
  parseObject,
  readPaperclipIssueWorkModeFromContext,
  readPaperclipRuntimeSkillEntries,
  refreshPaperclipWorkspaceEnvForExecution,
  removeMaintainerOnlySkillSymlinks,
  renderTemplate,
  resolveLegacyPaperclipDesiredSkillNames,
  hydrateFreshSessionHandoff,
  selectPaperclipPromptSections,
  selectInitialCommunicationGuidance,
  isPaperclipRecoveryWakePayload,
  DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
  DEFAULT_PAPERCLIP_CONVERSATION_PROMPT_TEMPLATE,
} from "@paperclipai/adapter-utils/server-utils";
import {
  adapterExecutionTargetIsRemote,
  adapterExecutionTargetRemoteCwd,
  adapterExecutionTargetSessionIdentity,
  adapterExecutionTargetSessionMatches,
  overrideAdapterExecutionTargetRemoteCwd,
  runAdapterExecutionTargetProcess,
  resolveAdapterExecutionTargetCommandForLogs,
  resolveAdapterExecutionTargetTimeoutSec,
  readAdapterExecutionTarget,
} from "@paperclipai/adapter-utils/execution-target";
import { DEFAULT_ANTIGRAVITY_LOCAL_MODEL, resolveAntigravityModel } from "../index.js";
import {
  parseAntigravityStreamJson,
  createAntigravityStreamParser,
  isAntigravityRateLimited,
  detectAntigravityAuthRequired,
  extractAntigravityResetTime,
  isAntigravitySessionUnrecoverable,
  describeAntigravityFailure,
} from "./parse.js";
import {
  recordAntigravityRunUsage,
  setAntigravityCooldown,
  selectAntigravityExecutionPlan,
  classifyAntigravityModelFamily,
  isAgentLeadershipRole,
  readCompanyPoolRuntimeConfig,
  updateCompanyActivePoolAccount,
  prepareAntigravityAccountProfileHome,
  getAntigravityProfileHome,
  getAntigravityAccountCredentialsSync,
  type AntigravityExecutionCandidate,
} from "./quota.js";
import { resolveAntigravitySkillsHome } from "./skills.js";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ANTIGRAVITY_TERMINAL_RESULT_GRACE_MS = 1_000;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour default cooldown on 429

function hasNonEmptyEnvValue(env: Record<string, unknown>, key: string): boolean {
  const raw = env[key];
  return typeof raw === "string" && raw.trim().length > 0;
}

function buildHeadlessEnv(env: Record<string, string>): Record<string, string> {
  const next = { ...env };
  const term = env.TERM?.trim().toLowerCase();
  if (!term || term === "dumb" || term === "vt100") {
    next.TERM = "xterm-256color";
  }
  if (!next.COLORTERM?.trim()) {
    next.COLORTERM = "truecolor";
  }
  next.NO_BROWSER = "1";
  delete next.NO_COLOR;
  return next;
}

function buildAntigravityRuntimeEnv(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(ensurePathInEnv({ ...process.env, ...buildHeadlessEnv(env) })).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function renderPaperclipEnvNote(env: Record<string, string>): string {
  const paperclipKeys = Object.keys(env)
    .filter((key) => key.startsWith("PAPERCLIP_"))
    .sort();
  if (paperclipKeys.length === 0) return "";
  return [
    "Paperclip runtime note:",
    `The following PAPERCLIP_* environment variables are available in this run: ${paperclipKeys.join(", ")}`,
    "Do not assume these variables are missing without checking your shell environment.",
    "",
    "",
  ].join("\n");
}

function renderApiAccessNote(env: Record<string, string>): string {
  if (!hasNonEmptyEnvValue(env, "PAPERCLIP_API_URL") || !hasNonEmptyEnvValue(env, "PAPERCLIP_API_KEY")) return "";
  return [
    "Paperclip API access note:",
    "Use run_command with curl to make Paperclip API requests.",
    "GET example:",
    `  run_command({ CommandLine: "curl -s -H \\"Authorization: Bearer $PAPERCLIP_API_KEY\\" \\"$PAPERCLIP_API_URL/api/agents/me\\"" })`,
    "POST/PATCH example:",
    `  run_command({ CommandLine: "curl -s -X POST -H \\"Authorization: Bearer $PAPERCLIP_API_KEY\\" -H 'Content-Type: application/json' -H \\"X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID\\" -d '{...}' \\"$PAPERCLIP_API_URL/api/issues/$PAPERCLIP_TASK_ID/checkout\\"" })`,
    "When PAPERCLIP_TASK_ID is not set, substitute a real issue id from the current context; never send a placeholder like {id} in the URL.",
    "",
    "",
  ].join("\n");
}

async function ensureAntigravitySkillsInjected(
  onLog: AdapterExecutionContext["onLog"],
  skillsEntries: Array<{ key: string; runtimeName: string; source: string }>,
  desiredSkillNames?: string[],
  skillsHome = resolveAntigravitySkillsHome({}),
): Promise<void> {
  const desiredSet = new Set(desiredSkillNames ?? skillsEntries.map((entry) => entry.key));
  const selectedEntries = skillsEntries.filter((entry) => desiredSet.has(entry.key));
  if (selectedEntries.length === 0) return;

  try {
    await fs.mkdir(skillsHome, { recursive: true });
  } catch (err) {
    await onLog(
      "stderr",
      `[paperclip] Failed to prepare Antigravity skills directory ${skillsHome}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return;
  }

  const removedSkills = await removeMaintainerOnlySkillSymlinks(
    skillsHome,
    selectedEntries.map((entry) => entry.runtimeName),
  );
  for (const skillName of removedSkills) {
    await onLog(
      "stderr",
      `[paperclip] Removed maintainer-only Antigravity skill "${skillName}" from ${skillsHome}\n`,
    );
  }

  const linkSkill = async (src: string, tgt: string) => {
    try {
      await fs.symlink(src, tgt, process.platform === "win32" ? "junction" : "dir");
    } catch {
      await fs.symlink(src, tgt);
    }
  };

  for (const entry of selectedEntries) {
    const target = path.join(skillsHome, entry.runtimeName);
    try {
      const result = await ensurePaperclipSkillSymlink(entry.source, target, linkSkill);
      if (result === "skipped") continue;
      await onLog(
        "stderr",
        `[paperclip] ${result === "repaired" ? "Repaired" : "Linked"} Antigravity skill: ${entry.key}\n`,
      );
    } catch (err) {
      await onLog(
        "stderr",
        `[paperclip] Failed to link Antigravity skill "${entry.key}": ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
}

/**
 * Core execution engine function for Google Antigravity local CLI integrations.
 * Supports streaming telemetries, account pooling, token checkpoints, tools, and error recoveries.
 *
 * @param ctx - The unified adapter execution context.
 * @returns A promise resolving to the final adapter execution output structure.
 */
export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const {
    runId,
    agent,
    runtime,
    context,
    onLog,
    onMeta,
    onSpawn,
    authToken,
  } = ctx;

  const config = parseObject(ctx.config);
  const providerStop = createProviderStoppedBoundary(ctx.onProviderStopped);
  const executionTarget = readAdapterExecutionTarget({
    executionTarget: ctx.executionTarget,
    legacyRemoteExecution: ctx.executionTransport?.remoteExecution,
  });
  const executionTargetIsRemote = adapterExecutionTargetIsRemote(executionTarget);

  const command = asString(config.command, "agy").trim() || "agy";
  const envConfig = parseObject(config.env);
  const model = resolveAntigravityModel(config.model, {
    ...(process.env as Record<string, unknown>),
    ...envConfig,
  });
  const effort = asString(config.effort, "").trim();
  const dangerouslySkipPermissions = asBoolean(config.dangerouslySkipPermissions, true);
  const explicitAccountProfile = asString(config.accountProfile, "").trim();

  const timeoutSec = resolveAdapterExecutionTargetTimeoutSec(
    executionTarget,
    asNumber(config.timeoutSec, 0),
  );
  const graceSec = asNumber(config.graceSec, 15);
  const terminalResultCleanupGraceMs = Math.max(
    0,
    asNumber(config.terminalResultCleanupGraceMs, DEFAULT_ANTIGRAVITY_TERMINAL_RESULT_GRACE_MS),
  );

  const workspaceContext = parseObject(context.paperclipWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, "");
  const workspaceSource = asString(workspaceContext.source, "");
  const workspaceId = asString(workspaceContext.workspaceId, "");
  const workspaceRepoUrl = asString(workspaceContext.repoUrl, "");
  const workspaceRepoRef = asString(workspaceContext.repoRef, "");
  const agentHome = asString(workspaceContext.agentHome, "");
  const workspaceHints = Array.isArray(context.paperclipWorkspaces)
    ? context.paperclipWorkspaces.filter(
        (value): value is Record<string, unknown> => typeof value === "object" && value !== null,
      )
    : [];
  const configuredCwd = asString(config.cwd, "").trim();
  const useConfiguredInsteadOfAgentHome = workspaceSource === "agent_home" && configuredCwd.length > 0;
  const effectiveWorkspaceCwd = useConfiguredInsteadOfAgentHome ? "" : workspaceCwd;
  const cwd = path.resolve(effectiveWorkspaceCwd || configuredCwd || process.cwd());
  const effectiveExecutionCwd = adapterExecutionTargetRemoteCwd(executionTarget, cwd);
  const runtimeExecutionTarget = overrideAdapterExecutionTargetRemoteCwd(executionTarget, effectiveExecutionCwd);
  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });

  const antigravitySkillEntries = await readPaperclipRuntimeSkillEntries(config, __moduleDir);
  const desiredAntigravitySkillNames = resolveLegacyPaperclipDesiredSkillNames(
    config,
    antigravitySkillEntries,
  );

  const baseEnv: Record<string, string> = {
    ...buildPaperclipEnv(agent),
    ...buildRuntimeToolsEnv(ctx.runtimeTools),
  };
  baseEnv.PAPERCLIP_RUN_ID = runId;

  const wakeTaskId =
    (typeof context.taskId === "string" && context.taskId.trim().length > 0 && context.taskId.trim()) ||
    (typeof context.issueId === "string" && context.issueId.trim().length > 0 && context.issueId.trim()) ||
    null;
  const wakeReason =
    typeof context.wakeReason === "string" && context.wakeReason.trim().length > 0
      ? context.wakeReason.trim()
      : null;
  const wakeCommentId =
    (typeof context.wakeCommentId === "string" && context.wakeCommentId.trim().length > 0 && context.wakeCommentId.trim()) ||
    (typeof context.commentId === "string" && context.commentId.trim().length > 0 && context.commentId.trim()) ||
    null;
  const approvalId =
    typeof context.approvalId === "string" && context.approvalId.trim().length > 0
      ? context.approvalId.trim()
      : null;
  const approvalStatus =
    typeof context.approvalStatus === "string" && context.approvalStatus.trim().length > 0
      ? context.approvalStatus.trim()
      : null;
  const linkedIssueIds = Array.isArray(context.issueIds)
    ? context.issueIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  const issueWorkMode = readPaperclipIssueWorkModeFromContext(context);
  if (wakeTaskId) baseEnv.PAPERCLIP_TASK_ID = wakeTaskId;
  if (issueWorkMode) baseEnv.PAPERCLIP_ISSUE_WORK_MODE = issueWorkMode;
  if (wakeReason) baseEnv.PAPERCLIP_WAKE_REASON = wakeReason;
  if (wakeCommentId) baseEnv.PAPERCLIP_WAKE_COMMENT_ID = wakeCommentId;
  if (approvalId) baseEnv.PAPERCLIP_APPROVAL_ID = approvalId;
  if (approvalStatus) baseEnv.PAPERCLIP_APPROVAL_STATUS = approvalStatus;
  if (linkedIssueIds.length > 0) baseEnv.PAPERCLIP_LINKED_ISSUE_IDS = linkedIssueIds.join(",");

  refreshPaperclipWorkspaceEnvForExecution({
    env: baseEnv,
    envConfig,
    workspaceCwd: effectiveWorkspaceCwd,
    workspaceSource,
    workspaceId,
    workspaceRepoUrl,
    workspaceRepoRef,
    workspaceHints,
    agentHome,
    executionTargetIsRemote,
    executionCwd: effectiveExecutionCwd,
  });

  if (authToken) {
    baseEnv.PAPERCLIP_API_KEY = authToken;
  }

  // Resolve account pool routing & model-family rotation
  const isTestCapture = hasNonEmptyEnvValue(envConfig, "PAPERCLIP_TEST_CAPTURE_PATH");
  const companyPoolConfig = await readCompanyPoolRuntimeConfig(agent.companyId);
  const poolEnabled =
    Boolean(explicitAccountProfile) ||
    Boolean(companyPoolConfig) ||
    (!isTestCapture && getAntigravityAccountCredentialsSync("account-1").isConnected);

  const routingMode: "leadership" | "worker" = isAgentLeadershipRole(
    agent,
    config,
    companyPoolConfig?.managementRoles,
  )
    ? "leadership"
    : "worker";

  let candidatePlan: AntigravityExecutionCandidate[] = [
    {
      accountKey: "default",
      model,
      family: classifyAntigravityModelFamily(model),
      usagePct: 0,
      weeklyUsagePct: 0,
    },
  ];
  let autoRotateOnRateLimit = asBoolean(
    config.autoRotateOnRateLimit,
    companyPoolConfig?.autoRotateOnRateLimit ?? true,
  );

  if (poolEnabled) {
    const poolKeys =
      companyPoolConfig?.workerAccountPool && companyPoolConfig.workerAccountPool.length > 0
        ? companyPoolConfig.workerAccountPool.map((m) => m.key)
        : ["account-1", "account-2", "account-3"];
    const thresholdPct = companyPoolConfig?.rotationThresholdPct ?? 85;
    const manualActive =
      explicitAccountProfile && explicitAccountProfile !== "auto"
        ? explicitAccountProfile
        : companyPoolConfig?.manualActiveAccount ?? null;

    const effectiveRequestedModel =
      isTestCapture && !companyPoolConfig && (!config.model || config.model === DEFAULT_ANTIGRAVITY_LOCAL_MODEL)
        ? DEFAULT_ANTIGRAVITY_LOCAL_MODEL
        : model;

    const plan = await selectAntigravityExecutionPlan(poolKeys, thresholdPct, {
      routingMode,
      manualActiveAccount: manualActive,
      requestedModel: effectiveRequestedModel,
      skipLiveProbe: isTestCapture,
    });

    const resolvedCandidates =
      isTestCapture && !companyPoolConfig && (!config.model || config.model === DEFAULT_ANTIGRAVITY_LOCAL_MODEL)
        ? plan.candidates.map((c) => ({ ...c, model: DEFAULT_ANTIGRAVITY_LOCAL_MODEL }))
        : plan.candidates;

    if (
      explicitAccountProfile &&
      explicitAccountProfile !== "auto" &&
      !resolvedCandidates.some((c) => c.accountKey === explicitAccountProfile)
    ) {
      const firstModel = resolvedCandidates[0]?.model ?? model;
      candidatePlan = [
        {
          accountKey: explicitAccountProfile,
          model: firstModel,
          family: classifyAntigravityModelFamily(firstModel),
          usagePct: 0,
          weeklyUsagePct: 0,
        },
        ...resolvedCandidates,
      ];
    } else if (resolvedCandidates.length > 0) {
      candidatePlan = resolvedCandidates;
    }

    const primaryCandidate = candidatePlan[0]!;
    if (plan.wasAutoRotated && companyPoolConfig) {
      await updateCompanyActivePoolAccount(agent.companyId, primaryCandidate.accountKey, true);
      await onLog(
        "stderr",
        `[paperclip] Pool Antigravity (${routingMode === "leadership" ? "Liderança / Gemini 4 Argon" : "Worker"}) selecionou "${primaryCandidate.accountKey}" com modelo "${primaryCandidate.model}" (${plan.status}).\n`,
      );
    } else if (companyPoolConfig && companyPoolConfig.lastActiveAccount !== primaryCandidate.accountKey) {
      await updateCompanyActivePoolAccount(agent.companyId, primaryCandidate.accountKey, false);
    }
  }

  const extraArgs = (() => {
    const fromExtraArgs = asStringArray(config.extraArgs);
    if (fromExtraArgs.length > 0) return fromExtraArgs;
    return asStringArray(config.args);
  })();
  const promptTemplate = asString(
    config.promptTemplate,
    context.conversationMode === true
      ? DEFAULT_PAPERCLIP_CONVERSATION_PROMPT_TEMPLATE
      : DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
  );
  const bootstrapPromptTemplate = asString(config.bootstrapPromptTemplate, "");

  let instructionsPrefix = "";
  const instructionsFilePath = asString(config.instructionsFilePath, "").trim();
  const instructionsDir = instructionsFilePath ? `${path.dirname(instructionsFilePath)}/` : "";
  if (instructionsFilePath) {
    try {
      const content = await fs.readFile(instructionsFilePath, "utf8");
      if (content.trim()) {
        instructionsPrefix =
          `${content.trim()}\n\n` +
          `The above agent instructions were loaded from ${instructionsFilePath}. ` +
          `Resolve any relative file references from ${instructionsDir}.\n\n`;
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await onLog("stdout", `[paperclip] Warning: could not read instructions file "${instructionsFilePath}": ${reason}\n`);
    }
  }

  const runtimeSessionParams = parseObject(runtime?.sessionParams);
  const runtimeSessionId = asString(runtimeSessionParams.sessionId, runtime?.sessionId ?? "");
  const runtimeSessionCwd = asString(runtimeSessionParams.cwd, "");
  const runtimeSessionAccount = asString(runtimeSessionParams.accountProfile, "");
  const runtimeRemoteExecution = parseObject(runtimeSessionParams.remoteExecution);
  const canResumeSessionBase =
    runtimeSessionId.length > 0 &&
    (runtimeSessionCwd.length === 0 || path.resolve(runtimeSessionCwd) === path.resolve(effectiveExecutionCwd)) &&
    adapterExecutionTargetSessionMatches(runtimeRemoteExecution, runtimeExecutionTarget);
  if (runtimeSessionId && !canResumeSessionBase) {
    await onLog(
      "stdout",
      `[paperclip] Antigravity session "${runtimeSessionId}" was saved for cwd "${runtimeSessionCwd}" and will not be resumed in "${effectiveExecutionCwd}".\n`,
    );
  }

  const templateData = {
    agentId: agent.id,
    companyId: agent.companyId,
    runId,
    company: { id: agent.companyId },
    agent,
    run: { id: runId, source: "on_demand" },
    context,
  };

  const buildPrompt = (resumedSession: boolean, currentEnv: Record<string, string>) => {
    const renderedBootstrapPrompt =
      !resumedSession && bootstrapPromptTemplate.trim().length > 0
        ? renderTemplate(bootstrapPromptTemplate, templateData).trim()
        : "";
    const { taskContextNote, wakePrompt } = selectPaperclipPromptSections(context, {
      resumedSession,
      includeCommunicationGuidance: false,
    });
    const shouldUseResumeDeltaPrompt = resumedSession && wakePrompt.length > 0;
    const renderedPrompt =
      shouldUseResumeDeltaPrompt || isPaperclipRecoveryWakePayload(context.paperclipWake)
        ? ""
        : renderTemplate(promptTemplate, templateData);
    const sessionHandoffNote = asString(context.paperclipSessionHandoffMarkdown, "").trim();
    const paperclipEnvNote = renderPaperclipEnvNote(currentEnv);
    const apiAccessNote = renderApiAccessNote(currentEnv);

    const basePrompt = joinPromptSections([
      instructionsPrefix,
      renderedBootstrapPrompt,
      wakePrompt,
      taskContextNote,
      sessionHandoffNote,
      paperclipEnvNote,
      apiAccessNote,
      renderedPrompt,
    ]);

    return {
      basePrompt,
      promptMetrics: {
        promptChars: basePrompt.length,
        instructionsChars: instructionsPrefix.length,
        bootstrapPromptChars: renderedBootstrapPrompt.length,
        wakePromptChars: wakePrompt.length,
        taskContextChars: taskContextNote.length,
        sessionHandoffChars: sessionHandoffNote.length,
        runtimeNoteChars: paperclipEnvNote.length + apiAccessNote.length,
        heartbeatPromptChars: renderedPrompt.length,
      },
    };
  };

  const buildArgs = (resumeSessionId: string | null, prompt: string, effectiveModel: string) => {
    const args = ["-p", prompt, "--output-format", "stream-json"];
    if (dangerouslySkipPermissions) {
      args.push("--dangerously-skip-permissions");
    }
    if (resumeSessionId) {
      args.push("--conversation", resumeSessionId);
    }
    if (effectiveModel && effectiveModel !== DEFAULT_ANTIGRAVITY_LOCAL_MODEL) {
      args.push("--model", effectiveModel);
    }
    if (effort) {
      args.push("--effort", effort);
    }
    if (extraArgs.length > 0) {
      args.push(...extraArgs);
    }
    return args;
  };

  const runAttempt = async (candidate: AntigravityExecutionCandidate, resumeSessionId: string | null) => {
    const { accountKey, model: candidateModel } = candidate;
    const attemptEnv: Record<string, string> = { ...baseEnv };
    if (accountKey && accountKey !== "default") {
      try {
        const profileHome = await prepareAntigravityAccountProfileHome(accountKey, cwd);
        attemptEnv.HOME = profileHome;
        attemptEnv.PAPERCLIP_ANTIGRAVITY_ACCOUNT = accountKey;
      } catch {
        // Keep default HOME if preparation fails
      }
    }

    if (!executionTargetIsRemote) {
      await ensureAntigravitySkillsInjected(
        onLog,
        antigravitySkillEntries.filter((entry) => !isPaperclipSkillSourceMissing(entry)),
        desiredAntigravitySkillNames,
        resolveAntigravitySkillsHome(config, accountKey !== "default" ? accountKey : null),
      );
    }

    const invocationEnv = buildHeadlessEnv(attemptEnv);
    const invocationRuntimeEnv = buildAntigravityRuntimeEnv(attemptEnv);
    const resolvedCommand = await resolveAdapterExecutionTargetCommandForLogs(
      command,
      runtimeExecutionTarget,
      cwd,
      invocationRuntimeEnv,
    );

    await hydrateFreshSessionHandoff(ctx, { resumedSession: Boolean(resumeSessionId) });
    const { basePrompt, promptMetrics } = buildPrompt(Boolean(resumeSessionId), attemptEnv);
    const prompt = joinPromptSections([
      selectInitialCommunicationGuidance(context, { resumedSession: Boolean(resumeSessionId) }),
      basePrompt,
    ]);

    const args = buildArgs(resumeSessionId, prompt, candidateModel);

    if (onMeta) {
      await onMeta({
        adapterType: "antigravity_local",
        command: resolvedCommand,
        cwd: effectiveExecutionCwd,
        commandNotes: [
          "Prompt is passed via agy -p with --output-format stream-json.",
          accountKey !== "default"
            ? `Active Antigravity pool account: ${accountKey} (${routingMode === "leadership" ? "Liderança / Gemini 4 Argon" : "Worker"}, model: ${candidateModel}).`
            : "",
          dangerouslySkipPermissions ? "Tool approval auto-granted via --dangerously-skip-permissions." : "",
          resumeSessionId ? `Resuming conversation ${resumeSessionId}.` : "Starting fresh conversation.",
          instructionsFilePath && instructionsPrefix
            ? `Loaded agent instructions from ${instructionsFilePath} (relative references from ${instructionsDir}).`
            : "",
        ].filter(Boolean),
        commandArgs: args.map((v) => (v === prompt ? `<prompt ${prompt.length} chars>` : v)),
        env: buildInvocationEnvForLogs(invocationEnv, {
          runtimeEnv: invocationRuntimeEnv,
          includeRuntimeKeys: ["HOME", "PAPERCLIP_ANTIGRAVITY_ACCOUNT"],
          resolvedCommand,
        }),
        prompt,
        promptMetrics: { ...promptMetrics, promptChars: prompt.length },
        context,
      });
    }

    const consumeAccounting = createAntigravityStreamParser();
    const accountingLog = createUsageCheckpointLog(
      onLog,
      (ctx as { onUsage?: (checkpoint: unknown) => Promise<void> | void }).onUsage,
      (stdout) => {
      const parsed = consumeAccounting(stdout);
      return {
        usage: parsed.usage,
        costUsd: parsed.costUsd,
        usageBasis: "per_run",
        provider: "antigravity",
        biller: "google",
        billingType: "subscription",
        model: candidateModel,
        complete: parsed.status !== null,
      };
    });

    const proc = await runAdapterExecutionTargetProcess(runId, runtimeExecutionTarget, command, args, {
      onProcessStopped: providerStop.beginInvocation(),
      cwd,
      env: invocationRuntimeEnv,
      timeoutSec,
      graceSec,
      onSpawn,
      onRuntimeProgress: ctx.onRuntimeProgress,
      onLog: accountingLog,
      terminalResultCleanup: {
        graceMs: terminalResultCleanupGraceMs,
        hasTerminalResult: ({ stdout }) => parseAntigravityStreamJson(stdout).status !== null,
      },
    });
    await accountingLog.flush();

    return {
      proc,
      parsed: parseAntigravityStreamJson(proc.stdout),
      accountKey,
      model: candidateModel,
      family: candidate.family,
    };
  };

  const canAccountResumeConversation = async (accountKey: string, sessionId: string | null): Promise<boolean> => {
    if (!sessionId || !canResumeSessionBase) return false;
    if (accountKey === "default") return true;

    if (runtimeSessionAccount && runtimeSessionAccount !== accountKey) {
      await onLog(
        "stdout",
        `[paperclip] Antigravity session "${sessionId}" belonged to "${runtimeSessionAccount}"; starting fresh session on "${accountKey}" with handoff.\n`,
      );
      return false;
    }

    const profileHome = getAntigravityProfileHome(accountKey);
    const brainRoot = path.join(profileHome, ".gemini", "antigravity-cli", "brain");
    if (!isTestCapture && fsSync.existsSync(brainRoot)) {
      const convDir = path.join(brainRoot, sessionId);
      if (!fsSync.existsSync(convDir)) {
        await onLog(
          "stdout",
          `[paperclip] Conversation "${sessionId}" not found in "${accountKey}" brain; starting fresh session with handoff.\n`,
        );
        return false;
      }
    }

    return true;
  };

  try {
    let activeCandidateIndex = 0;
    let currentCandidate = candidatePlan[0]!;
    const canResumeInitial = await canAccountResumeConversation(
      currentCandidate.accountKey,
      canResumeSessionBase ? runtimeSessionId : null,
    );
    let initialResumeId = canResumeInitial ? runtimeSessionId : null;

    let attempt = await runAttempt(currentCandidate, initialResumeId);
    let didRetryFresh = false;

    if (
      initialResumeId &&
      !attempt.proc.timedOut &&
      isAntigravitySessionUnrecoverable(attempt.proc.stdout, attempt.proc.stderr)
    ) {
      await onLog(
        "stderr",
        `[paperclip] Conversation "${initialResumeId}" not found or expired; retrying with fresh session.\n`,
      );
      didRetryFresh = true;
      initialResumeId = null;
      attempt = await runAttempt(currentCandidate, null);
    }

    recordAntigravityRunUsage(
      currentCandidate.accountKey,
      attempt.parsed.usage,
      attempt.proc.exitCode === 0,
      currentCandidate.model,
    );

    while (
      !attempt.proc.timedOut &&
      (isAntigravityRateLimited(attempt.proc.stdout, attempt.proc.stderr) ||
        detectAntigravityAuthRequired(attempt.proc.stdout, attempt.proc.stderr))
    ) {
      const hitRateLimit = isAntigravityRateLimited(attempt.proc.stdout, attempt.proc.stderr);
      const resetTimeStr = hitRateLimit
        ? extractAntigravityResetTime(attempt.proc.stdout, attempt.proc.stderr)
        : null;
      const parsedResetMs = resetTimeStr ? Date.parse(resetTimeStr) : NaN;
      const cooldownUntilMs =
        Number.isFinite(parsedResetMs) && parsedResetMs > Date.now()
          ? parsedResetMs
          : Date.now() + DEFAULT_RATE_LIMIT_COOLDOWN_MS;

      if (hitRateLimit) {
        setAntigravityCooldown(
          currentCandidate.accountKey,
          cooldownUntilMs,
          `Rate limit (429 / Cota esgotada) em ${currentCandidate.model}`,
          currentCandidate.family,
        );
      } else {
        setAntigravityCooldown(
          currentCandidate.accountKey,
          cooldownUntilMs,
          "Falha de autenticação detectada em execução",
        );
      }

      if (!autoRotateOnRateLimit || activeCandidateIndex + 1 >= candidatePlan.length) {
        break;
      }

      activeCandidateIndex++;
      if (!hitRateLimit) {
        while (
          activeCandidateIndex < candidatePlan.length &&
          candidatePlan[activeCandidateIndex]!.accountKey === currentCandidate.accountKey
        ) {
          activeCandidateIndex++;
        }
        if (activeCandidateIndex >= candidatePlan.length) {
          break;
        }
      }

      const nextCandidate = candidatePlan[activeCandidateIndex]!;
      await onLog(
        "stderr",
        `[paperclip] "${currentCandidate.accountKey}" (${currentCandidate.model}) atingiu limite/erro; rotacionando automaticamente para "${nextCandidate.accountKey}" (${nextCandidate.model}) e repetindo execução...\n`,
      );
      if (nextCandidate.accountKey !== currentCandidate.accountKey) {
        await updateCompanyActivePoolAccount(agent.companyId, nextCandidate.accountKey, true);
      }

      currentCandidate = nextCandidate;
      didRetryFresh = true;
      initialResumeId = null;
      attempt = await runAttempt(currentCandidate, null);
      recordAntigravityRunUsage(
        currentCandidate.accountKey,
        attempt.parsed.usage,
        attempt.proc.exitCode === 0,
        currentCandidate.model,
      );
    }

    const rateLimited = isAntigravityRateLimited(attempt.proc.stdout, attempt.proc.stderr);
    const authRequired = detectAntigravityAuthRequired(attempt.proc.stdout, attempt.proc.stderr);
    const resetTime = rateLimited ? extractAntigravityResetTime(attempt.proc.stdout, attempt.proc.stderr) : null;
    const errorMeta = resetTime ? { resetTime } : undefined;
    const resolvedSessionId = attempt.parsed.sessionId ?? (didRetryFresh ? null : initialResumeId);
    const resolvedSessionParams = resolvedSessionId
      ? ({
          sessionId: resolvedSessionId,
          cwd: effectiveExecutionCwd,
          ...(currentCandidate.accountKey !== "default" ? { accountProfile: currentCandidate.accountKey } : {}),
          ...(workspaceId ? { workspaceId } : {}),
          ...(workspaceRepoUrl ? { repoUrl: workspaceRepoUrl } : {}),
          ...(workspaceRepoRef ? { repoRef: workspaceRepoRef } : {}),
          ...(executionTargetIsRemote
            ? {
                remoteExecution: adapterExecutionTargetSessionIdentity(runtimeExecutionTarget),
              }
            : {}),
        } as Record<string, unknown>)
      : null;

    if (attempt.proc.timedOut) {
      return {
        exitCode: attempt.proc.exitCode,
        signal: attempt.proc.signal,
        timedOut: true,
        usageBasis: "per_run",
        usage: attempt.parsed.usage,
        provider: "antigravity",
        biller: "google",
        model: attempt.model,
        billingType: "subscription",
        errorMessage: `Timed out after ${timeoutSec}s`,
        errorCode: rateLimited ? "rate_limited" : authRequired ? "authentication_required" : "timeout",
        errorMeta,
        sessionId: resolvedSessionId,
        sessionParams: resolvedSessionParams,
        sessionDisplayId: resolvedSessionId,
        clearSession: Boolean(didRetryFresh && !resolvedSessionId),
      };
    }

    const success = attempt.proc.exitCode === 0 && attempt.parsed.status !== "ERROR";
    const errorMessage = success ? undefined : describeAntigravityFailure(attempt.proc);
    const resultJson: Record<string, unknown> = {
      ...(attempt.parsed.resultEvent ?? {
        stdout: attempt.proc.stdout,
        stderr: attempt.proc.stderr,
      }),
    };

    return {
      exitCode: attempt.proc.exitCode,
      signal: attempt.proc.signal,
      timedOut: false,
      usageBasis: "per_run",
      summary: attempt.parsed.summary,
      usage: attempt.parsed.usage,
      provider: "antigravity",
      biller: "google",
      model: attempt.model,
      billingType: "subscription",
      costUsd: attempt.parsed.costUsd ?? undefined,
      errorMessage: errorMessage ?? undefined,
      errorCode: rateLimited ? "rate_limited" : authRequired ? "authentication_required" : undefined,
      errorMeta,
      sessionId: resolvedSessionId,
      sessionParams: resolvedSessionParams,
      sessionDisplayId: resolvedSessionId,
      resultJson,
      clearSession: Boolean(didRetryFresh && !resolvedSessionId),
    };
  } finally {
    await providerStop.collectBeforeRestore();
  }
}
