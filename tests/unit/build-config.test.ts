import { describe, expect, it } from "vitest";
import { buildAntigravityLocalConfig } from "../../src/ui/build-config.js";
import { DEFAULT_ANTIGRAVITY_LOCAL_MODEL } from "../../src/index.js";

/**
 * Unit test suite for the UI configuration builder.
 * Assures accurate parsing of legacy variables strings, structured bindings, secret references, sandboxing flags, and fallback rules.
 */
describe("UI build-config mapper", () => {
  
  /**
   * Scenario: Basic configuration building and fallback resolutions.
   */
  it("builds the configuration with default values when provided with minimal parameters", () => {
    const result = buildAntigravityLocalConfig({});
    
    expect(result).toEqual({
      model: DEFAULT_ANTIGRAVITY_LOCAL_MODEL,
      timeoutSec: 0,
      graceSec: 15,
      sandbox: true, // defaults to true unless dangerouslyBypassSandbox is true
    });
  });

  /**
   * Scenario: Working directories and instructions file paths mapping.
   */
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

  /**
   * Scenario: Legacy plain text envVars formatting.
   * Tests multi-line KEY=VALUE resolution, skipping invalid key structures and ignores comment lines.
   */
  it("correctly parses legacy plain text envVars variables", () => {
    const envVars = `
      # A comment line to skip
      PORT=8080
      HOST=127.0.0.1
      1INVALID=should-be-ignored
      VALID_VAR=hello=world
    `;

    const result = buildAntigravityLocalConfig({ envVars });

    expect(result.env).toEqual({
      PORT: { type: "plain", value: "8080" },
      HOST: { type: "plain", value: "127.0.0.1" },
      VALID_VAR: { type: "plain", value: "hello=world" },
    });
  });

  /**
   * Scenario: Structured envBindings mapper.
   * Assures plain string bindings and secret references map cleanly according to types schemas.
   */
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
      INVALID_BINDING: {
        type: "invalid_type",
        value: "ignored",
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

  /**
   * Scenario: Precedence and Variable merges.
   * Validates that structured envBindings take precedence over legacy envVars on keys collisions.
   */
  it("resolves key collisions by prioritizing envBindings over legacy envVars", () => {
    const envVars = `
      PORT=8080
      TIMEOUT=30
    `;
    const envBindings = {
      PORT: "9000", // Collision!
      ENV_NAME: "production",
    };

    const result = buildAntigravityLocalConfig({ envVars, envBindings });

    expect(result.env).toEqual({
      PORT: { type: "plain", value: "9000" }, // Wins from envBindings
      TIMEOUT: { type: "plain", value: "30" }, // Merged from envVars
      ENV_NAME: { type: "plain", value: "production" }, // Merged from envBindings
    });
  });

  /**
   * Scenario: Sandboxing bypass setups.
   */
  it("correctly triggers sandbox flag based on dangerouslyBypassSandbox UI values", () => {
    const withSandbox = buildAntigravityLocalConfig({ dangerouslyBypassSandbox: false });
    expect(withSandbox.sandbox).toBe(true);

    const bypassed = buildAntigravityLocalConfig({ dangerouslyBypassSandbox: true });
    expect(bypassed.sandbox).toBe(false);
  });

  /**
   * Scenario: Commas delimited arguments parsing.
   */
  it("parses comma-separated extraArgs into an array list of string arguments", () => {
    const result = buildAntigravityLocalConfig({
      extraArgs: "--verbose, --debug, --model-fallback=none",
    });

    expect(result.extraArgs).toEqual(["--verbose", "--debug", "--model-fallback=none"]);
  });
});
