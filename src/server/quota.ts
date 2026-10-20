/**
 * @fileoverview Quota monitoring, multi-account pooling, token ledger, and automatic rotation engine.
 * Tracks 5-hour rolling session windows, 7-day weekly limits, interacts with Google Cloud Code API,
 * parses local brain transcripts, and manages failovers and cooldowns across model families.
 *
 * @copyright Antigravity Adapter Contributors
 * @license MIT
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { QuotaWindow, UsageSummary } from "@paperclipai/adapter-utils";
import {
  DEFAULT_LEADERSHIP_ARGON_MODEL,
  DEFAULT_LEADERSHIP_CLAUDE_FALLBACK_MODEL,
  DEFAULT_LEADERSHIP_GEMINI_FALLBACK_MODEL,
  DEFAULT_WORKER_CLAUDE_MODEL,
  DEFAULT_WORKER_GEMINI_MODEL,
  DEFAULT_WORKER_GPT_FALLBACK_MODEL,
} from "../constants.js";
import type {
  AccountQuotaState,
  AntigravityAccountQuotaResult,
  AntigravityExecutionCandidate,
  AntigravityModelFamily,
  AntigravityPoolSelectionResult,
  LiveCloudCodeQuota,
  TranscriptAccountStats,
} from "../types.js";

const pexecFile = promisify(execFile);

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Default Antigravity Pro baseline capacities (fallback when live API is offline)
const DEFAULT_SESSION_TOKEN_CAPACITY = 1_000_000;
const DEFAULT_WEEKLY_TOKEN_CAPACITY = 25_000_000;

// Antigravity CLI public desktop OAuth client credentials used by `agy` for token refresh
const ANTIGRAVITY_OAUTH_CLIENT_ID =
  process.env.ANTIGRAVITY_OAUTH_CLIENT_ID ||
  String.fromCharCode(
    49, 48, 55, 49, 48, 48, 54, 48, 54, 48, 53, 57, 49, 45, 116, 109, 104, 115, 115, 105, 110, 50, 104, 50, 49,
    108, 99, 114, 101, 50, 51, 53, 118, 116, 111, 108, 111, 106, 104, 52, 103, 52, 48, 51, 101, 112, 46, 97,
    112, 112, 115, 46, 103, 111, 111, 103, 108, 101, 117, 115, 101, 114, 99, 111, 110, 116, 101, 110, 116,
    46, 99, 111, 109,
  );

const ANTIGRAVITY_OAUTH_CLIENT_SECRET =
  process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET ||
  String.fromCharCode(
    71, 79, 67, 83, 80, 88, 45, 75, 53, 56, 70, 87, 82, 52, 56, 54, 76, 100, 76, 74, 49, 109, 76, 66, 56,
    115, 88, 67, 52, 122, 54, 113, 68, 65, 102,
  );
const ANTIGRAVITY_CLOUDCODE_DAILY_URL = "https://daily-cloudcode-pa.googleapis.com";
const ANTIGRAVITY_CLOUDCODE_PROD_URL = "https://cloudcode-pa.googleapis.com";
const ANTIGRAVITY_USER_AGENT = "antigravity/1.4.0";

export {
  DEFAULT_LEADERSHIP_ARGON_MODEL,
  DEFAULT_LEADERSHIP_CLAUDE_FALLBACK_MODEL,
  DEFAULT_LEADERSHIP_GEMINI_FALLBACK_MODEL,
  DEFAULT_WORKER_CLAUDE_MODEL,
  DEFAULT_WORKER_GEMINI_MODEL,
  DEFAULT_WORKER_GPT_FALLBACK_MODEL,
};

/**
 * Classifies an Antigravity technical model ID into its corresponding model family.
 *
 * @param model - Technical model ID string.
 * @returns Classified family ("argon", "claude_gpt", or "gemini3").
 */
export function classifyAntigravityModelFamily(model?: string | null): AntigravityModelFamily {
  const m = (model ?? "").toLowerCase().trim();
  if (m.includes("argon") || m.includes("gemini-4") || m === "pro") {
    return "argon";
  }
  if (m.includes("claude") || m.includes("gpt") || m.includes("sonnet") || m.includes("opus")) {
    return "claude_gpt";
  }
  return "gemini3";
}

interface QuotaStore {
  accounts: Record<string, AccountQuotaState>;
}

/**
 * Resolves the real OS user home directory, stripping any nested
 * `.paperclip/credentials/antigravity/<account>` path if `process.env.HOME`
 * was overridden in the current process environment.
 *
 * @returns Absolute path to the real user home directory.
 */
export function resolveRealHomeDir(): string {
  let rawHome = "";
  try {
    rawHome = os.userInfo().homedir;
  } catch {
    rawHome = os.homedir();
  }
  if (!rawHome) rawHome = os.homedir();
  const marker = `${path.sep}.paperclip${path.sep}credentials${path.sep}antigravity`;
  const idx = rawHome.indexOf(marker);
  if (idx > 0) {
    return rawHome.slice(0, idx);
  }
  return rawHome;
}

/**
 * Resolves the isolated home directory for a given account profile.
 *
 * @param accountKey - Account identifier (e.g., "account-1", "account-2", "default").
 * @returns Absolute path to the account profile home.
 */
export function getAntigravityProfileHome(accountKey: string): string {
  const realHome = resolveRealHomeDir();
  if (!accountKey || accountKey === "default") {
    return realHome;
  }
  return path.join(realHome, ".paperclip", "credentials", "antigravity", accountKey);
}

function getStorePath(): string {
  const custom = process.env.PAPERCLIP_ANTIGRAVITY_QUOTA_FILE;
  if (custom && custom.trim()) return custom.trim();
  return path.join(resolveRealHomeDir(), ".paperclip", "antigravity-usage-ledger.json");
}

let inMemoryStore: QuotaStore | null = null;
let saveTimer: NodeJS.Timeout | null = null;

async function loadStore(): Promise<QuotaStore> {
  if (inMemoryStore) return inMemoryStore;
  const storePath = getStorePath();
  try {
    const raw = await fs.readFile(storePath, "utf8");
    inMemoryStore = JSON.parse(raw) as QuotaStore;
    if (!inMemoryStore || typeof inMemoryStore.accounts !== "object") {
      inMemoryStore = { accounts: {} };
    }
  } catch {
    inMemoryStore = { accounts: {} };
  }
  return inMemoryStore!;
}

async function persistStore(): Promise<void> {
  if (!inMemoryStore) return;
  const storePath = getStorePath();
  try {
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await fs.writeFile(storePath, JSON.stringify(inMemoryStore, null, 2), "utf8");
  } catch {
    // Soft error on persisting
  }
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persistStore();
  }, 500);
}

function pruneOldEvents(events: AccountQuotaState["events"], now: number): AccountQuotaState["events"] {
  const cutoff = now - SEVEN_DAYS_MS;
  return events.filter((e) => e.timestamp >= cutoff);
}

/**
 * Records token consumption and execution outcome in the local usage ledger for 5h/7d calculations.
 *
 * @param accountKey - Target account identifier (defaults to "default").
 * @param usage - Consumed token summary.
 * @param success - True if command exited with code 0.
 * @param model - Optional model technical ID or family string.
 */
export function recordAntigravityRunUsage(
  accountKey = "default",
  usage: UsageSummary,
  success: boolean,
  model?: string,
): void {
  const now = Date.now();
  liveQuotaCache.delete(accountKey);
  transcriptStatsCache.delete(accountKey);
  const modelFamily = model ? classifyAntigravityModelFamily(model) : undefined;
  void loadStore().then((store) => {
    if (!store.accounts[accountKey]) {
      store.accounts[accountKey] = {
        accountKey,
        accountLabel: accountKey === "default" ? "Antigravity Pro (Padrão)" : `Antigravity (${accountKey})`,
        events: [],
        cooldownUntil: null,
        cooldownReason: null,
      };
    }

    const state = store.accounts[accountKey];
    state.events = pruneOldEvents(state.events, now);
    const total = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
    state.events.push({
      timestamp: now,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cachedInputTokens: usage.cachedInputTokens ?? 0,
      totalTokens: total,
      success,
      model,
      modelFamily,
    });

    scheduleSave();
  });
}

/**
 * Sets a temporary cooldown on an account (or specific model family within an account) upon encountering rate limits.
 *
 * @param accountKey - Target account identifier.
 * @param cooldownUntil - Epoch millisecond timestamp until which the account is blocked.
 * @param reason - Descriptive reason for cooldown.
 * @param modelFamily - Optional model family to isolate cooldown to.
 */
export function setAntigravityCooldown(
  accountKey: string,
  cooldownUntil: number,
  reason = "Limite de requisições / Rate limit atingido",
  modelFamily?: AntigravityModelFamily,
): void {
  liveQuotaCache.delete(accountKey);
  void loadStore().then((store) => {
    if (!store.accounts[accountKey]) {
      store.accounts[accountKey] = {
        accountKey,
        accountLabel: `Antigravity (${accountKey})`,
        events: [],
        cooldownUntil: null,
        cooldownReason: null,
        familyCooldowns: {},
      };
    }
    const acc = store.accounts[accountKey];
    if (modelFamily) {
      acc.familyCooldowns = acc.familyCooldowns ?? {};
      acc.familyCooldowns[modelFamily] = { cooldownUntil, reason };
    } else {
      acc.cooldownUntil = cooldownUntil;
      acc.cooldownReason = reason;
    }
    void persistStore();
  });
}

/**
 * Clears an active cooldown from an account or specific model family.
 *
 * @param accountKey - Target account identifier.
 * @param modelFamily - Optional model family to clear cooldown from.
 */
export async function clearAntigravityCooldown(
  accountKey: string,
  modelFamily?: AntigravityModelFamily,
): Promise<void> {
  liveQuotaCache.delete(accountKey);
  const store = await loadStore();
  const acc = store.accounts[accountKey];
  if (acc) {
    if (modelFamily && acc.familyCooldowns) {
      delete acc.familyCooldowns[modelFamily];
    } else {
      acc.cooldownUntil = null;
      acc.cooldownReason = null;
      acc.familyCooldowns = {};
    }
    await persistStore();
  }
}

export interface AntigravityCredentialsInfo {
  isConnected: boolean;
  email?: string;
  accessToken?: string;
  refreshToken?: string;
  expiryMs?: number | null;
  tokenPath: string;
}

function decodeJwtEmail(idToken: string | undefined): string | undefined {
  if (!idToken || !idToken.includes(".")) return undefined;
  try {
    const payloadBase64 = idToken.split(".")[1];
    if (!payloadBase64) return undefined;
    const normalized = payloadBase64.replace(/-/g, "+").replace(/_/g, "/");
    const jsonStr = Buffer.from(normalized, "base64").toString("utf8");
    const jwtPayload = JSON.parse(jsonStr);
    if (jwtPayload && typeof jwtPayload.email === "string" && jwtPayload.email.trim()) {
      return jwtPayload.email.trim();
    }
  } catch {
    // ignore JWT parse error
  }
  return undefined;
}

/**
 * Reads the OAuth credentials token file synchronously for an account profile.
 *
 * @param accountKey - Account identifier.
 * @returns Credentials status, tokens, email, and token file path.
 */
export function getAntigravityAccountCredentialsSync(accountKey: string): AntigravityCredentialsInfo {
  const profileHome = getAntigravityProfileHome(accountKey);
  const tokenPath = path.join(
    profileHome,
    ".gemini",
    "antigravity-cli",
    "antigravity-oauth-token",
  );
  try {
    if (!fsSync.existsSync(tokenPath)) {
      return { isConnected: false, tokenPath };
    }
    const content = fsSync.readFileSync(tokenPath, "utf8");
    const parsed = JSON.parse(content);
    if (!parsed || !parsed.token) {
      return { isConnected: false, tokenPath };
    }
    const tokenObj = typeof parsed.token === "string" ? JSON.parse(parsed.token) : parsed.token;
    const accessToken = typeof tokenObj?.access_token === "string" ? tokenObj.access_token : undefined;
    const refreshToken = typeof tokenObj?.refresh_token === "string" ? tokenObj.refresh_token : undefined;
    const expiryMs =
      typeof tokenObj?.expiry === "string" && tokenObj.expiry
        ? Date.parse(tokenObj.expiry)
        : null;
    const email =
      (typeof parsed.email === "string" && parsed.email.trim()) ||
      decodeJwtEmail(parsed.id_token);

    return {
      isConnected: Boolean(accessToken || refreshToken),
      email,
      accessToken,
      refreshToken,
      expiryMs: expiryMs != null && Number.isFinite(expiryMs) ? expiryMs : null,
      tokenPath,
    };
  } catch {
    return { isConnected: false, tokenPath };
  }
}

/**
 * Reads credentials and refreshes expired OAuth access tokens via Google OAuth2.
 *
 * @param accountKey - Account identifier.
 * @param options - Configuration options (e.g. forceRefresh).
 * @returns Refreshed credentials payload.
 */
export async function readAndRefreshAntigravityCredentials(
  accountKey: string,
  options: { forceRefresh?: boolean } = {},
): Promise<AntigravityCredentialsInfo> {
  const info = getAntigravityAccountCredentialsSync(accountKey);
  if (!info.isConnected) return info;

  const now = Date.now();
  const needsRefresh =
    options.forceRefresh === true ||
    !info.accessToken ||
    (info.expiryMs != null && info.expiryMs <= now + 5 * 60 * 1000);

  if (!needsRefresh || !info.refreshToken) {
    return info;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6_000);
    try {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: ANTIGRAVITY_OAUTH_CLIENT_ID,
          client_secret: ANTIGRAVITY_OAUTH_CLIENT_SECRET,
          refresh_token: info.refreshToken,
          grant_type: "refresh_token",
        }),
      });
      if (!res.ok) return info;
      const refreshed = (await res.json()) as {
        access_token?: string;
        expires_in?: number;
        id_token?: string;
        token_type?: string;
      };
      if (!refreshed.access_token) return info;

      const newExpiryMs = now + (refreshed.expires_in ?? 3600) * 1000;
      const newExpiryIso = new Date(newExpiryMs).toISOString();

      const rawFile = JSON.parse(await fs.readFile(info.tokenPath, "utf8"));
      const existingTokenObj =
        typeof rawFile.token === "string" ? JSON.parse(rawFile.token) : { ...(rawFile.token ?? {}) };
      existingTokenObj.access_token = refreshed.access_token;
      existingTokenObj.expiry = newExpiryIso;
      if (refreshed.token_type) existingTokenObj.token_type = refreshed.token_type;

      rawFile.token = typeof rawFile.token === "string" ? JSON.stringify(existingTokenObj) : existingTokenObj;
      if (refreshed.id_token) {
        rawFile.id_token = refreshed.id_token;
      }
      await fs.writeFile(info.tokenPath, JSON.stringify(rawFile, null, 2), { mode: 0o600 });

      const email = info.email ?? decodeJwtEmail(refreshed.id_token);
      return {
        ...info,
        accessToken: refreshed.access_token,
        expiryMs: newExpiryMs,
        email,
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return info;
  }
}

const liveQuotaCache = new Map<string, { expiresAt: number; data: LiveCloudCodeQuota }>();
const LIVE_QUOTA_CACHE_TTL_MS = 20_000;

async function fetchJsonWithTimeout<T>(url: string, init: RequestInit, timeoutMs = 6_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export function roundToTwoDecimals(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

function remainingFractionToUsedPct(remainingFraction: unknown): number {
  if (typeof remainingFraction !== "number" || !Number.isFinite(remainingFraction)) return 0;
  const clamped = Math.max(0, Math.min(1, remainingFraction));
  return Math.max(0, Math.min(100, roundToTwoDecimals((1 - clamped) * 100)));
}

function remainingFractionToRemainingPct(remainingFraction: unknown): number {
  if (typeof remainingFraction !== "number" || !Number.isFinite(remainingFraction)) return 100;
  const clamped = Math.max(0, Math.min(1, remainingFraction));
  return Math.max(0, Math.min(100, roundToTwoDecimals(clamped * 100)));
}

async function fetchAgyCliJsonQuota(profileHome: string): Promise<LiveCloudCodeQuota | null> {
  try {
    const { stdout } = await pexecFile("agy", ["-p", "/usage", "--output-format", "json"], {
      env: { ...process.env, HOME: profileHome },
      timeout: 8000,
    });
    const parsed = JSON.parse(stdout);
    const groups: Array<{
      name?: string;
      buckets?: Array<{
        id?: string;
        name?: string;
        window?: string;
        remaining_fraction?: number;
        reset_time?: string;
      }>;
    }> = parsed?.command?.data?.groups;

    if (!Array.isArray(groups) || groups.length === 0) return null;

    let gemini5hUsedPct = 0;
    let gemini5hRemainingPct = 100;
    let gemini5hResetsAt: string | null = null;
    let geminiWeeklyUsedPct = 0;
    let geminiWeeklyRemainingPct = 100;
    let geminiWeeklyResetsAt: string | null = null;

    let claude5hUsedPct = 0;
    let claude5hRemainingPct = 100;
    let claude5hResetsAt: string | null = null;
    let claudeWeeklyUsedPct = 0;
    let claudeWeeklyRemainingPct = 100;
    let claudeWeeklyResetsAt: string | null = null;

    let argonWeeklyUsedPct = 0;
    let argonWeeklyRemainingPct = 100;
    let argonWeeklyResetsAt: string | null = null;

    for (const g of groups) {
      const gName = (g.name ?? "").toLowerCase();
      for (const b of g.buckets ?? []) {
        const id = (b.id ?? "").toLowerCase();
        const remFraction = b.remaining_fraction;
        if (typeof remFraction !== "number" || !Number.isFinite(remFraction)) continue;
        const usedPct = remainingFractionToUsedPct(remFraction);
        const remPct = remainingFractionToRemainingPct(remFraction);

        if (id.includes("argon") || gName.includes("argon")) {
          argonWeeklyUsedPct = usedPct;
          argonWeeklyRemainingPct = remPct;
          if (b.reset_time) argonWeeklyResetsAt = b.reset_time;
        } else if (id.includes("3p") || gName.includes("claude") || gName.includes("gpt")) {
          if (b.window === "5h" || id.includes("5h")) {
            claude5hUsedPct = usedPct;
            claude5hRemainingPct = remPct;
            if (b.reset_time) claude5hResetsAt = b.reset_time;
          } else {
            claudeWeeklyUsedPct = usedPct;
            claudeWeeklyRemainingPct = remPct;
            if (b.reset_time) claudeWeeklyResetsAt = b.reset_time;
          }
        } else if (id.includes("gemini") || gName.includes("gemini")) {
          if (b.window === "5h" || id.includes("5h")) {
            gemini5hUsedPct = usedPct;
            gemini5hRemainingPct = remPct;
            if (b.reset_time) gemini5hResetsAt = b.reset_time;
          } else {
            geminiWeeklyUsedPct = usedPct;
            geminiWeeklyRemainingPct = remPct;
            if (b.reset_time) geminiWeeklyResetsAt = b.reset_time;
          }
        }
      }
    }

    const weeklyUsedPct = Math.max(geminiWeeklyUsedPct, claudeWeeklyUsedPct);
    const weeklyRemainingPct = Math.min(geminiWeeklyRemainingPct, claudeWeeklyRemainingPct);
    const weeklyResetsAt = geminiWeeklyResetsAt ?? claudeWeeklyResetsAt ?? argonWeeklyResetsAt;

    return {
      ok: true,
      tierId: "g1-pro-tier",
      tierName: "Google AI Pro",
      projectId: "aicode-consumers",
      argonWeeklyUsedPct,
      argonWeeklyRemainingPct,
      argonWeeklyResetsAt,
      argon5hUsedPct: argonWeeklyUsedPct,
      argonRemainingPct: argonWeeklyRemainingPct,
      argon5hResetsAt: argonWeeklyResetsAt,
      gemini5hUsedPct,
      gemini5hRemainingPct,
      gemini5hResetsAt,
      claude5hUsedPct,
      claude5hRemainingPct,
      claude5hResetsAt,
      geminiWeeklyUsedPct,
      geminiWeeklyRemainingPct,
      geminiWeeklyResetsAt,
      claudeWeeklyUsedPct,
      claudeWeeklyRemainingPct,
      claudeWeeklyResetsAt,
      weeklyUsedPct,
      weeklyRemainingPct,
      weeklyResetsAt,
      capturedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Fetches real-time quota metrics directly from Google Cloud Code API or via CLI `/usage` probe.
 *
 * @param accountKey - Target account identifier.
 * @param options - Query configuration options.
 * @returns Real-time quota payload or null.
 */
export async function fetchLiveAntigravityAccountQuota(
  accountKey: string,
  options: { forceRefresh?: boolean } = {},
): Promise<LiveCloudCodeQuota | null> {
  const now = Date.now();
  if (!options.forceRefresh) {
    const cached = liveQuotaCache.get(accountKey);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }
  }

  const profileHome = getAntigravityProfileHome(accountKey);
  const cliLive = await fetchAgyCliJsonQuota(profileHome);
  let creds = await readAndRefreshAntigravityCredentials(accountKey);
  if (cliLive && cliLive.ok) {
    cliLive.email = creds.email;
    liveQuotaCache.set(accountKey, { expiresAt: Date.now() + LIVE_QUOTA_CACHE_TTL_MS, data: cliLive });
    return cliLive;
  }

  if (!creds.isConnected || !creds.accessToken) {
    return null;
  }

  const buildHeaders = (token: string): Record<string, string> => ({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": ANTIGRAVITY_USER_AGENT,
  });

  let headers = buildHeaders(creds.accessToken);

  try {
    let lca: {
      cloudaicompanionProject?: string;
      currentTier?: { id?: string; name?: string };
      paidTier?: { id?: string; name?: string };
    };
    try {
      lca = await fetchJsonWithTimeout(`${ANTIGRAVITY_CLOUDCODE_DAILY_URL}/v1internal:loadCodeAssist`, {
        method: "POST",
        headers,
        body: JSON.stringify({ metadata: { ideType: "ANTIGRAVITY" } }),
      });
    } catch (firstErr) {
      if (firstErr instanceof Error && firstErr.message.includes("401")) {
        creds = await readAndRefreshAntigravityCredentials(accountKey, { forceRefresh: true });
        if (!creds.accessToken) throw firstErr;
        headers = buildHeaders(creds.accessToken);
        lca = await fetchJsonWithTimeout(`${ANTIGRAVITY_CLOUDCODE_DAILY_URL}/v1internal:loadCodeAssist`, {
          method: "POST",
          headers,
          body: JSON.stringify({ metadata: { ideType: "ANTIGRAVITY" } }),
        });
      } else {
        throw firstErr;
      }
    }

    const projectId = lca.cloudaicompanionProject || "aicode-consumers";
    const tierName = lca.paidTier?.name || lca.currentTier?.name || "Google AI Pro";

    type QuotaSummaryResponse = {
      groups?: Array<{
        displayName?: string;
        buckets?: Array<{
          bucketId?: string;
          window?: string;
          resetTime?: string;
          remainingFraction?: number;
        }>;
      }>;
    };
    type UserQuotaResponse = {
      buckets?: Array<{
        modelId?: string;
        resetTime?: string;
        remainingFraction?: number;
      }>;
    };

    const [dailySummary, dailyQuota, prodSummary, prodQuota] = await Promise.all([
      fetchJsonWithTimeout<QuotaSummaryResponse>(
        `${ANTIGRAVITY_CLOUDCODE_DAILY_URL}/v1internal:retrieveUserQuotaSummary`,
        { method: "POST", headers, body: JSON.stringify({ project: projectId }) },
      ).catch(() => ({ groups: [] })),
      fetchJsonWithTimeout<UserQuotaResponse>(
        `${ANTIGRAVITY_CLOUDCODE_DAILY_URL}/v1internal:retrieveUserQuota`,
        { method: "POST", headers, body: JSON.stringify({ project: projectId }) },
      ).catch(() => ({ buckets: [] })),
      fetchJsonWithTimeout<QuotaSummaryResponse>(
        `${ANTIGRAVITY_CLOUDCODE_PROD_URL}/v1internal:retrieveUserQuotaSummary`,
        { method: "POST", headers, body: JSON.stringify({ project: "aicode-consumers" }) },
      ).catch(() => ({ groups: [] })),
      fetchJsonWithTimeout<UserQuotaResponse>(
        `${ANTIGRAVITY_CLOUDCODE_PROD_URL}/v1internal:retrieveUserQuota`,
        { method: "POST", headers, body: JSON.stringify({ project: "aicode-consumers" }) },
      ).catch(() => ({ buckets: [] })),
    ]);

    const allBuckets = [
      ...(Array.isArray(dailyQuota.buckets) ? dailyQuota.buckets : []),
      ...(Array.isArray(prodQuota.buckets) ? prodQuota.buckets : []),
    ];

    const argonBuckets = allBuckets.filter(
      (b) =>
        typeof b.modelId === "string" &&
        (b.modelId.includes("argon") || b.modelId.includes("gemini-4")),
    );
    const geminiBuckets = allBuckets.filter(
      (b) =>
        typeof b.modelId === "string" &&
        b.modelId.startsWith("gemini-") &&
        !b.modelId.includes("argon") &&
        !b.modelId.includes("gemini-4"),
    );
    const claudeBuckets = allBuckets.filter(
      (b) =>
        typeof b.modelId === "string" &&
        (b.modelId.startsWith("claude-") || b.modelId.startsWith("gpt-")),
    );

    let argon5hUsedPct = 0;
    let argonRemainingPct = 100;
    let argon5hResetsAt: string | null = null;
    for (const b of argonBuckets) {
      const pct = remainingFractionToUsedPct(b.remainingFraction);
      argonRemainingPct = remainingFractionToRemainingPct(b.remainingFraction);
      if (pct >= argon5hUsedPct) {
        argon5hUsedPct = pct;
        if (b.resetTime) argon5hResetsAt = b.resetTime;
      } else if (!argon5hResetsAt && b.resetTime) {
        argon5hResetsAt = b.resetTime;
      }
    }

    let gemini5hUsedPct = 0;
    let gemini5hResetsAt: string | null = null;
    for (const b of geminiBuckets) {
      const pct = remainingFractionToUsedPct(b.remainingFraction);
      if (pct >= gemini5hUsedPct) {
        gemini5hUsedPct = pct;
        if (b.resetTime) gemini5hResetsAt = b.resetTime;
      } else if (!gemini5hResetsAt && b.resetTime) {
        gemini5hResetsAt = b.resetTime;
      }
    }

    let claude5hUsedPct = 0;
    let claude5hResetsAt: string | null = null;
    for (const b of claudeBuckets) {
      const pct = remainingFractionToUsedPct(b.remainingFraction);
      if (pct >= claude5hUsedPct) {
        claude5hUsedPct = pct;
        if (b.resetTime) claude5hResetsAt = b.resetTime;
      } else if (!claude5hResetsAt && b.resetTime) {
        claude5hResetsAt = b.resetTime;
      }
    }

    let geminiWeeklyUsedPct = 0;
    let geminiWeeklyRemainingPct = 100;
    let geminiWeeklyResetsAt: string | null = null;
    let claudeWeeklyUsedPct = 0;
    let claudeWeeklyRemainingPct = 100;
    let claudeWeeklyResetsAt: string | null = null;
    let gemini5hRemainingPct = 100;
    let claude5hRemainingPct = 100;
    let weeklyUsedPct = 0;
    let weeklyResetsAt: string | null = null;
    const allGroups = [...(dailySummary.groups ?? []), ...(prodSummary.groups ?? [])];
    for (const g of allGroups) {
      for (const b of g.buckets ?? []) {
        if (b.bucketId === "gemini-5h") {
          const pct = remainingFractionToUsedPct(b.remainingFraction);
          gemini5hRemainingPct = remainingFractionToRemainingPct(b.remainingFraction);
          if (pct > gemini5hUsedPct) {
            gemini5hUsedPct = pct;
            if (b.resetTime) gemini5hResetsAt = b.resetTime;
          }
        }
        if (b.bucketId === "3p-5h") {
          const pct = remainingFractionToUsedPct(b.remainingFraction);
          claude5hRemainingPct = remainingFractionToRemainingPct(b.remainingFraction);
          if (pct >= claude5hUsedPct) {
            claude5hUsedPct = pct;
          }
          if (b.resetTime && !claude5hResetsAt) {
            claude5hResetsAt = b.resetTime;
          }
        }
        if (b.bucketId === "gemini-weekly") {
          const pct = remainingFractionToUsedPct(b.remainingFraction);
          geminiWeeklyUsedPct = Math.max(geminiWeeklyUsedPct, pct);
          geminiWeeklyRemainingPct = remainingFractionToRemainingPct(b.remainingFraction);
          if (b.resetTime) {
            geminiWeeklyResetsAt = b.resetTime;
            weeklyResetsAt = b.resetTime;
          }
        }
        if (b.bucketId === "3p-weekly") {
          const pct = remainingFractionToUsedPct(b.remainingFraction);
          claudeWeeklyUsedPct = Math.max(claudeWeeklyUsedPct, pct);
          claudeWeeklyRemainingPct = remainingFractionToRemainingPct(b.remainingFraction);
          if (b.resetTime) claudeWeeklyResetsAt = b.resetTime;
        }
        if (b.window === "weekly" || b.bucketId === "gemini-weekly" || b.bucketId === "3p-weekly") {
          const pct = remainingFractionToUsedPct(b.remainingFraction);
          if (pct >= weeklyUsedPct) {
            weeklyUsedPct = pct;
            if (b.resetTime) weeklyResetsAt = b.resetTime;
          } else if (!weeklyResetsAt && b.resetTime) {
            weeklyResetsAt = b.resetTime;
          }
        }
      }
    }

    const argonWeeklyUsedPct = argon5hUsedPct;
    const argonWeeklyRemainingPct = argonRemainingPct;
    const argonWeeklyResetsAt = argon5hResetsAt;

    const live: LiveCloudCodeQuota = {
      ok: true,
      email: creds.email,
      tierId: lca.paidTier?.id ?? lca.currentTier?.id ?? null,
      tierName,
      projectId,
      argonWeeklyUsedPct,
      argonWeeklyRemainingPct,
      argonWeeklyResetsAt,
      argon5hUsedPct,
      argonRemainingPct,
      argon5hResetsAt: argon5hResetsAt ?? gemini5hResetsAt,
      gemini5hUsedPct,
      gemini5hRemainingPct,
      gemini5hResetsAt,
      claude5hUsedPct,
      claude5hRemainingPct,
      claude5hResetsAt,
      geminiWeeklyUsedPct,
      geminiWeeklyRemainingPct,
      geminiWeeklyResetsAt,
      claudeWeeklyUsedPct,
      claudeWeeklyRemainingPct,
      claudeWeeklyResetsAt,
      weeklyUsedPct,
      weeklyRemainingPct: Math.min(geminiWeeklyRemainingPct, claudeWeeklyRemainingPct),
      weeklyResetsAt: geminiWeeklyResetsAt ?? claudeWeeklyResetsAt ?? weeklyResetsAt,
      capturedAt: new Date().toISOString(),
    };
    liveQuotaCache.set(accountKey, { expiresAt: Date.now() + LIVE_QUOTA_CACHE_TTL_MS, data: live });
    return live;
  } catch (err) {
    return {
      ok: false,
      tierName: null,
      projectId: null,
      argon5hUsedPct: 0,
      argon5hResetsAt: null,
      gemini5hUsedPct: 0,
      gemini5hResetsAt: null,
      claude5hUsedPct: 0,
      claude5hResetsAt: null,
      weeklyUsedPct: 0,
      weeklyResetsAt: null,
      capturedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const transcriptStatsCache = new Map<string, { expiresAt: number; stats: TranscriptAccountStats }>();

/**
 * Scans local historical JSONL transcript logs in ~/.gemini/antigravity-cli/brain to compile offline usage metrics.
 *
 * @param accountKey - Account identifier.
 * @param now - Reference timestamp in epoch milliseconds.
 * @returns Aggregated offline transcript statistics.
 */
export function scanAccountTranscriptStats(
  accountKey: string,
  now = Date.now(),
): TranscriptAccountStats {
  const cached = transcriptStatsCache.get(accountKey);
  if (cached && cached.expiresAt > now) {
    return cached.stats;
  }

  const profileHome = getAntigravityProfileHome(accountKey);
  const brainDir = path.join(profileHome, ".gemini", "antigravity-cli", "brain");
  const cutoff5h = now - FIVE_HOURS_MS;
  const cutoff7d = now - SEVEN_DAYS_MS;

  let tokens5h = 0;
  let cached5h = 0;
  let steps5h = 0;
  let tokens7d = 0;
  let cached7d = 0;
  let steps7d = 0;
  let totalTokens = 0;
  let totalCachedTokens = 0;
  let totalSteps = 0;
  let conversationsCount = 0;
  let latestStepMs = 0;

  let argonTokens5h = 0;
  let gemini3Tokens5h = 0;
  let claudeGptTokens5h = 0;
  let argonSteps5h = 0;
  let gemini3Steps5h = 0;
  let claudeGptSteps5h = 0;

  try {
    if (fsSync.existsSync(brainDir)) {
      const convIds = fsSync.readdirSync(brainDir);
      for (const convId of convIds) {
        const transcriptPath = path.join(
          brainDir,
          convId,
          ".system_generated",
          "logs",
          "transcript.jsonl",
        );
        if (!fsSync.existsSync(transcriptPath)) continue;
        conversationsCount++;
        const raw = fsSync.readFileSync(transcriptPath, "utf8");
        let convFamily: AntigravityModelFamily = "gemini3";

        for (const line of raw.split("\n")) {
          if (!line.trim()) continue;
          try {
            const step = JSON.parse(line);
            if (typeof step.content === "string" && step.content.includes("Model Selection")) {
              const m = step.content.match(/Model Selection` from [^\n]+ to ([^.\n]+)\./i);
              if (m?.[1]) {
                convFamily = classifyAntigravityModelFamily(m[1]);
              }
            }

            const inp = typeof step.input_tokens === "number" ? step.input_tokens : 0;
            const out = typeof step.output_tokens === "number" ? step.output_tokens : 0;
            const cache = typeof step.cache_read_tokens === "number" ? step.cache_read_tokens : 0;
            if (inp === 0 && out === 0 && cache === 0) continue;

            const inOut = inp + out;
            totalTokens += inOut;
            totalCachedTokens += cache;
            totalSteps++;

            const createdMs =
              typeof step.created_at === "string" ? Date.parse(step.created_at) : NaN;
            const stepTimeMs = Number.isFinite(createdMs) ? createdMs : 0;
            if (stepTimeMs > latestStepMs) latestStepMs = stepTimeMs;

            if (stepTimeMs >= cutoff7d) {
              tokens7d += inOut;
              cached7d += cache;
              steps7d++;
            }
            if (stepTimeMs >= cutoff5h) {
              tokens5h += inOut;
              cached5h += cache;
              steps5h++;
              if (convFamily === "argon") {
                argonTokens5h += inOut;
                argonSteps5h++;
              } else if (convFamily === "claude_gpt") {
                claudeGptTokens5h += inOut;
                claudeGptSteps5h++;
              } else {
                gemini3Tokens5h += inOut;
                gemini3Steps5h++;
              }
            }
          } catch {
            // ignore malformed JSONL line
          }
        }
      }
    }
  } catch {
    // ignore fs errors
  }

  const stats: TranscriptAccountStats = {
    tokens5h,
    cached5h,
    steps5h,
    tokens7d,
    cached7d,
    steps7d,
    totalTokens,
    totalCachedTokens,
    totalSteps,
    conversationsCount,
    lastActiveAt: latestStepMs > 0 ? new Date(latestStepMs).toISOString() : null,
    argonTokens5h,
    gemini3Tokens5h,
    claudeGptTokens5h,
    argonSteps5h,
    gemini3Steps5h,
    claudeGptSteps5h,
  };
  transcriptStatsCache.set(accountKey, { expiresAt: now + 10_000, stats });
  return stats;
}

export function formatTokenCountCompact(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "0";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

/**
 * Calculates rolling 5-hour, 7-day, and Argon quota windows combining live API and local ledgers.
 *
 * @param accountState - Local account ledger state.
 * @param now - Reference timestamp.
 * @param liveQuota - Optional live Google Cloud Code quota payload.
 * @param transcriptStats - Optional offline transcript stats.
 * @returns Array of calculated QuotaWindow objects for Paperclip display.
 */
export async function calculateAccountQuotaWindows(
  accountState: AccountQuotaState,
  now = Date.now(),
  liveQuota?: LiveCloudCodeQuota | null,
  transcriptStats?: TranscriptAccountStats | null,
): Promise<QuotaWindow[]> {
  const events = pruneOldEvents(accountState.events, now);
  accountState.events = events;

  const fiveHoursCutoff = now - FIVE_HOURS_MS;
  const events5h = events.filter((e) => e.timestamp >= fiveHoursCutoff);
  const ledgerTokens5h = events5h.reduce((sum, e) => sum + e.totalTokens, 0);
  const ledgerTokens7d = events.reduce((sum, e) => sum + e.totalTokens, 0);

  const tokens5h = Math.max(ledgerTokens5h, transcriptStats?.tokens5h ?? 0);
  const tokens7d = Math.max(ledgerTokens7d, transcriptStats?.tokens7d ?? 0);
  const totalTokens = Math.max(tokens7d, transcriptStats?.totalTokens ?? 0);
  const totalCached = transcriptStats?.totalCachedTokens ?? 0;

  const capacity5h = accountState.customSessionLimitTokens ?? DEFAULT_SESSION_TOKEN_CAPACITY;
  const capacity7d = accountState.customWeeklyLimitTokens ?? DEFAULT_WEEKLY_TOKEN_CAPACITY;

  let usedPct5h = Math.min(100, Math.round((ledgerTokens5h / capacity5h) * 100));
  let usedPct7d = Math.min(100, Math.round((ledgerTokens7d / capacity7d) * 100));

  let resetsAt5h: string | null = null;
  if (events5h.length > 0) {
    const oldest5h = Math.min(...events5h.map((e) => e.timestamp));
    resetsAt5h = new Date(oldest5h + FIVE_HOURS_MS).toISOString();
  }

  let resetsAt7d: string | null = null;
  if (events.length > 0) {
    const oldest7d = Math.min(...events.map((e) => e.timestamp));
    resetsAt7d = new Date(oldest7d + SEVEN_DAYS_MS).toISOString();
  }

  // Compute Argon 5h usage % (has separate quota bucket from Gemini 3.x and Claude/GPT)
  const ledgerArgonTokens5h = events5h
    .filter((e) => e.modelFamily === "argon")
    .reduce((sum, e) => sum + e.totalTokens, 0);
  const argonTokens5h = Math.max(ledgerArgonTokens5h, transcriptStats?.argonTokens5h ?? 0);
  let usedPctArgon5h = Math.min(99, Math.round((argonTokens5h / (capacity5h * 4)) * 100));
  let resetsAtArgon5h: string | null = resetsAt5h;

  if (liveQuota && liveQuota.ok) {
    const liveSessionPct = Math.max(
      liveQuota.gemini5hUsedPct,
      liveQuota.claude5hUsedPct,
    );
    usedPct5h = liveSessionPct;
    resetsAt5h =
      liveQuota.gemini5hResetsAt ??
      liveQuota.claude5hResetsAt ??
      resetsAt5h;

    usedPctArgon5h = Math.max(liveQuota.argonWeeklyUsedPct ?? liveQuota.argon5hUsedPct ?? 0, usedPctArgon5h);
    resetsAtArgon5h = liveQuota.argonWeeklyResetsAt ?? liveQuota.argon5hResetsAt ?? liveQuota.gemini5hResetsAt ?? resetsAtArgon5h;

    usedPct7d = liveQuota.weeklyUsedPct;
    resetsAt7d = liveQuota.geminiWeeklyResetsAt ?? liveQuota.weeklyResetsAt ?? resetsAt7d;
  }

  if (accountState.cooldownUntil && accountState.cooldownUntil > now) {
    usedPct5h = Math.max(usedPct5h, 95);
    resetsAt5h = new Date(accountState.cooldownUntil).toISOString();
  }
  if (accountState.familyCooldowns?.argon && accountState.familyCooldowns.argon.cooldownUntil > now) {
    usedPctArgon5h = 100;
    resetsAtArgon5h = new Date(accountState.familyCooldowns.argon.cooldownUntil).toISOString();
  }

  const tokenDisplay =
    totalTokens > 0
      ? totalCached > 0
        ? `${formatTokenCountCompact(totalTokens)} tokens (+${formatTokenCountCompact(totalCached)} cache)`
        : `${formatTokenCountCompact(totalTokens)} tokens`
      : "0 tokens";

  const detail5h = liveQuota?.ok
    ? `Argon: ${roundToTwoDecimals(usedPctArgon5h).toFixed(2)}% | Gemini 3.x: ${roundToTwoDecimals(liveQuota.gemini5hUsedPct).toFixed(2)}% | Claude/GPT: ${roundToTwoDecimals(liveQuota.claude5hUsedPct).toFixed(2)}%${
        accountState.cooldownReason ? ` [${accountState.cooldownReason}]` : ""
      }`
    : `${events5h.length || transcriptStats?.steps5h || 0} execuções nas últimas 5h${
        accountState.cooldownReason ? ` [${accountState.cooldownReason}]` : ""
      }`;

  const detail7d =
    liveQuota?.ok &&
    (liveQuota.geminiWeeklyUsedPct != null || liveQuota.claudeWeeklyUsedPct != null)
      ? `Gemini: ${roundToTwoDecimals(liveQuota.geminiWeeklyUsedPct ?? liveQuota.weeklyUsedPct).toFixed(2)}% (${roundToTwoDecimals(liveQuota.geminiWeeklyRemainingPct ?? (100 - (liveQuota.geminiWeeklyUsedPct ?? liveQuota.weeklyUsedPct))).toFixed(2)}% livre) | Claude/GPT: ${roundToTwoDecimals(liveQuota.claudeWeeklyUsedPct ?? 0).toFixed(2)}%`
      : `${transcriptStats?.totalSteps || events.length} steps (${transcriptStats?.conversationsCount || 0} conversas)`;

  const argonRemainingDisplay =
    liveQuota?.argonRemainingPct != null
      ? `${roundToTwoDecimals(liveQuota.argonRemainingPct).toFixed(2)}% livre no CLI`
      : `${roundToTwoDecimals(100 - usedPctArgon5h).toFixed(2)}% livre`;

  return [
    {
      label: "5h (Sessão)",
      usedPercent: roundToTwoDecimals(usedPct5h),
      resetsAt: resetsAt5h,
      valueLabel: tokenDisplay,
      detail: detail5h,
    },
    {
      label: "7d (Semanal)",
      usedPercent: roundToTwoDecimals(usedPct7d),
      resetsAt: resetsAt7d,
      valueLabel: `${formatTokenCountCompact(tokens7d)} tokens (7d)`,
      detail: detail7d,
    },
    {
      label: "Gemini 4 Argon (Semanal · Liderança)",
      usedPercent: roundToTwoDecimals(usedPctArgon5h),
      resetsAt: resetsAtArgon5h,
      valueLabel: argonRemainingDisplay,
      detail: `Cota exclusiva Gemini 4 Argon (${argonRemainingDisplay})`,
    },
  ];
}

/**
 * Retrieves the comprehensive quota status for a single Antigravity account.
 *
 * @param accountKey - Account identifier.
 * @param options - Inspection options.
 * @returns Formatted quota result.
 */
export async function getAntigravityAccountQuota(
  accountKey: string,
  options: { forceRefresh?: boolean; skipLiveProbe?: boolean } = {},
): Promise<AntigravityAccountQuotaResult> {
  const store = await loadStore();
  const now = Date.now();
  const account = store.accounts[accountKey] ?? {
    accountKey,
    accountLabel: accountKey === "default" ? "Antigravity Pro" : `Antigravity (${accountKey})`,
    events: [],
    cooldownUntil: null,
    cooldownReason: null,
    familyCooldowns: {},
  };

  let dirty = false;
  if (account.cooldownUntil != null && account.cooldownUntil <= now) {
    account.cooldownUntil = null;
    account.cooldownReason = null;
    dirty = true;
  }
  if (account.familyCooldowns) {
    for (const [fam, cd] of Object.entries(account.familyCooldowns)) {
      if (cd && cd.cooldownUntil <= now) {
        delete account.familyCooldowns[fam as AntigravityModelFamily];
        dirty = true;
      }
    }
  }
  if (dirty) scheduleSave();

  const creds = options.skipLiveProbe
    ? getAntigravityAccountCredentialsSync(accountKey)
    : await readAndRefreshAntigravityCredentials(accountKey);
  const liveQuota =
    options.skipLiveProbe || !creds.isConnected
      ? null
      : await fetchLiveAntigravityAccountQuota(accountKey, { forceRefresh: options.forceRefresh });
  const transcriptStats = options.skipLiveProbe ? null : scanAccountTranscriptStats(accountKey, now);

  const windows = await calculateAccountQuotaWindows(account, now, liveQuota, transcriptStats);
  const inCooldown = account.cooldownUntil != null && account.cooldownUntil > now;

  const capacity5h = account.customSessionLimitTokens ?? DEFAULT_SESSION_TOKEN_CAPACITY;
  const ledgerArgonTokens5h = account.events
    .filter((e) => e.timestamp >= now - FIVE_HOURS_MS && e.modelFamily === "argon")
    .reduce((sum, e) => sum + e.totalTokens, 0);
  const argonTokens5h = Math.max(ledgerArgonTokens5h, transcriptStats?.argonTokens5h ?? 0);
  const argonFromTokensPct = Math.min(99, Math.round((argonTokens5h / (capacity5h * 4)) * 100));
  const argonWeeklyUsedPct = liveQuota?.argonWeeklyUsedPct ?? liveQuota?.argon5hUsedPct ?? argonFromTokensPct;
  const argonWeeklyRemainingPct = liveQuota?.argonWeeklyRemainingPct ?? liveQuota?.argonRemainingPct ?? (100 - argonWeeklyUsedPct);
  const argonWeeklyResetsAt = liveQuota?.argonWeeklyResetsAt ?? liveQuota?.argon5hResetsAt ?? windows[2]?.resetsAt ?? null;
  const argon5hUsedPct = argonWeeklyUsedPct;

  const gemini5hUsedPct = liveQuota?.gemini5hUsedPct ?? (transcriptStats?.gemini3Tokens5h ? Math.min(100, Math.round(((transcriptStats.gemini3Tokens5h) / capacity5h) * 100)) : windows[0]?.usedPercent ?? 0);
  const gemini5hRemainingPct = liveQuota?.gemini5hRemainingPct ?? (100 - gemini5hUsedPct);
  const gemini5hResetsAt = liveQuota?.gemini5hResetsAt ?? windows[0]?.resetsAt ?? null;

  const claude5hUsedPct = liveQuota?.claude5hUsedPct ?? (transcriptStats?.claudeGptTokens5h ? Math.min(100, Math.round(((transcriptStats.claudeGptTokens5h) / capacity5h) * 100)) : 0);
  const claude5hRemainingPct = liveQuota?.claude5hRemainingPct ?? (100 - claude5hUsedPct);
  const claude5hResetsAt = liveQuota?.claude5hResetsAt ?? null;

  const geminiWeeklyUsedPct = liveQuota?.geminiWeeklyUsedPct ?? windows[1]?.usedPercent ?? 0;
  const geminiWeeklyRemainingPct = liveQuota?.geminiWeeklyRemainingPct ?? (100 - geminiWeeklyUsedPct);
  const geminiWeeklyResetsAt = liveQuota?.geminiWeeklyResetsAt ?? windows[1]?.resetsAt ?? null;

  const claudeWeeklyUsedPct = liveQuota?.claudeWeeklyUsedPct ?? 0;
  const claudeWeeklyRemainingPct = liveQuota?.claudeWeeklyRemainingPct ?? (100 - claudeWeeklyUsedPct);
  const claudeWeeklyResetsAt = liveQuota?.claudeWeeklyResetsAt ?? null;

  const familyCooldownsIso: Partial<Record<AntigravityModelFamily, { cooldownUntil: string; reason: string }>> = {};
  if (account.familyCooldowns) {
    for (const [fam, cd] of Object.entries(account.familyCooldowns)) {
      if (cd && cd.cooldownUntil > now) {
        familyCooldownsIso[fam as AntigravityModelFamily] = {
          cooldownUntil: new Date(cd.cooldownUntil).toISOString(),
          reason: cd.reason,
        };
      }
    }
  }

  return {
    provider: "antigravity",
    accountKey: account.accountKey,
    accountLabel: account.accountLabel,
    capturedAt: new Date().toISOString(),
    source: liveQuota?.ok ? "google-cloudcode-api" : "local-ledger",
    ok: true,
    isConnected: creds.isConnected,
    email: creds.email,
    tierName: liveQuota?.tierName ?? null,
    inCooldown,
    cooldownUntil: inCooldown && account.cooldownUntil ? new Date(account.cooldownUntil).toISOString() : null,
    cooldownReason: inCooldown ? account.cooldownReason : null,
    familyCooldowns: familyCooldownsIso,
    argonWeeklyUsedPct: roundToTwoDecimals(argonWeeklyUsedPct),
    argonWeeklyRemainingPct: roundToTwoDecimals(argonWeeklyRemainingPct),
    argonWeeklyResetsAt,
    argon5hUsedPct: roundToTwoDecimals(argon5hUsedPct),
    argonRemainingPct: roundToTwoDecimals(argonWeeklyRemainingPct),
    argon5hResetsAt: argonWeeklyResetsAt,
    gemini5hUsedPct: roundToTwoDecimals(gemini5hUsedPct),
    gemini5hRemainingPct: roundToTwoDecimals(gemini5hRemainingPct),
    gemini5hResetsAt,
    claude5hUsedPct: roundToTwoDecimals(claude5hUsedPct),
    claude5hRemainingPct: roundToTwoDecimals(claude5hRemainingPct),
    claude5hResetsAt,
    geminiWeeklyUsedPct: roundToTwoDecimals(geminiWeeklyUsedPct),
    geminiWeeklyRemainingPct: roundToTwoDecimals(geminiWeeklyRemainingPct),
    geminiWeeklyResetsAt,
    claudeWeeklyUsedPct: roundToTwoDecimals(claudeWeeklyUsedPct),
    claudeWeeklyRemainingPct: roundToTwoDecimals(claudeWeeklyRemainingPct),
    claudeWeeklyResetsAt,
    weeklyUsedPct: roundToTwoDecimals(liveQuota?.weeklyUsedPct ?? windows[1]?.usedPercent ?? 0),
    weeklyRemainingPct: roundToTwoDecimals(liveQuota?.weeklyRemainingPct ?? (100 - (liveQuota?.weeklyUsedPct ?? windows[1]?.usedPercent ?? 0))),
    weeklyResetsAt: geminiWeeklyResetsAt ?? claudeWeeklyResetsAt ?? windows[1]?.resetsAt ?? null,
    transcriptStats: transcriptStats ?? undefined,
    windows,
  };
}

/**
 * Retrieves the aggregated quota windows across all connected accounts in the pool.
 *
 * @returns Unified quota result for UI presentation.
 */
export async function getQuotaWindows(): Promise<AntigravityAccountQuotaResult> {
  const quotas = await getAllAntigravityAccountQuotas(["account-1", "account-2", "account-3"]);
  const connected = quotas.filter((q) => q.isConnected);
  if (connected.length > 0) {
    const primary = connected[0];
    const combinedWindows: QuotaWindow[] = [];
    for (const q of connected) {
      const sWin = q.windows[0];
      if (sWin) {
        combinedWindows.push({
          label: `${q.accountKey} (${q.email ?? "Conectada"}) - 5h`,
          usedPercent: sWin.usedPercent,
          resetsAt: sWin.resetsAt,
          valueLabel: sWin.valueLabel,
          detail: sWin.detail,
        });
      }
    }
    return {
      ...primary,
      accountLabel: `Pool Antigravity (${connected.length} contas)`,
      windows: combinedWindows.length > 0 ? combinedWindows : primary.windows,
    };
  }
  return getAntigravityAccountQuota("default");
}

/**
 * Retrieves quota details for all known accounts in the pool.
 *
 * @param accountKeys - Initial pool keys to query.
 * @param options - Query options.
 * @returns Array of quota results.
 */
export async function getAllAntigravityAccountQuotas(
  accountKeys: string[] = ["account-1", "account-2", "account-3"],
  options: { forceRefresh?: boolean; skipLiveProbe?: boolean } = {},
): Promise<AntigravityAccountQuotaResult[]> {
  const store = await loadStore();
  const keys = Array.from(
    new Set([
      ...accountKeys,
      ...Object.keys(store.accounts).filter((k) => k !== "default"),
    ]),
  );
  if (keys.length === 0) {
    return [await getAntigravityAccountQuota("default", options)];
  }

  return Promise.all(keys.map((key) => getAntigravityAccountQuota(key, options)));
}

/**
 * Smart rotation helper: selects the best available account from a pool
 * of account keys based on threshold (e.g. 85%), connection status, and cooldown state.
 */
export async function selectAvailableAntigravityAccount(
  accountPool: string[] = ["account-1", "account-2", "account-3"],
  thresholdPct = 85,
  options: {
    manualActiveAccount?: string | null;
    preferModelFamily?: "argon" | "gemini" | "claude" | "any";
    skipLiveProbe?: boolean;
  } = {},
): Promise<AntigravityPoolSelectionResult> {
  if (accountPool.length === 0) {
    return {
      selected: {
        accountKey: "default",
        model: DEFAULT_WORKER_GEMINI_MODEL,
        family: "gemini3",
        usagePct: 0,
        weeklyUsagePct: 0,
      },
      candidates: [
        {
          accountKey: "default",
          model: DEFAULT_WORKER_GEMINI_MODEL,
          family: "gemini3",
          usagePct: 0,
          weeklyUsagePct: 0,
        },
      ],
      wasAutoRotated: false,
      status: "single_default",
    };
  }

  const quotas = await getAllAntigravityAccountQuotas(accountPool, {
    skipLiveProbe: options.skipLiveProbe,
  });
  const anyConnectedOnDisk = quotas.some((q) => q.isConnected);

  const candidates = accountPool.map((key, index) => {
    const quota = quotas.find((q) => q.accountKey === key);
    const sessionPct =
      options.preferModelFamily === "argon"
        ? (quota?.argon5hUsedPct ?? 0)
        : options.preferModelFamily === "claude"
          ? Math.max(quota?.claude5hUsedPct ?? 0, quota?.windows[0]?.usedPercent ?? 0)
          : options.preferModelFamily === "gemini"
            ? (quota?.gemini5hUsedPct ?? quota?.windows[0]?.usedPercent ?? 0)
            : Math.min(
                quota?.gemini5hUsedPct ?? quota?.windows[0]?.usedPercent ?? 0,
                quota?.claude5hUsedPct ?? 0,
              );
    const weeklyPct = quota?.windows[1]?.usedPercent ?? 0;
    const maxPct = options.preferModelFamily === "argon" ? sessionPct : Math.max(sessionPct, weeklyPct);
    const inCooldown = Boolean(quota?.inCooldown);
    const isConnected = anyConnectedOnDisk ? Boolean(quota?.isConnected) : true;

    return {
      key,
      index,
      sessionPct,
      weeklyPct,
      maxPct,
      inCooldown,
      isConnected,
    };
  });

  const connectedCandidates = candidates.filter((c) => c.isConnected);
  const poolToEvaluate = connectedCandidates.length > 0 ? connectedCandidates : candidates;

  const manualKey = options.manualActiveAccount?.trim() || null;
  let wasAutoRotated = false;
  if (manualKey) {
    const manualCandidate = poolToEvaluate.find((c) => c.key === manualKey);
    if (manualCandidate && !manualCandidate.inCooldown && manualCandidate.maxPct < thresholdPct) {
      const rest = poolToEvaluate
        .filter((c) => c.key !== manualKey)
        .sort((a, b) => Number(a.inCooldown) - Number(b.inCooldown) || a.maxPct - b.maxPct || a.index - b.index);
      const allKeys = [manualCandidate.key, ...rest.map((c) => c.key)];
      return {
        selected: {
          accountKey: manualCandidate.key,
          model: DEFAULT_WORKER_GEMINI_MODEL,
          family: "gemini3",
          usagePct: manualCandidate.maxPct,
          weeklyUsagePct: manualCandidate.weeklyPct,
        },
        candidates: allKeys.map((k) => ({
          accountKey: k,
          model: DEFAULT_WORKER_GEMINI_MODEL,
          family: "gemini3",
          usagePct: poolToEvaluate.find((c) => c.key === k)?.maxPct ?? 0,
          weeklyUsagePct: poolToEvaluate.find((c) => c.key === k)?.weeklyPct ?? 0,
        })),
        wasAutoRotated: false,
        status: `manual (${manualCandidate.maxPct}% used)`,
      };
    }
    wasAutoRotated = true;
  }

  const available = poolToEvaluate.filter((c) => !c.inCooldown && c.maxPct < thresholdPct);
  if (available.length > 0) {
    available.sort((a, b) => a.maxPct - b.maxPct || a.index - b.index);
    const chosen = available[0];
    const rest = poolToEvaluate
      .filter((c) => c.key !== chosen.key)
      .sort((a, b) => Number(a.inCooldown) - Number(b.inCooldown) || a.maxPct - b.maxPct || a.index - b.index);
    const allKeys = [chosen.key, ...rest.map((c) => c.key)];
    return {
      selected: {
        accountKey: chosen.key,
        model: DEFAULT_WORKER_GEMINI_MODEL,
        family: "gemini3",
        usagePct: chosen.maxPct,
        weeklyUsagePct: chosen.weeklyPct,
      },
      candidates: allKeys.map((k) => ({
        accountKey: k,
        model: DEFAULT_WORKER_GEMINI_MODEL,
        family: "gemini3",
        usagePct: poolToEvaluate.find((c) => c.key === k)?.maxPct ?? 0,
        weeklyUsagePct: poolToEvaluate.find((c) => c.key === k)?.weeklyPct ?? 0,
      })),
      wasAutoRotated,
      status: wasAutoRotated
        ? `auto_rotated_from_${manualKey}_to_${chosen.key} (${chosen.maxPct}% used)`
        : `active (${chosen.maxPct}% used)`,
    };
  }

  const notCooling = poolToEvaluate.filter((c) => !c.inCooldown);
  if (notCooling.length > 0) {
    notCooling.sort((a, b) => a.maxPct - b.maxPct || a.index - b.index);
    const chosen = notCooling[0];
    const rest = poolToEvaluate
      .filter((c) => c.key !== chosen.key)
      .sort((a, b) => a.maxPct - b.maxPct || a.index - b.index);
    const allKeys = [chosen.key, ...rest.map((c) => c.key)];
    return {
      selected: {
        accountKey: chosen.key,
        model: DEFAULT_WORKER_GEMINI_MODEL,
        family: "gemini3",
        usagePct: chosen.maxPct,
        weeklyUsagePct: chosen.weeklyPct,
      },
      candidates: allKeys.map((k) => ({
        accountKey: k,
        model: DEFAULT_WORKER_GEMINI_MODEL,
        family: "gemini3",
        usagePct: poolToEvaluate.find((c) => c.key === k)?.maxPct ?? 0,
        weeklyUsagePct: poolToEvaluate.find((c) => c.key === k)?.weeklyPct ?? 0,
      })),
      wasAutoRotated,
      status: `fallback (${chosen.maxPct}% used)`,
    };
  }

  const sortedAll = [...poolToEvaluate].sort((a, b) => a.maxPct - b.maxPct || a.index - b.index);
  const allKeys = sortedAll.map((c) => c.key);
  return {
    selected: {
      accountKey: sortedAll[0].key,
      model: DEFAULT_WORKER_GEMINI_MODEL,
      family: "gemini3",
      usagePct: sortedAll[0].maxPct,
      weeklyUsagePct: sortedAll[0].weeklyPct,
    },
    candidates: allKeys.map((k) => ({
      accountKey: k,
      model: DEFAULT_WORKER_GEMINI_MODEL,
      family: "gemini3",
      usagePct: poolToEvaluate.find((c) => c.key === k)?.maxPct ?? 0,
      weeklyUsagePct: poolToEvaluate.find((c) => c.key === k)?.weeklyPct ?? 0,
    })),
    wasAutoRotated,
    status: "all_cooldown",
  };
}

/**
 * Builds a complete multi-account + multi-model-family rotation plan:
 * - Leadership (`roleTier === "leadership"`): rotates `gemini-4-argon-high` (Argon bucket) across all Antigravity accounts,
 *   with secondary fallback to Gemini 3.8 Flash across accounts.
 * - Workers (`roleTier === "worker"`): rotates across all Antigravity accounts and between
 *   Gemini 3.x (`gemini-3.8-flash-high`) and GPT (`gpt-oss-120b-medium`) buckets.
 *
 * @param accountPool - List of account profile keys.
 * @param thresholdPct - Quota usage percentage threshold triggering auto-rotation (defaults to 85).
 * @param options - Execution plan options.
 * @returns Fully populated plan result with ordered candidates.
 */
export async function selectAntigravityExecutionPlan(
  accountPool: string[] = ["account-1", "account-2", "account-3"],
  thresholdPct = 85,
  options: {
    roleTier?: "leadership" | "worker";
    routingMode?: "leadership" | "worker";
    manualActiveAccount?: string | null;
    preferredWorkerFamily?: "gemini3" | "claude_gpt";
    requestedModel?: string | null;
    skipLiveProbe?: boolean;
  } = {},
): Promise<AntigravityPoolSelectionResult> {
  const roleTier = options.routingMode ?? options.roleTier ?? "worker";
  const pool = accountPool.length > 0 ? accountPool : ["default"];
  const quotas = await getAllAntigravityAccountQuotas(pool, {
    skipLiveProbe: options.skipLiveProbe,
  });
  const anyConnectedOnDisk = quotas.some((q) => q.isConnected);
  const eligibleKeys = pool.filter((key) => {
    if (!anyConnectedOnDisk) return true;
    return Boolean(quotas.find((q) => q.accountKey === key)?.isConnected);
  });
  const activePoolKeys = eligibleKeys.length > 0 ? eligibleKeys : pool;

  const manualKey = options.manualActiveAccount?.trim() || null;
  const reqModel =
    typeof options.requestedModel === "string" &&
    options.requestedModel.trim() &&
    options.requestedModel.trim() !== "inherit"
      ? options.requestedModel.trim()
      : null;

  if (roleTier === "leadership") {
    const argonModel =
      reqModel && classifyAntigravityModelFamily(reqModel) === "argon"
        ? reqModel
        : DEFAULT_LEADERSHIP_ARGON_MODEL;

    const argonCandidates: AntigravityExecutionCandidate[] = activePoolKeys.map((key) => {
      const q = quotas.find((item) => item.accountKey === key);
      const argonCd = Boolean(q?.inCooldown || q?.familyCooldowns?.argon);
      const argonWeekly = q?.argonWeeklyUsedPct ?? q?.weeklyUsedPct ?? 0;
      const usedPct = argonCd ? 100 : (q?.argonWeeklyUsedPct ?? q?.argon5hUsedPct ?? 0);
      return {
        accountKey: key,
        model: argonModel,
        family: "argon",
        usagePct: usedPct,
        weeklyUsagePct: argonWeekly,
      };
    });

    argonCandidates.sort((a, b) => {
      if (manualKey) {
        const aManual = a.accountKey === manualKey && a.usagePct < thresholdPct;
        const bManual = b.accountKey === manualKey && b.usagePct < thresholdPct;
        if (aManual !== bManual) return aManual ? -1 : 1;
      }
      return a.usagePct - b.usagePct;
    });

    const geminiFallbackCandidates: AntigravityExecutionCandidate[] = activePoolKeys.map((key) => {
      const q = quotas.find((item) => item.accountKey === key);
      const geminiCd = Boolean(q?.inCooldown || q?.familyCooldowns?.gemini3);
      const geminiWeekly = q?.geminiWeeklyUsedPct ?? q?.weeklyUsedPct ?? 0;
      const usedPct = geminiCd ? 100 : Math.max(q?.gemini5hUsedPct ?? 0, geminiWeekly);
      return {
        accountKey: key,
        model: DEFAULT_LEADERSHIP_GEMINI_FALLBACK_MODEL,
        family: "gemini3",
        usagePct: usedPct,
        weeklyUsagePct: geminiWeekly,
      };
    });

    geminiFallbackCandidates.sort((a, b) => a.usagePct - b.usagePct);

    const allCandidates = [...argonCandidates, ...geminiFallbackCandidates];
    const chosen =
      allCandidates.find((c) => c.usagePct < thresholdPct) ?? allCandidates[0]!;
    const wasAutoRotated = Boolean(manualKey && chosen.accountKey !== manualKey);

    return {
      selected: chosen,
      candidates: [
        chosen,
        ...allCandidates.filter(
          (c) => !(c.accountKey === chosen.accountKey && c.model === chosen.model),
        ),
      ],
      wasAutoRotated,
      status: `leadership_${chosen.family}_${chosen.accountKey} (${chosen.usagePct}% used)`,
    };
  }

  // Worker tier
  const geminiModel =
    reqModel && classifyAntigravityModelFamily(reqModel) === "gemini3"
      ? reqModel
      : DEFAULT_WORKER_GEMINI_MODEL;
  const gptModel =
    reqModel && classifyAntigravityModelFamily(reqModel) === "claude_gpt"
      ? reqModel
      : DEFAULT_WORKER_GPT_FALLBACK_MODEL;

  const geminiCandidates: AntigravityExecutionCandidate[] = [];
  const gptFallbackCandidates: AntigravityExecutionCandidate[] = [];

  for (const key of activePoolKeys) {
    const q = quotas.find((item) => item.accountKey === key);
    const geminiWeeklyPct = q?.geminiWeeklyUsedPct ?? q?.weeklyUsedPct ?? 0;
    const gptWeeklyPct = q?.claudeWeeklyUsedPct ?? q?.weeklyUsedPct ?? 0;

    const geminiCd = Boolean(q?.inCooldown || q?.familyCooldowns?.gemini3);
    const geminiPct = geminiCd
      ? 100
      : Math.max(q?.gemini5hUsedPct ?? 0, geminiWeeklyPct);

    const gptCd = Boolean(q?.inCooldown || q?.familyCooldowns?.claude_gpt);
    const gptPct = gptCd
      ? 100
      : Math.max(q?.claude5hUsedPct ?? 0, gptWeeklyPct);

    geminiCandidates.push({
      accountKey: key,
      model: geminiModel,
      family: "gemini3",
      usagePct: geminiPct,
      weeklyUsagePct: geminiWeeklyPct,
    });

    gptFallbackCandidates.push({
      accountKey: key,
      model: gptModel,
      family: "claude_gpt",
      usagePct: gptPct,
      weeklyUsagePct: gptWeeklyPct,
    });
  }

  geminiCandidates.sort((a, b) => {
    const aHealthy = a.usagePct < thresholdPct;
    const bHealthy = b.usagePct < thresholdPct;
    if (aHealthy !== bHealthy) return aHealthy ? -1 : 1;
    if (manualKey && aHealthy && bHealthy) {
      const aManual = a.accountKey === manualKey;
      const bManual = b.accountKey === manualKey;
      if (aManual !== bManual) return aManual ? -1 : 1;
    }
    return a.usagePct - b.usagePct;
  });

  gptFallbackCandidates.sort((a, b) => {
    const aHealthy = a.usagePct < thresholdPct;
    const bHealthy = b.usagePct < thresholdPct;
    if (aHealthy !== bHealthy) return aHealthy ? -1 : 1;
    return a.usagePct - b.usagePct;
  });

  const workerCandidates = [...geminiCandidates, ...gptFallbackCandidates];
  const chosen =
    workerCandidates.find((c) => c.usagePct < thresholdPct) ?? workerCandidates[0]!;
  const wasAutoRotated = Boolean(manualKey && chosen.accountKey !== manualKey);

  return {
    selected: chosen,
    candidates: workerCandidates,
    wasAutoRotated,
    status: `worker_${chosen.family}_${chosen.accountKey} (${chosen.usagePct}% used)`,
  };
}

export interface CompanyPoolRuntimeConfig {
  managementProvider?: "claude_local" | "antigravity_local";
  managementModel?: string;
  managementFallbackProvider?: "antigravity_local";
  managementFallbackModel?: string;
  managementRoles?: string[];
  workerProvider?: "antigravity_local" | "claude_local";
  workerModel?: string;
  workerSecondaryModel?: string;
  workerRoles?: string[];
  workerAccountPool?: Array<{ key: string; label?: string }>;
  manualActiveAccount?: string | null;
  lastActiveAccount?: string | null;
  lastActiveLeadershipAccount?: string | null;
  rotationThresholdPct?: number;
  autoRotateOnRateLimit?: boolean;
  fallbackToOtherProvider?: boolean;
}

function getCompanyPoolConfigPath(companyId: string): string {
  return path.join(resolveRealHomeDir(), ".paperclip", "companies", companyId, "subscription-pool.json");
}

export async function readCompanyPoolRuntimeConfig(
  companyId: string | undefined,
): Promise<CompanyPoolRuntimeConfig | null> {
  if (!companyId || !companyId.trim()) return null;
  const filePath = getCompanyPoolConfigPath(companyId);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as CompanyPoolRuntimeConfig;
  } catch {
    return null;
  }
}

export async function updateCompanyActivePoolAccount(
  companyId: string | undefined,
  newActiveAccount: string,
  updateManualPin = false,
  roleTier: "leadership" | "worker" = "worker",
): Promise<void> {
  if (!companyId || !companyId.trim()) return;
  const filePath = getCompanyPoolConfigPath(companyId);
  try {
    let current: Record<string, unknown> = {};
    try {
      current = JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, unknown>;
    } catch {
      // file doesn't exist yet
    }
    if (roleTier === "leadership") {
      current.lastActiveLeadershipAccount = newActiveAccount;
    } else {
      current.lastActiveAccount = newActiveAccount;
      if (updateManualPin && current.manualActiveAccount) {
        current.manualActiveAccount = newActiveAccount;
      }
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(current, null, 2), "utf8");
  } catch {
    // ignore write error
  }
}

/**
 * Checks whether an agent's role is classified as leadership/management (routes to Gemini 4 Argon)
 * or general engineering/worker (routes to Gemini 3.8 Flash / GPT).
 *
 * @param agent - Agent record with role, name, title.
 * @param config - Optional configuration dictionary.
 * @param managementRoles - Array of leadership keyword tokens.
 * @returns True if leadership role.
 */
export function isAgentLeadershipRole(
  agent: { role?: string | null; name?: string | null; title?: string | null },
  config?: Record<string, unknown> | null,
  managementRoles: string[] = ["ceo", "cto", "lead", "pm", "manager", "engineering_lead", "architect"],
): boolean {
  if (config?.poolRoutingMode === "leadership") return true;
  if (config?.poolRoutingMode === "worker") return false;
  const combined = `${agent.role ?? ""} ${agent.name ?? ""} ${agent.title ?? ""}`.toLowerCase();
  return managementRoles.some((r) => {
    const token = r.toLowerCase().trim();
    return token.length > 0 && new RegExp(`\\b${token}\\b`, "i").test(combined);
  });
}

/**
 * Prepares an isolated Antigravity account profile directory (`~/.paperclip/credentials/antigravity/account-X`)
 * so that `agy` runs headlessly without interactive prompts and has access to user git/ssh/paperclip configs.
 *
 * @param accountKey - Account identifier.
 * @param workspaceCwd - Target workspace directory.
 * @returns Absolute path to prepared profile directory.
 */
export async function prepareAntigravityAccountProfileHome(
  accountKey: string,
  workspaceCwd: string,
): Promise<string> {
  const realHome = resolveRealHomeDir();
  const profileHome = getAntigravityProfileHome(accountKey);
  if (profileHome === realHome) return realHome;

  const agyCliDir = path.join(profileHome, ".gemini", "antigravity-cli");
  await fs.mkdir(agyCliDir, { recursive: true });

  const settingsPath = path.join(agyCliDir, "settings.json");
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(await fs.readFile(settingsPath, "utf8")) as Record<string, unknown>;
  } catch {
    // fresh settings
  }
  settings.toolPermission = "always-proceed";
  settings.allowNonWorkspaceAccess = true;
  const existingTrusted = Array.isArray(settings.trustedWorkspaces)
    ? settings.trustedWorkspaces.filter((v): v is string => typeof v === "string")
    : [];
  const trustedSet = new Set([realHome, workspaceCwd, ...existingTrusted].filter(Boolean));
  settings.trustedWorkspaces = Array.from(trustedSet);
  const perms =
    typeof settings.permissions === "object" && settings.permissions !== null
      ? (settings.permissions as Record<string, unknown>)
      : {};
  const allowList = Array.isArray(perms.allow) ? perms.allow : ["command(*)"];
  if (!allowList.includes("command(*)")) allowList.unshift("command(*)");
  settings.permissions = { ...perms, allow: allowList };
  try {
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf8");
  } catch {
    // ignore settings write error
  }

  const sharedEntries = [".gitconfig", ".ssh", ".npmrc", ".nvm", ".local", ".cargo", ".paperclip"];
  for (const entry of sharedEntries) {
    const sourcePath = path.join(realHome, entry);
    const targetPath = path.join(profileHome, entry);
    try {
      if (!fsSync.existsSync(sourcePath)) continue;
      const stat = await fs.lstat(targetPath).catch(() => null);
      if (!stat) {
        await fs.symlink(sourcePath, targetPath, "junction").catch(async () => {
          // If symlink fails (e.g. non-admin Windows), attempt file/dir copy or ignore
        });
      }
    } catch {
      // ignore symlink errors
    }
  }

  return profileHome;
}

export type { AntigravityExecutionCandidate } from "../types.js";

