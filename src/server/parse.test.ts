import { describe, expect, it } from "vitest";
import {
  isAntigravityUnknownSessionError,
  detectAntigravityAuthRequired,
  detectAntigravityQuotaExhausted,
  isAntigravityTurnLimitResult,
  describeAntigravityFailure,
} from "./parse.js";

describe("parse server helpers", () => {
  describe("isAntigravityUnknownSessionError", () => {
    it("detects unknown conversation error messages", () => {
      expect(isAntigravityUnknownSessionError("", "unknown conversation")).toBe(true);
      expect(isAntigravityUnknownSessionError("failed to resume conversation", "")).toBe(true);
      expect(isAntigravityUnknownSessionError("some other error", "")).toBe(false);
    });
  });

  describe("detectAntigravityAuthRequired", () => {
    it("detects when authentication is required", () => {
      expect(detectAntigravityAuthRequired({ stdout: "", stderr: "please authenticate first" })).toEqual({ requiresAuth: true });
      expect(detectAntigravityAuthRequired({ stdout: "not authenticated", stderr: "" })).toEqual({ requiresAuth: true });
      expect(detectAntigravityAuthRequired({ stdout: "success", stderr: "" })).toEqual({ requiresAuth: false });
    });
  });

  describe("detectAntigravityQuotaExhausted", () => {
    it("detects quota errors", () => {
      expect(detectAntigravityQuotaExhausted({ stdout: "", stderr: "quota exceeded" })).toEqual({ exhausted: true });
      expect(detectAntigravityQuotaExhausted({ stdout: "resource_exhausted", stderr: "" })).toEqual({ exhausted: true });
      expect(detectAntigravityQuotaExhausted({ stdout: "normal text", stderr: "" })).toEqual({ exhausted: false });
    });
  });

  describe("isAntigravityTurnLimitResult", () => {
    it("detects turn limit", () => {
      expect(isAntigravityTurnLimitResult(53, "")).toBe(true);
      expect(isAntigravityTurnLimitResult(0, "max_turns reached")).toBe(true);
      expect(isAntigravityTurnLimitResult(1, "some error")).toBe(false);
    });
  });

  describe("describeAntigravityFailure", () => {
    it("describes failures correctly", () => {
      expect(describeAntigravityFailure("stdout", "stderr error")).toBe("Antigravity run failed: stderr error");
      expect(describeAntigravityFailure("", "")).toBeNull();
    });
  });
});
