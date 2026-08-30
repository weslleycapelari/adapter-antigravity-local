import { describe, expect, it } from "vitest";
import { modelProfiles, models } from "../../src/index.js";

const EXPECTED_GEMINI_IDS = [
  "gemini-3.7-flash-high",
  "gemini-3.7-flash-medium",
  "gemini-3.7-flash-low",
  "gemini-3.6-flash-high",
  "gemini-3.6-flash-medium",
  "gemini-3.6-flash-low",
  "gemini-3.5-flash-high",
  "gemini-3.5-flash-medium",
  "gemini-3.5-flash-low",
  "gemini-3.1-pro-high",
  "gemini-3.1-pro-low",
] as const;

describe("Antigravity model registry", () => {
  it("includes current Gemini Antigravity model ids with labels", () => {
    const byId = new Map(models.map((m) => [m.id, m]));
    for (const id of EXPECTED_GEMINI_IDS) {
      const entry = byId.get(id);
      expect(entry, `missing model id: ${id}`).toBeDefined();
      expect(entry!.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("drops the stale gemini-3.5-flash id", () => {
    expect(models.some((m) => m.id === "gemini-3.5-flash")).toBe(false);
  });

  it("points the cheap profile at gemini-3.5-flash-medium", () => {
    const cheap = modelProfiles.find((p) => p.key === "cheap");
    expect(cheap?.adapterConfig.model).toBe("gemini-3.5-flash-medium");
  });
});
