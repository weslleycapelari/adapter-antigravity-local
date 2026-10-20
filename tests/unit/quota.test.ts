/**
 * @fileoverview Unit test suite for quota calculations, account pooling, model families, and execution plans.
 *
 * @copyright Antigravity Adapter Contributors
 * @license MIT
 */

import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  calculateAccountQuotaWindows,
  resolveRealHomeDir,
  getAntigravityProfileHome,
  classifyAntigravityModelFamily,
  isAgentLeadershipRole,
  selectAntigravityExecutionPlan,
  setAntigravityCooldown,
  clearAntigravityCooldown,
  DEFAULT_LEADERSHIP_ARGON_MODEL,
  DEFAULT_WORKER_GEMINI_MODEL,
} from "../../src/server/quota.js";
import type { AccountQuotaState, LiveCloudCodeQuota } from "../../src/types.js";

describe("Antigravity Quota and Account Pooling", () => {
  describe("calculateAccountQuotaWindows", () => {
    it("calculates 5-hour, 7-day, and Gemini 4 Argon usage percentage from events when live quota is unavailable", async () => {
      const now = Date.now();
      const accountState: AccountQuotaState = {
        accountKey: "test-account-1",
        accountLabel: "Antigravity Pro Test #1",
        events: [
          {
            timestamp: now - 1000 * 60 * 30, // 30 mins ago
            inputTokens: 50_000,
            outputTokens: 10_000,
            totalTokens: 60_000,
            success: true,
          },
          {
            timestamp: now - 1000 * 60 * 60 * 2, // 2 hours ago
            inputTokens: 40_000,
            outputTokens: 10_000,
            totalTokens: 50_000,
            success: true,
          },
        ],
        cooldownUntil: null,
        cooldownReason: null,
        customSessionLimitTokens: 200_000,
        customWeeklyLimitTokens: 1_000_000,
      };

      const windows = await calculateAccountQuotaWindows(accountState, now, null);
      expect(windows).toHaveLength(3);

      // 5h window: 110,000 / 200,000 = 55%
      expect(windows[0].label).toBe("5h (Sessão)");
      expect(windows[0].usedPercent).toBe(55);
      expect(windows[0].resetsAt).not.toBeNull();

      // 7d window: 110,000 / 1,000,000 = 11%
      expect(windows[1].label).toBe("7d (Semanal)");
      expect(windows[1].usedPercent).toBe(11);

      // 3rd window: Gemini 4 Argon separate bucket
      expect(windows[2].label).toBe("Gemini 4 Argon (Semanal · Liderança)");
      expect(windows[2].usedPercent).toBe(0);
    });

    it("prefers real Google Cloud Code live quota percentages and reset times when available", async () => {
      const now = Date.now();
      const accountState: AccountQuotaState = {
        accountKey: "test-account-live",
        accountLabel: "Antigravity Pro Live",
        events: [],
        cooldownUntil: null,
        cooldownReason: null,
      };

      const liveQuota: LiveCloudCodeQuota = {
        ok: true,
        email: "user@example.com",
        tierId: "g1-pro-tier",
        tierName: "Google AI Pro",
        projectId: "test-proj",
        argon5hUsedPct: 5,
        argon5hResetsAt: "2026-10-16T16:07:39Z",
        gemini5hUsedPct: 25,
        gemini5hResetsAt: "2026-10-16T16:07:39Z",
        claude5hUsedPct: 10,
        claude5hResetsAt: "2026-10-16T16:07:39Z",
        weeklyUsedPct: 12,
        weeklyResetsAt: "2026-10-21T16:07:39Z",
        capturedAt: new Date(now).toISOString(),
      };

      const windows = await calculateAccountQuotaWindows(accountState, now, liveQuota);
      expect(windows).toHaveLength(3);
      expect(windows[0].usedPercent).toBe(25);
      expect(windows[0].resetsAt).toBe("2026-10-16T16:07:39Z");
      expect(windows[0].detail).toContain("Argon: 5.00% | Gemini 3.x: 25.00% | Claude/GPT: 10.00%");
      expect(windows[1].usedPercent).toBe(12);
      expect(windows[1].resetsAt).toBe("2026-10-21T16:07:39Z");
      expect(windows[2].label).toBe("Gemini 4 Argon (Semanal · Liderança)");
      expect(windows[2].usedPercent).toBe(5);
    });

    it("reflects active cooldown in the session window", async () => {
      const now = Date.now();
      const cooldownTime = now + 1000 * 60 * 60; // 1 hour in future
      const accountState: AccountQuotaState = {
        accountKey: "test-account-cd",
        accountLabel: "Antigravity Pro Test CD",
        events: [],
        cooldownUntil: cooldownTime,
        cooldownReason: "429 Rate limit",
      };

      const windows = await calculateAccountQuotaWindows(accountState, now, null);
      expect(windows[0].usedPercent).toBe(95);
      expect(windows[0].resetsAt).toBe(new Date(cooldownTime).toISOString());
    });
  });

  describe("directory resolution", () => {
    it("resolves real home directory without nesting .paperclip credential paths", () => {
      const realHome = resolveRealHomeDir();
      expect(realHome).not.toContain(`${path.sep}.paperclip${path.sep}credentials${path.sep}antigravity`);
      const profileHome = getAntigravityProfileHome("account-2");
      expect(profileHome).toContain("account-2");
    });
  });

  describe("model classification and leadership routing", () => {
    it("classifies model families correctly", () => {
      expect(classifyAntigravityModelFamily("gemini-4-argon-high")).toBe("argon");
      expect(classifyAntigravityModelFamily("pro")).toBe("argon");
      expect(classifyAntigravityModelFamily("gemini-3.8-flash-high")).toBe("gemini3");
      expect(classifyAntigravityModelFamily("claude-sonnet-5-5-high")).toBe("claude_gpt");
      expect(classifyAntigravityModelFamily("gpt-oss-120b-medium")).toBe("claude_gpt");
    });

    it("identifies leadership vs worker agent roles", () => {
      expect(isAgentLeadershipRole({ name: "CEO", role: "general" })).toBe(true);
      expect(isAgentLeadershipRole({ name: "cto-architect", role: "cto" })).toBe(true);
      expect(isAgentLeadershipRole({ name: "Lead Dev", role: "developer" })).toBe(true);
      expect(isAgentLeadershipRole({ name: "Backend Dev", role: "engineer" })).toBe(false);
      expect(isAgentLeadershipRole({ name: "QA Tester", role: "tester" })).toBe(false);
    });
  });

  describe("selectAntigravityExecutionPlan", () => {
    it("prioritizes Argon for leadership roles and Gemini 3.8 Flash for worker roles", async () => {
      const testPool = ["pool-test-1", "pool-test-2", "pool-test-3"];
      await clearAntigravityCooldown("pool-test-1");
      await clearAntigravityCooldown("pool-test-2");
      await clearAntigravityCooldown("pool-test-3");

      const leadershipPlan = await selectAntigravityExecutionPlan(testPool, 85, {
        routingMode: "leadership",
        skipLiveProbe: true,
      });

      expect(leadershipPlan.selected.model).toBe(DEFAULT_LEADERSHIP_ARGON_MODEL);
      expect(leadershipPlan.selected.family).toBe("argon");

      const workerPlan = await selectAntigravityExecutionPlan(testPool, 85, {
        routingMode: "worker",
        skipLiveProbe: true,
      });

      expect(workerPlan.selected.model).toBe(DEFAULT_WORKER_GEMINI_MODEL);
      expect(workerPlan.selected.family).toBe("gemini3");
    });

    it("rotates away from an account when it is in cooldown", async () => {
      const testPool = ["pool-cd-1", "pool-cd-2"];
      await setAntigravityCooldown("pool-cd-1", Date.now() + 60_000, "Rate limit test");
      await clearAntigravityCooldown("pool-cd-2");

      const plan = await selectAntigravityExecutionPlan(testPool, 85, {
        routingMode: "worker",
        manualActiveAccount: "pool-cd-1",
        skipLiveProbe: true,
      });

      expect(plan.selected.accountKey).toBe("pool-cd-2");
      expect(plan.wasAutoRotated).toBe(true);
    });
  });
});
