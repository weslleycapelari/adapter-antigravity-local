/**
 * @fileoverview Log parsers and telemetry analysis helpers for the Antigravity local CLI execution.
 * Extracts specific execution failures, rate limits, session statuses, and authentication triggers from stdout/stderr.
 * 
 * @copyright Antigravity Adapter Contributors
 * @license MIT
 */

import { parseMultilineLines } from "../utils.js";

/**
 * Combines and normalizes stdout and stderr into a single list of trimmed, non-empty lines.
 * Reusable utility to avoid duplicate output merging logic.
 *
 * @param stdout - The stdout string output.
 * @param stderr - The stderr string output.
 * @returns An array of sanitized message lines.
 */
function combineAndCleanLines(stdout: string, stderr: string): string[] {
  return parseMultilineLines(`${stdout}\n${stderr}`);
}

/** Regex pattern to identify CLI authentication failures or key missing errors. */
const AGY_AUTH_REQUIRED_RE = /(?:not\s+authenticated|please\s+authenticate|api[_ ]?key\s+(?:required|missing|invalid)|authentication\s+required|unauthorized|invalid\s+credentials|not\s+logged\s+in|login\s+required|run\s+`?agy\s+auth(?:\s+login)?`?\s+first)/i;

/** Regex pattern to identify API quota exhaustions, billing issues, or rate limits. */
const AGY_QUOTA_EXHAUSTED_RE = /(?:resource_exhausted|quota|rate[-\s]?limit|too many requests|\b429\b|billing details)/i;

/**
 * Checks whether the CLI process execution failed because the requested conversation
 * session was unknown, deleted, or otherwise not found.
 *
 * @param stdout - The process stdout stream content.
 * @param stderr - The process stderr stream content.
 * @returns True if an unknown session error signature is matched.
 */
export function isAntigravityUnknownSessionError(stdout: string, stderr: string): boolean {
  const haystack = combineAndCleanLines(stdout, stderr).join("\n");

  return /unknown\s+conversation|conversation\s+.*\s+not\s+found|resume\s+.*\s+not\s+found|cannot\s+resume|failed\s+to\s+resume/i.test(
    haystack,
  );
}

/**
 * Probes stdout/stderr output lines for missing authentication configurations.
 * Allows the orchestrator to automatically flag required interactive auth.
 *
 * @param input - Object containing stdout and stderr streams.
 * @returns Object indicating if authentication is required.
 */
export function detectAntigravityAuthRequired(input: {
  stdout: string;
  stderr: string;
}): { requiresAuth: boolean } {
  const messages = combineAndCleanLines(input.stdout, input.stderr);
  const requiresAuth = messages.some((line) => AGY_AUTH_REQUIRED_RE.test(line));
  return { requiresAuth };
}

/**
 * Checks if the Antigravity execution failed because of billing quotas, 
 * rate-limits (HTTP 429), or API resource limit exhaustion.
 *
 * @param input - Object containing stdout and stderr streams.
 * @returns Object indicating if quota is exhausted.
 */
export function detectAntigravityQuotaExhausted(input: {
  stdout: string;
  stderr: string;
}): { exhausted: boolean } {
  const messages = combineAndCleanLines(input.stdout, input.stderr);
  const exhausted = messages.some((line) => AGY_QUOTA_EXHAUSTED_RE.test(line));
  return { exhausted };
}

/**
 * Detects if the run hit the safety maximum agent turn thresholds.
 * Evaluates the exit code (typically code 53) or searches stderr logs.
 *
 * @param exitCode - Optional exit code returned by the command execution.
 * @param stderr - Optional error outputs.
 * @returns True if safety thresholds or maximum turns limit was crossed.
 */
export function isAntigravityTurnLimitResult(
  exitCode?: number | null,
  stderr?: string
): boolean {
  if (exitCode === 53) {
    return true;
  }
  
  if (stderr) {
    const lowerStderr = stderr.toLowerCase();
    if (lowerStderr.includes("turn_limit") || lowerStderr.includes("max_turns")) {
      return true;
    }
  }

  return false;
}

/**
 * Extracts a concise error description representing the first failure log line.
 * Useful to present user-friendly error boundaries to the Paperclip Web UI.
 *
 * @param stdout - The stdout string output.
 * @param stderr - The stderr string output.
 * @returns A formatted failure message, or null if no logs exist.
 */
export function describeAntigravityFailure(stdout: string, stderr: string): string | null {
  const lines = parseMultilineLines(`${stderr}\n${stdout}`);
  if (lines.length === 0) {
    return null;
  }
  return `Antigravity run failed: ${lines[0]}`;
}

/**
 * Extracts the conversation/session ID from process stdout/stderr.
 * Inspects NDJSON events (init, step_update, result) as well as text regex fallbacks.
 *
 * @param stdout - The process stdout stream content.
 * @param stderr - The process stderr stream content.
 * @returns The resolved session ID or null.
 */
export function extractAntigravitySessionId(stdout: string, stderr: string): string | null {
  const combined = `${stdout}\n${stderr}`;
  const lines = combined.split(/\r?\n/);
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        const convId =
          parsed.conversation_id ||
          parsed.session_id ||
          parsed.init?.conversation_id ||
          parsed.step_update?.conversation_id ||
          parsed.result?.conversation_id;
        if (typeof convId === "string" && convId.trim().length > 0) {
          return convId.trim();
        }
      } catch {
        // Ignore JSON parse errors
      }
    }
  }

  const regexes = [
    /conversation[_ -]?id["']?\s*[:=]\s*["']?([a-zA-Z0-9_-]{8,})/i,
    /session[_ -]?id["']?\s*[:=]\s*["']?([a-zA-Z0-9_-]{8,})/i,
    /agy\s+(?:-c|--conversation|-r|--resume)\s+([a-zA-Z0-9_-]{8,})/i,
    /Conversation ID:\s*([a-zA-Z0-9_-]+)/i,
    /Session ID:\s*([a-zA-Z0-9_-]+)/i,
    /Resuming conversation:\s*([a-zA-Z0-9_-]+)/i,
    /Created conversation:\s*([a-zA-Z0-9_-]+)/i,
  ];

  for (const re of regexes) {
    const match = re.exec(combined);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
}

/** Strongly-typed token usage and execution metrics structure. */
export interface AntigravityExecutionMetrics {
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
  };
  costUsd: number | null;
  response: string | null;
}

/**
 * Extracts token usage, cost metrics, and response summary from NDJSON events or stdout.
 *
 * @param stdout - Process stdout stream content.
 * @param stderr - Process stderr stream content.
 * @returns Parsed execution metrics object.
 */
export function extractAntigravityExecutionMetrics(stdout: string, stderr: string): AntigravityExecutionMetrics {
  const metrics: AntigravityExecutionMetrics = {
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
    },
    costUsd: null,
    response: null,
  };

  const combined = `${stdout}\n${stderr}`;
  const lines = combined.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);

        if (parsed.event === "result" && parsed.result?.response) {
          metrics.response = String(parsed.result.response);
        } else if (parsed.response && typeof parsed.response === "string") {
          metrics.response = parsed.response;
        }

        const usageObj = parsed.result?.usage || parsed.step_update?.usage || parsed.usage;
        if (usageObj && typeof usageObj === "object") {
          if (typeof usageObj.input_tokens === "number") {
            metrics.usage.inputTokens = Math.max(metrics.usage.inputTokens, usageObj.input_tokens);
          } else if (typeof usageObj.inputTokens === "number") {
            metrics.usage.inputTokens = Math.max(metrics.usage.inputTokens, usageObj.inputTokens);
          }

          if (typeof usageObj.output_tokens === "number") {
            metrics.usage.outputTokens = Math.max(metrics.usage.outputTokens, usageObj.output_tokens);
          } else if (typeof usageObj.outputTokens === "number") {
            metrics.usage.outputTokens = Math.max(metrics.usage.outputTokens, usageObj.outputTokens);
          }

          const cached = usageObj.cache_read_tokens ?? usageObj.cached_input_tokens ?? usageObj.cachedInputTokens;
          if (typeof cached === "number") {
            metrics.usage.cachedInputTokens = Math.max(metrics.usage.cachedInputTokens, cached);
          }
        }

        const cost = parsed.result?.cost_usd ?? parsed.cost_usd ?? parsed.costUsd;
        if (typeof cost === "number") {
          metrics.costUsd = cost;
        }
      } catch {
        // Ignore JSON parse errors
      }
    }
  }

  return metrics;
}