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