import { describe, expect, it } from "vitest";
import {
  isAntigravityUnknownSessionError,
  detectAntigravityAuthRequired,
  detectAntigravityQuotaExhausted,
  isAntigravityTurnLimitResult,
  describeAntigravityFailure,
} from "../../src/server/parse.js";

/**
 * Unit test suite for Antigravity stdout/stderr telemetry and error parsers.
 * Validates extraction of authentication needs, quota status, turn limits, and failure reasons.
 */
describe("parse server helpers", () => {
  
  /**
   * Tests for session resume failure detection.
   * Assures that unknown conversation patterns in logs trigger a session clear fallback.
   */
  describe("isAntigravityUnknownSessionError", () => {
    it("detects unknown conversation error messages", () => {
      expect(isAntigravityUnknownSessionError("", "unknown conversation")).toBe(true);
      expect(isAntigravityUnknownSessionError("failed to resume conversation", "")).toBe(true);
      expect(isAntigravityUnknownSessionError("some other error", "")).toBe(false);
    });

    it("handles complex case-insensitive and spacing variations for unknown conversation errors", () => {
      expect(isAntigravityUnknownSessionError("", "UNKNOWN   CONVERSATION")).toBe(true);
      expect(isAntigravityUnknownSessionError("CONVERSATION  some-id-123   NOT   FOUND", "")).toBe(true);
      expect(isAntigravityUnknownSessionError("", "cannot\nresume\n")).toBe(true);
    });
  });

  /**
   * Tests for authentication requirement detection.
   * Asserts the identification of credentials missing or login required errors in logs.
   */
  describe("detectAntigravityAuthRequired", () => {
    it("detects when authentication is required", () => {
      expect(detectAntigravityAuthRequired({ stdout: "", stderr: "please authenticate first" })).toEqual({ requiresAuth: true });
      expect(detectAntigravityAuthRequired({ stdout: "not authenticated", stderr: "" })).toEqual({ requiresAuth: true });
      expect(detectAntigravityAuthRequired({ stdout: "success", stderr: "" })).toEqual({ requiresAuth: false });
    });

    it("matches advanced credential missing messages including key syntax and custom CLI run strings", () => {
      expect(detectAntigravityAuthRequired({ stdout: "", stderr: "api_key required" })).toEqual({ requiresAuth: true });
      expect(detectAntigravityAuthRequired({ stdout: "unauthorized request", stderr: "" })).toEqual({ requiresAuth: true });
      expect(detectAntigravityAuthRequired({ stdout: "", stderr: "please run `agy auth login` first" })).toEqual({ requiresAuth: true });
    });
  });

  /**
   * Tests for API quota exhaustion detection.
   * Ensures that 429 errors or resource exhaustion warnings trigger quota warnings in Paperclip.
   */
  describe("detectAntigravityQuotaExhausted", () => {
    it("detects quota errors", () => {
      expect(detectAntigravityQuotaExhausted({ stdout: "", stderr: "quota exceeded" })).toEqual({ exhausted: true });
      expect(detectAntigravityQuotaExhausted({ stdout: "resource_exhausted", stderr: "" })).toEqual({ exhausted: true });
      expect(detectAntigravityQuotaExhausted({ stdout: "normal text", stderr: "" })).toEqual({ exhausted: false });
    });

    it("matches rate limits, quota exhaustions and HTTP 429 errors", () => {
      expect(detectAntigravityQuotaExhausted({ stdout: "rate-limit exceeded", stderr: "" })).toEqual({ exhausted: true });
      expect(detectAntigravityQuotaExhausted({ stdout: "", stderr: "Error 429: Too Many Requests" })).toEqual({ exhausted: true });
      expect(detectAntigravityQuotaExhausted({ stdout: "please update your billing details", stderr: "" })).toEqual({ exhausted: true });
    });
  });

  /**
   * Tests for agent turn limit detections.
   * Checks for specific process exit codes (53) or max turn limits exceeded messages.
   */
  describe("isAntigravityTurnLimitResult", () => {
    it("detects turn limit", () => {
      expect(isAntigravityTurnLimitResult(53, "")).toBe(true);
      expect(isAntigravityTurnLimitResult(0, "max_turns reached")).toBe(true);
      expect(isAntigravityTurnLimitResult(1, "some error")).toBe(false);
    });

    it("handles undefined or null exitCode and stderr boundaries gracefully", () => {
      expect(isAntigravityTurnLimitResult(undefined, "turn_limit_exceeded")).toBe(true);
      expect(isAntigravityTurnLimitResult(null, "Max turns hit")).toBe(false);
      expect(isAntigravityTurnLimitResult(null, undefined)).toBe(false);
      expect(isAntigravityTurnLimitResult(undefined, undefined)).toBe(false);
    });
  });

  /**
   * Tests for failure descriptions formatting.
   * Verifies the clean output of failure messages extracted from stderr logs.
   */
  describe("describeAntigravityFailure", () => {
    it("describes failures correctly", () => {
      expect(describeAntigravityFailure("stdout", "stderr error")).toBe("Antigravity run failed: stderr error");
      expect(describeAntigravityFailure("", "")).toBeNull();
    });

    it("filters out empty lines and returns the first meaningful failure line", () => {
      const complexStderr = "\n\n  \nActual error message here \nAnother trace line";
      expect(describeAntigravityFailure("", complexStderr)).toBe("Antigravity run failed: Actual error message here");
    });
  });
});
