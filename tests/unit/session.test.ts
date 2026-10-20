/**
 * @fileoverview Unit test suite for Antigravity Session Codec and parameters parsing.
 * Validates deserialization, serialization, fallback resolutions, conversationId aliases, accountProfile, and display IDs.
 *
 * @copyright Antigravity Adapter Contributors
 * @license MIT
 */

import { describe, expect, it } from "vitest";
import { sessionCodec, parseSessionParams } from "../../src/server/index.js";

describe("session codec and params parser", () => {
  describe("parseSessionParams", () => {
    it("successfully parses valid session parameters with exact camelCase structure", () => {
      const input = {
        sessionId: "session-123",
        cwd: "/home/developer/workspace",
        accountProfile: "account-1",
        workspaceId: "ws-abc",
        repoUrl: "git@github.com:weslleycapelari/project.git",
        repoRef: "main",
      };

      const result = parseSessionParams(input);
      expect(result).toEqual({
        sessionId: "session-123",
        cwd: "/home/developer/workspace",
        accountProfile: "account-1",
        workspaceId: "ws-abc",
        repoUrl: "git@github.com:weslleycapelari/project.git",
        repoRef: "main",
      });
    });

    it("resolves parameters through conversationId and snake_case fallbacks", () => {
      const input = {
        conversation_id: "conv-456",
        workdir: "/var/tmp/project",
        account_profile: "account-2",
        workspace_id: "ws-xyz",
        repo_url: "git@github.com:weslleycapelari/another.git",
        repo_ref: "dev",
      };

      const result = parseSessionParams(input);
      expect(result).toEqual({
        sessionId: "conv-456",
        cwd: "/var/tmp/project",
        accountProfile: "account-2",
        workspaceId: "ws-xyz",
        repoUrl: "git@github.com:weslleycapelari/another.git",
        repoRef: "dev",
      });
    });

    it("returns null if sessionId and conversationId fallbacks are absent", () => {
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
        workspaceId: 1234,
        repoUrl: null,
      };

      const result = parseSessionParams(input as any);
      expect(result).toEqual({
        sessionId: "session-valid",
      });
    });
  });

  describe("sessionCodec", () => {
    it("deserializes valid session object inputs with conversationId and accountProfile", () => {
      const input = { conversationId: "conv-ok", folder: "/project", accountProfile: "account-3" };
      const result = sessionCodec.deserialize(input);
      expect(result).toEqual({
        sessionId: "conv-ok",
        cwd: "/project",
        accountProfile: "account-3",
      });
    });

    it("deserializes invalid, array, or null inputs to null", () => {
      expect(sessionCodec.deserialize(null)).toBeNull();
      expect(sessionCodec.deserialize([])).toBeNull();
      expect(sessionCodec.deserialize("just-a-string")).toBeNull();
    });

    it("serializes valid session params", () => {
      const input = { sessionId: "session-ok", cwd: "/project", accountProfile: "account-1" };
      const result = sessionCodec.serialize(input);
      expect(result).toEqual({
        sessionId: "session-ok",
        cwd: "/project",
        accountProfile: "account-1",
      });
    });

    it("serializes null or missing sessionId records to null", () => {
      expect(sessionCodec.serialize(null)).toBeNull();
      expect(sessionCodec.serialize({ cwd: "/project" })).toBeNull();
    });

    it("gets the display ID correctly from sessionId or conversationId", () => {
      expect(sessionCodec.getDisplayId(null)).toBeNull();
      expect(sessionCodec.getDisplayId({ sessionId: "disp-1" })).toBe("disp-1");
      expect(sessionCodec.getDisplayId({ session_id: "disp-2" })).toBe("disp-2");
      expect(sessionCodec.getDisplayId({ conversationId: "disp-conv" })).toBe("disp-conv");
      expect(sessionCodec.getDisplayId({ conversation_id: "disp-conv-snake" })).toBe("disp-conv-snake");
      expect(sessionCodec.getDisplayId({ sessionID: "disp-3" })).toBe("disp-3");
    });
  });
});
