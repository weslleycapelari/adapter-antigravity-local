import type { AntigravityParseResult } from "../types.js";

export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

const keys = ["inputTokens", "outputTokens", "cachedInputTokens"] as const;
const mapUsage = (read: (key: typeof keys[number]) => number): RunUsage =>
  Object.fromEntries(keys.map((key) => [key, read(key)])) as unknown as RunUsage;

export function readUsageTotals(value: unknown): RunUsage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!keys.every((key) => typeof record[key] === "number" && Number.isFinite(record[key]) && record[key] >= 0)) {
    return null;
  }
  return mapUsage((key) => record[key] as number);
}

export function addUsage(left: RunUsage | null, right: RunUsage | null): RunUsage {
  return mapUsage((key) => (left?.[key] ?? 0) + (right?.[key] ?? 0));
}

export interface RunAccounting {
  usage: RunUsage;
  sessionUsage: RunUsage | null;
  source: "steps" | "session_total" | "session_delta" | "migration_steps";
  incomplete: boolean;
}

/** Convert native conversation totals to per-run usage without replaying history. */
export function normalizeRunAccounting(
  parsed: Pick<AntigravityParseResult, "sessionId" | "stepUsage" | "sessionUsage">,
  options: { resumeSessionId?: string | null; sessionUsageBaseline?: unknown } = {},
): RunAccounting {
  const observed = readUsageTotals(parsed.stepUsage) ?? addUsage(null, null);
  const cumulative = readUsageTotals(parsed.sessionUsage);
  const resumed = Boolean(options.resumeSessionId) &&
    (!parsed.sessionId || parsed.sessionId === options.resumeSessionId);
  const baseline = resumed ? readUsageTotals(options.sessionUsageBaseline) : null;
  let usage = observed;
  let sessionUsage: RunUsage | null = null;
  let source: RunAccounting["source"] = "steps";
  let incomplete = false;

  if (cumulative) {
    sessionUsage = cumulative;
    if (!resumed) {
      usage = mapUsage((key) => Math.max(observed[key], cumulative[key]));
      source = "session_total";
    } else if (baseline) {
      usage = mapUsage((key) => Math.max(observed[key],
        cumulative[key] >= baseline[key] ? cumulative[key] - baseline[key] : cumulative[key]));
      source = "session_delta";
    } else {
      // Existing sessions do not yet have a persisted baseline. Count only
      // observed current work and seed the baseline for the next invocation.
      source = "migration_steps";
      incomplete = true;
    }
  } else if (baseline) {
    // Preserve measured work even when a timeout prevents the final result.
    sessionUsage = addUsage(baseline, observed);
  } else if (!resumed) {
    sessionUsage = parsed.stepUsage ? observed : null;
  } else {
    incomplete = true;
  }

  return { usage, sessionUsage, source, incomplete };
}

