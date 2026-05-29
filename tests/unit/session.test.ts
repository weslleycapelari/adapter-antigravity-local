import { describe, expect, it } from "vitest";
import { sessionCodec, parseSessionParams } from "../../src/server/index.js";

/**
 * Unit test suite for Antigravity Session Codec and parameters parsing.
 * Validates deserialization, serialization, fallback resolutions, and display IDs.
 */
describe("session codec and params parser", () => {
  
  /**
   * Tests for the standalone parseSessionParams utility.
   * Asserts the resolution of standard session attributes under varying formats (camelCase, snake_case, etc.).
   */
  describe("parseSessionParams", () => {
    it("successfully parses valid session parameters with exact camelCase structure", () => {
      const input = {
        sessionId: "session-123",
        cwd: "/home/developer/workspace",
        workspaceId: "ws-abc",
        repoUrl: "git@github.com:weslleycapelari/project.git",
        repoRef: "main",
      };

      const result = parseSessionParams(input);
      expect(result).toEqual({
        sessionId: "session-123",
        cwd: "/home/developer/workspace",
        workspaceId: "ws-abc",
        repoUrl: "git@github.com:weslleycapelari/project.git",
        repoRef: "main",
      });
    });

    it("resolves parameters through snake_case and historical keys fallbacks", () => {
      const input = {
        session_id: "session-456",
        workdir: "/var/tmp/project",
        workspace_id: "ws-xyz",
        repo_url: "git@github.com:weslleycapelari/another.git",
        repo_ref: "dev",
      };

      const result = parseSessionParams(input);
      expect(result).toEqual({
        sessionId: "session-456",
        cwd: "/var/tmp/project",
        workspaceId: "ws-xyz",
        repoUrl: "git@github.com:weslleycapelari/another.git",
        repoRef: "dev",
      });
    });

    it("returns null if sessionId and its fallbacks are absent", () => {
      const input = {
        cwd: "/var/tmp/project",
      };

      const result = parseSessionParams(input);
      expect(result).toBeNull();
    });

    it("filters out empty or non-string parameters", () => {
      const input = {
        sessionId: "session-valid",
        cwd: "  ",
        workspaceId: 1234, // non-string
        repoUrl: null,
      };

      const result = parseSessionParams(input as any);
      expect(result).toEqual({
        sessionId: "session-valid",
      });
    });
  });

  /**
   * Tests for the full AdapterSessionCodec implementation.
   * Confirms integration with Paperclip serialization/deserialization cycles.
   */
  describe("sessionCodec", () => {
    it("deserializes valid session object inputs", () => {
      const input = { sessionId: "session-ok", folder: "/project" };
      const result = sessionCodec.deserialize(input);
      expect(result).toEqual({
        sessionId: "session-ok",
        cwd: "/project",
      });
    });

    it("deserializes invalid, array, or null inputs to null", () => {
      expect(sessionCodec.deserialize(null)).toBeNull();
      expect(sessionCodec.deserialize([])).toBeNull();
      expect(sessionCodec.deserialize("just-a-string")).toBeNull();
    });

    it("serializes valid session params", () => {
      const input = { sessionId: "session-ok", cwd: "/project" };
      const result = sessionCodec.serialize(input);
      expect(result).toEqual({
        sessionId: "session-ok",
        cwd: "/project",
      });
    });

    it("serializes null or missing sessionId records to null", () => {
      expect(sessionCodec.serialize(null)).toBeNull();
      expect(sessionCodec.serialize({ cwd: "/project" })).toBeNull();
    });

    it("gets the display ID correctly", () => {
      expect(sessionCodec.getDisplayId(null)).toBeNull();
      expect(sessionCodec.getDisplayId({ sessionId: "disp-1" })).toBe("disp-1");
      expect(sessionCodec.getDisplayId({ session_id: "disp-2" })).toBe("disp-2");
      expect(sessionCodec.getDisplayId({ sessionID: "disp-3" })).toBe("disp-3");
    });
  });
});
