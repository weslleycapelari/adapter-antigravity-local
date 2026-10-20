/**
 * @fileoverview Stream parser and error telemetry analysis helpers for Antigravity local CLI executions.
 * Parses streaming JSON events, extracts real-time token metrics, identifies rate limits,
 * authentication triggers, reset times, and handles session failure classifications.
 *
 * @copyright Antigravity Adapter Contributors
 * @license MIT
 */

import type { UsageSummary } from "@paperclipai/adapter-utils";
import { asNumber, asString, parseJson, parseObject } from "@paperclipai/adapter-utils/server-utils";
import type { AntigravityParseResult } from "../types.js";
import { parseMultilineLines } from "../utils.js";

/** Regex pattern identifying rate limits, quota limits, 429, or capacity exhaustions. */
const ANTIGRAVITY_RATE_LIMIT_RE =
  /(?:rate[-\s]?limit(?:ed)?|too\s+many\s+requests|\b429\b|quota\s+exceeded|usage\s+limit\s+reached|5[-\s]?hour\s+limit\s+reached|weekly\s+limit\s+reached|session\s+limit\s+(?:reached|exceeded)|out\s+of\s+quota|capacity\s+exceeded|resource_exhausted|billing details)/i;

/** Regex pattern identifying missing credentials, 401, or expired authentication tokens. */
const ANTIGRAVITY_AUTH_ERROR_RE =
  /(?:not\s+(?:logged\s+in|authenticated)|please\s+(?:log\s+in|authenticate)|login\s+required|requires\s+login|unauthorized|\b401\b|authentication\s+(?:failed|required)|invalid\s+(?:oauth\s+)?(?:token|credentials)|token\s+expired|refresh_token|api[_ ]?key\s+(?:required|missing|invalid)|run\s+`?agy\s+auth(?:\s+login)?`?\s+first)/i;

/** Regex pattern identifying unrecoverable or missing conversation sessions. */
const ANTIGRAVITY_UNRECOVERABLE_SESSION_RE =
  /(?:unknown\s+conversation|conversation(?:\s+.*?)?\s+not\s+found|invalid\s+conversation\s+id|session\s+corrupted|failed\s+to\s+resume|cannot\s+resume|resume(?:\s+.*?)?\s+not\s+found)/i;

/** Regex pattern extracting reset times or duration intervals from rate limit notices. */
const ANTIGRAVITY_RESET_TIME_RE =
  /(?:resets?\s+(?:at\s+|in\s+)?([^\n()]+?)(?:\s*\(([^)]+)\))?)(?:[.!]|\n|$)/i;

/**
 * Creates a stateful stream parser accumulator that processes Antigravity stream-json chunks.
 * Computes consolidated usage metrics combining delta step usages and final result payloads.
 *
 * @returns A parser function accepting stdout text and returning an AntigravityParseResult.
 */
export function createAntigravityStreamParser(): (stdout: string) => AntigravityParseResult {
  let sessionId: string | null = null;
  const assistantTexts: string[] = [];
  let finalResponse = "";
  let errorMessage: string | null = null;
  let status: "SUCCESS" | "ERROR" | "ACTIVE" | null = null;
  let resultEvent: Record<string, unknown> | null = null;
  let costUsd: number | null = null;
  let anonymousStepSeq = 0;
  const stepUsages = new Map<string, UsageSummary>();
  let finalUsage: UsageSummary | null = null;

  const computeUsage = (): UsageSummary => {
    let stepInput = 0;
    let stepOutput = 0;
    let stepCached = 0;
    for (const u of stepUsages.values()) {
      stepInput += u.inputTokens;
      stepOutput += u.outputTokens;
      stepCached += u.cachedInputTokens ?? 0;
    }
    if (finalUsage) {
      return {
        inputTokens: Math.max(finalUsage.inputTokens, stepInput),
        outputTokens: Math.max(finalUsage.outputTokens, stepOutput),
        cachedInputTokens: Math.max(finalUsage.cachedInputTokens ?? 0, stepCached),
      };
    }
    return {
      inputTokens: stepInput,
      outputTokens: stepOutput,
      cachedInputTokens: stepCached,
    };
  };

  return (stdout: string): AntigravityParseResult => {
    for (const rawLine of stdout.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;

      const event = parseJson(line);
      if (!event) continue;

      const eventType = asString(event.event, "").trim();

      // Init event: {"event":"init","conversation_id":"...","init":{...}}
      if (eventType === "init" || event.conversation_id) {
        const convId = asString(event.conversation_id, "").trim();
        if (convId) sessionId = convId;
      }

      // Step update event: {"event":"step_update","step_update":{...}}
      if (eventType === "step_update") {
        const step = parseObject(event.step_update);
        const convId = asString(step.conversation_id, "").trim();
        if (convId) sessionId = convId;

        const stepType = asString(step.step_type, "").trim();
        const stepState = asString(step.state, "").trim().toUpperCase();
        const delta = asString(step.text_delta, "");
        if (stepType === "agent_response") {
          if (delta) {
            assistantTexts.push(delta);
          } else {
            const staticText = asString(step.text, "");
            if (staticText) assistantTexts.push(staticText);
          }
        }

        const stepError = asString(step.error_message, "").trim();
        if ((stepState === "ERROR" || stepState === "FAILED") && stepError) {
          errorMessage = stepError;
        }

        const stepUsage = parseObject(step.usage);
        if (Object.keys(stepUsage).length > 0) {
          const stepKey =
            typeof step.step_index === "number" && Number.isFinite(step.step_index)
              ? `step_${step.step_index}`
              : `anon_${anonymousStepSeq++}`;
          const prev = stepUsages.get(stepKey);
          stepUsages.set(stepKey, {
            inputTokens: Math.max(prev?.inputTokens ?? 0, asNumber(stepUsage.input_tokens, 0)),
            outputTokens: Math.max(prev?.outputTokens ?? 0, asNumber(stepUsage.output_tokens, 0)),
            cachedInputTokens: Math.max(
              prev?.cachedInputTokens ?? 0,
              asNumber(stepUsage.cache_read_tokens, 0),
            ),
          });
        }
        continue;
      }

      // Result event: {"event":"result","result":{"status":"SUCCESS", "response":"...", "usage":{...}}}
      if (eventType === "result") {
        const res = parseObject(event.result);
        resultEvent = res;
        const convId = asString(res.conversation_id, "").trim();
        if (convId) sessionId = convId;

        const resStatus = asString(res.status, "").toUpperCase();
        if (resStatus === "SUCCESS" || resStatus === "ERROR") {
          status = resStatus as "SUCCESS" | "ERROR";
        } else if (resStatus === "FAILED") {
          status = "ERROR";
        }

        const resp = asString(res.response, "");
        if (resp) finalResponse = resp;

        const err = asString(res.error, "") || asString(res.message, "");
        if (err || status === "ERROR") {
          errorMessage = err || errorMessage || "Execution failed";
        }

        const rawCost = asNumber(res.cost_usd, asNumber(res.total_cost_usd, NaN));
        if (Number.isFinite(rawCost) && rawCost > 0) {
          costUsd = rawCost;
        }

        const resUsage = parseObject(res.usage);
        if (Object.keys(resUsage).length > 0) {
          finalUsage = {
            inputTokens: asNumber(resUsage.input_tokens, 0),
            outputTokens: asNumber(resUsage.output_tokens, 0),
            cachedInputTokens: asNumber(resUsage.cache_read_tokens, 0),
          };
        }
        continue;
      }

      // Error event: {"event":"error", ...}
      if (eventType === "error") {
        const errObj = parseObject(event.error);
        const msg = asString(errObj.message, "") || asString(event.message, "") || "Antigravity error";
        errorMessage = msg;
        status = "ERROR";
        continue;
      }
    }

    const summary = (finalResponse || assistantTexts.join("")).trim();

    return {
      sessionId,
      summary,
      usage: computeUsage(),
      costUsd,
      errorMessage,
      status,
      resultEvent,
    };
  };
}

/**
 * Parses full Antigravity stdout stream output into an AntigravityParseResult.
 *
 * @param stdout - Full stdout content captured from the process.
 * @returns Structured parse result including sessionId, summary, tokens, and errors.
 */
export function parseAntigravityStreamJson(stdout: string): AntigravityParseResult {
  return createAntigravityStreamParser()(stdout);
}

/**
 * Checks whether process output signals a rate limit, quota exhaustion, or 429 error.
 *
 * @param stdout - Output stdout string.
 * @param stderr - Output stderr string.
 * @returns True if rate limited.
 */
export function isAntigravityRateLimited(stdout: string, stderr: string): boolean {
  return ANTIGRAVITY_RATE_LIMIT_RE.test(`${stdout}\n${stderr}`);
}

/**
 * Probes output lines for missing login or invalid/expired credentials.
 * Supports both modern signature (stdout, stderr) returning boolean and legacy ({ stdout, stderr }) returning object.
 *
 * @param inputOrStdout - Object with stdout and stderr, or stdout string.
 * @param maybeStderr - Stderr string if first argument is stdout.
 * @returns Boolean or { requiresAuth: boolean } depending on input type.
 */
export function detectAntigravityAuthRequired(
  input: { stdout: string; stderr: string },
): { requiresAuth: boolean };
export function detectAntigravityAuthRequired(
  stdout: string,
  stderr: string,
): boolean;
export function detectAntigravityAuthRequired(
  inputOrStdout: string | { stdout: string; stderr: string },
  maybeStderr?: string,
): boolean | { requiresAuth: boolean } {
  if (typeof inputOrStdout === "object" && inputOrStdout !== null) {
    const combined = `${inputOrStdout.stdout}\n${inputOrStdout.stderr}`;
    return { requiresAuth: ANTIGRAVITY_AUTH_ERROR_RE.test(combined) };
  }
  const combined = `${inputOrStdout}\n${maybeStderr ?? ""}`;
  return ANTIGRAVITY_AUTH_ERROR_RE.test(combined);
}

/**
 * Checks if Antigravity output indicates an exhausted quota or rate limit.
 * Backwards compatibility helper for existing telemetry callers.
 *
 * @param input - Object containing stdout and stderr.
 * @returns Object indicating if quota is exhausted.
 */
export function detectAntigravityQuotaExhausted(input: {
  stdout: string;
  stderr: string;
}): { exhausted: boolean } {
  const exhausted = isAntigravityRateLimited(input.stdout, input.stderr);
  return { exhausted };
}

/**
 * Extracts a rate limit reset time string or interval, if present in the output.
 *
 * @param stdout - Output stdout string.
 * @param stderr - Output stderr string.
 * @returns Extracted reset time string or null.
 */
export function extractAntigravityResetTime(stdout: string, stderr: string): string | null {
  const match = `${stdout}\n${stderr}`.match(ANTIGRAVITY_RESET_TIME_RE);
  if (match && match[1]) {
    return match[1].trim();
  }
  return null;
}

/**
 * Checks whether an execution failed because the conversation session is unrecoverable,
 * unknown, not found, or corrupted, signaling that a fresh session retry is necessary.
 *
 * @param stdout - Output stdout string.
 * @param stderr - Output stderr string.
 * @returns True if session cannot be resumed.
 */
export function isAntigravitySessionUnrecoverable(stdout: string, stderr: string): boolean {
  const haystack = `${stdout}\n${stderr}`.toLowerCase();
  return (
    haystack.includes("conversation not found") ||
    haystack.includes("unknown conversation") ||
    haystack.includes("invalid conversation id") ||
    haystack.includes("session corrupted") ||
    haystack.includes("failed to resume") ||
    haystack.includes("cannot resume") ||
    ANTIGRAVITY_UNRECOVERABLE_SESSION_RE.test(haystack)
  );
}

/**
 * Legacy compatibility alias for checking unknown session errors.
 *
 * @param stdout - Process stdout stream content.
 * @param stderr - Process stderr stream content.
 * @returns True if unknown conversation error signature matched.
 */
export function isAntigravityUnknownSessionError(stdout: string, stderr: string): boolean {
  return isAntigravitySessionUnrecoverable(stdout, stderr);
}

/**
 * Detects if the run reached safety maximum turn thresholds.
 *
 * @param exitCode - Optional exit code returned by command.
 * @param stderr - Optional error output.
 * @returns True if turn limit was crossed.
 */
export function isAntigravityTurnLimitResult(
  exitCode?: number | null,
  stderr?: string,
): boolean {
  if (exitCode === 53) return true;
  if (stderr) {
    const lower = stderr.toLowerCase();
    if (lower.includes("turn_limit") || lower.includes("max_turns")) return true;
  }
  return false;
}

/**
 * Produces a clear, concise failure description from process results or stdout/stderr logs.
 * Supports both modern object format { exitCode, stderr, stdout } and legacy (stdout, stderr).
 *
 * @param procOrStdout - Process result object or stdout string.
 * @param maybeStderr - Stderr string if first argument is stdout.
 * @returns Concise failure description, or null if empty.
 */
export function describeAntigravityFailure(
  procOrStdout: { exitCode: number | null; stderr: string; stdout: string } | string,
  maybeStderr?: string,
): string | null {
  if (typeof procOrStdout === "string") {
    const lines = parseMultilineLines(`${maybeStderr ?? ""}\n${procOrStdout}`);
    if (lines.length === 0) return null;
    return `Antigravity run failed: ${lines[0]}`;
  }

  const stderrLine = procOrStdout.stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  if (stderrLine) return `Antigravity CLI failed: ${stderrLine}`;

  const parsed = parseAntigravityStreamJson(procOrStdout.stdout);
  if (parsed.errorMessage) return parsed.errorMessage;

  if (procOrStdout.exitCode !== null && procOrStdout.exitCode !== 0) {
    return `Antigravity CLI exited with code ${procOrStdout.exitCode}`;
  }

  return "Antigravity run completed without result";
}
