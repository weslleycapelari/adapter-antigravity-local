/**
 * @fileoverview Unit test suite for the UI configuration builder.
 * Assures accurate parsing of legacy variables strings, structured bindings, reasoning effort, workspace strategies, and fallback rules.
 *
 * @copyright Antigravity Adapter Contributors
 * @license MIT
 */

import { describe, expect, it } from "vitest";
import { buildAntigravityLocalConfig } from "../../src/ui/build-config.js";
import { DEFAULT_ANTIGRAVITY_LOCAL_MODEL } from "../../src/index.js";

describe("UI build-config mapper", () => {
  it("builds the configuration with default values when provided with minimal parameters", () => {
    const result = buildAntigravityLocalConfig({});

    expect(result).toEqual({
      model: DEFAULT_ANTIGRAVITY_LOCAL_MODEL,
      timeoutSec: 0,
      graceSec: 15,
      dangerouslySkipPermissions: true,
      sandbox: true,
    });
  });

  it("maps cwd, instructionsFilePath, and custom command properties directly", () => {
    const result = buildAntigravityLocalConfig({
      cwd: "/home/developer/workspace",
      instructionsFilePath: "/home/developer/instructions.md",
      command: "/usr/bin/agy-custom",
    });

    expect(result.cwd).toBe("/home/developer/workspace");
    expect(result.instructionsFilePath).toBe("/home/developer/instructions.md");
    expect(result.command).toBe("/usr/bin/agy-custom");
  });

  it("maps reasoning effort from effort or thinkingEffort", () => {
    const res1 = buildAntigravityLocalConfig({ effort: "high" });
    expect(res1.effort).toBe("high");

    const res2 = buildAntigravityLocalConfig({ thinkingEffort: "xhigh" });
    expect(res2.effort).toBe("xhigh");
  });

  it("maps accountProfile slot for multi-account pool routing", () => {
    const result = buildAntigravityLocalConfig({ accountProfile: "account-2" });
    expect(result.accountProfile).toBe("account-2");
  });

  it("maps git_worktree workspace strategy", () => {
    const result = buildAntigravityLocalConfig({
      workspaceStrategyType: "git_worktree",
      workspaceBaseRef: "main",
      workspaceBranchTemplate: "feature/{{issueId}}",
      worktreeParentDir: "/worktrees",
    });

    expect(result.workspaceStrategy).toEqual({
      type: "git_worktree",
      baseRef: "main",
      branchTemplate: "feature/{{issueId}}",
      worktreeParentDir: "/worktrees",
    });
  });

  it("correctly parses legacy plain text envVars variables", () => {
    const envVars = `
      # A comment line to skip
      PORT=8080
      HOST=127.0.0.1
      VALID_VAR=hello=world
    `;

    const result = buildAntigravityLocalConfig({ envVars });

    expect(result.env).toEqual({
      PORT: { type: "plain", value: "8080" },
      HOST: { type: "plain", value: "127.0.0.1" },
      VALID_VAR: { type: "plain", value: "hello=world" },
    });
  });

  it("parses structured envBindings plain text and secret_ref references", () => {
    const envBindings = {
      API_KEY: "plain-text-key",
      DB_PASSWORD: {
        type: "secret_ref",
        secretId: "sec-db-pass",
        version: "latest",
      },
      API_PORT: {
        type: "plain",
        value: "3000",
      },
    };

    const result = buildAntigravityLocalConfig({ envBindings });

    expect(result.env).toEqual({
      API_KEY: { type: "plain", value: "plain-text-key" },
      DB_PASSWORD: {
        type: "secret_ref",
        secretId: "sec-db-pass",
        version: "latest",
      },
      API_PORT: {
        type: "plain",
        value: "3000",
      },
    });
  });

  it("correctly splits comma-separated extraArgs", () => {
    const result = buildAntigravityLocalConfig({
      extraArgs: "--verbose, --no-cache,  --profile=fast ",
    });

    expect(result.extraArgs).toEqual(["--verbose", "--no-cache", "--profile=fast"]);
  });

  it("sets sandbox flag to false when dangerouslyBypassSandbox is true", () => {
    const result = buildAntigravityLocalConfig({
      dangerouslyBypassSandbox: true,
    });

    expect(result.sandbox).toBe(false);
  });
});
