/**
 * @fileoverview Unit tests for constants, model mappings, and alias resolution.
 *
 * @copyright Antigravity Adapter Contributors
 * @license MIT
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_ANTIGRAVITY_LOCAL_MODEL,
  DEFAULT_LEADERSHIP_ARGON_MODEL,
  DEFAULT_WORKER_GEMINI_MODEL,
  DEFAULT_WORKER_GPT_FALLBACK_MODEL,
} from "../../src/constants.js";
import { models, resolveAntigravityModel } from "../../src/index.js";

describe("constants and model resolution", () => {
  it("defines modern default models", () => {
    expect(DEFAULT_ANTIGRAVITY_LOCAL_MODEL).toBe("gemini-3.8-flash-high");
    expect(DEFAULT_LEADERSHIP_ARGON_MODEL).toBe("gemini-4-argon-high");
    expect(DEFAULT_WORKER_GEMINI_MODEL).toBe("gemini-3.8-flash-high");
    expect(DEFAULT_WORKER_GPT_FALLBACK_MODEL).toBe("gpt-oss-120b-medium");
  });

  it("resolves model aliases correctly", () => {
    expect(resolveAntigravityModel("pro")).toBe("gemini-4-argon-high");
    expect(resolveAntigravityModel("flash")).toBe("gemini-3.8-flash-medium");
    expect(resolveAntigravityModel("flash_lite")).toBe("gemini-3.8-flash-low");
  });

  it("resolves explicitly configured models directly without alias substitution if not in alias map", () => {
    expect(resolveAntigravityModel("claude-opus-5-5-high")).toBe("claude-opus-5-5-high");
    expect(resolveAntigravityModel("gemini-4-argon-high")).toBe("gemini-4-argon-high");
  });

  it("falls back to ANTIGRAVITY_MODEL environment variable if config model is empty", () => {
    expect(resolveAntigravityModel("", { ANTIGRAVITY_MODEL: "pro" })).toBe("gemini-4-argon-high");
    expect(resolveAntigravityModel(null, { ANTIGRAVITY_MODEL: "claude-sonnet-5-5-high" })).toBe("claude-sonnet-5-5-high");
  });

  it("falls back to DEFAULT_ANTIGRAVITY_LOCAL_MODEL when nothing is configured", () => {
    expect(resolveAntigravityModel("")).toBe("gemini-3.8-flash-high");
    expect(resolveAntigravityModel(null)).toBe("gemini-3.8-flash-high");
    expect(resolveAntigravityModel(undefined, {})).toBe("gemini-3.8-flash-high");
  });

  it("includes all key model definitions in models catalog", () => {
    const ids = models.map((m) => m.id);
    expect(ids).toContain("inherit");
    expect(ids).toContain("gemini-4-argon-high");
    expect(ids).toContain("gemini-3.8-flash-high");
    expect(ids).toContain("claude-opus-5-5-high");
    expect(ids).toContain("claude-sonnet-5-5-high");
    expect(ids).toContain("gpt-oss-120b-medium");
  });
});
