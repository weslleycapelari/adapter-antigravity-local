import { afterEach, describe, expect, it, vi } from "vitest";
import { testEnvironment } from "../../src/server/test.js";

const {
  runAdapterExecutionTargetProcess,
  ensureAdapterExecutionTargetCommandResolvable,
  ensureAdapterExecutionTargetDirectory,
  maybeRunSandboxInstallCommand,
} = vi.hoisted(() => ({
  runAdapterExecutionTargetProcess: vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "hello",
    stderr: "",
    pid: 999,
    startedAt: new Date().toISOString(),
  })),
  ensureAdapterExecutionTargetCommandResolvable: vi.fn(async () => undefined),
  ensureAdapterExecutionTargetDirectory: vi.fn(async () => undefined),
  maybeRunSandboxInstallCommand: vi.fn(async () => null),
}));

vi.mock("@paperclipai/adapter-utils/execution-target", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/execution-target")>(
    "@paperclipai/adapter-utils/execution-target",
  );
  return {
    ...actual,
    runAdapterExecutionTargetProcess,
    ensureAdapterExecutionTargetCommandResolvable,
    ensureAdapterExecutionTargetDirectory,
  };
});

vi.mock("@paperclipai/adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/server-utils")>(
    "@paperclipai/adapter-utils/server-utils",
  );
  return {
    ...actual,
    ensureAbsoluteDirectory: vi.fn(async () => undefined),
  };
});

/**
 * Integration test suite for the environment connection probe pipeline.
 * Assures rigorous coverage across basic passes, missing credentials, quota limits, and timeouts.
 */
describe("testEnvironment probe pipeline", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Scenario: Basic passing flow.
   * Asserts status is "pass" and returns probe passed when agy prints "hello".
   */
  it("probes successfully and returns 'pass' status with hello output", async () => {
    runAdapterExecutionTargetProcess.mockResolvedValueOnce({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "Hello from Antigravity!",
      stderr: "",
      pid: 111,
      startedAt: new Date().toISOString(),
    });

    const result = await testEnvironment({
      adapterType: "antigravity_local",
      config: {
        command: "agy",
      },
      onLog: async () => {},
    });

    expect(result.status).toBe("pass");
    expect(result.checks.some((c) => c.code === "antigravity_hello_probe_passed")).toBe(true);
    expect(runAdapterExecutionTargetProcess).toHaveBeenCalledTimes(1);
  });

  /**
   * Scenario: Custom non-agy command skip.
   * Proves that custom wrapper scripts skip direct hello telemetry probes.
   */
  it("skips hello probe when custom execution command is configured", async () => {
    const result = await testEnvironment({
      adapterType: "antigravity_local",
      config: {
        command: "custom-orchestrator.sh",
      },
      onLog: async () => {},
    });

    expect(result.status).toBe("pass");
    expect(result.checks.some((c) => c.code === "antigravity_hello_probe_skipped_custom_command")).toBe(true);
    expect(runAdapterExecutionTargetProcess).not.toHaveBeenCalled();
  });

  /**
   * Scenario: Invalid working directory.
   * Emulates directory check failure and validates prompt aborts before launching probe.
   */
  it("fails immediately and sets status to 'fail' if working directory is invalid", async () => {
    ensureAdapterExecutionTargetDirectory.mockRejectedValueOnce(new Error("Directory invalid permission"));

    const result = await testEnvironment({
      adapterType: "antigravity_local",
      config: {
        command: "agy",
        cwd: "/root/protected",
      },
      onLog: async () => {},
    });

    expect(result.status).toBe("fail");
    expect(result.checks.some((c) => c.code === "antigravity_cwd_invalid")).toBe(true);
    // Probe execution MUST be aborted
    expect(runAdapterExecutionTargetProcess).not.toHaveBeenCalled();
  });

  /**
   * Scenario: Executable missing in PATH.
   * Asserts exit status is 'fail' when command target is not resolvable.
   */
  it("fails connection checks if the agy binary cannot be resolved in PATH", async () => {
    ensureAdapterExecutionTargetCommandResolvable.mockRejectedValueOnce(new Error("Command not found in PATH"));

    const result = await testEnvironment({
      adapterType: "antigravity_local",
      config: {
        command: "agy",
      },
      onLog: async () => {},
    });

    expect(result.status).toBe("fail");
    expect(result.checks.some((c) => c.code === "antigravity_command_unresolvable")).toBe(true);
    // Probe execution MUST be aborted
    expect(runAdapterExecutionTargetProcess).not.toHaveBeenCalled();
  });

  /**
   * Scenario: Missing Authentication Credentials.
   * Asserts status is 'warn' and sets auth required if exitCode is not 0 and messages match.
   */
  it("identifies lack of authentication and triggers warning status", async () => {
    runAdapterExecutionTargetProcess.mockResolvedValueOnce({
      exitCode: 1,
      signal: null,
      timedOut: false,
      stdout: "",
      stderr: "Run `agy auth login` first to authenticate",
      pid: 222,
      startedAt: new Date().toISOString(),
    });

    const result = await testEnvironment({
      adapterType: "antigravity_local",
      config: {
        command: "agy",
      },
      onLog: async () => {},
    });

    expect(result.status).toBe("warn");
    expect(result.checks.some((c) => c.code === "antigravity_hello_probe_auth_required")).toBe(true);
  });

  /**
   * Scenario: Quota Exhausted limits.
   * Asserts detection of quota exhaustion and marks warnings.
   */
  it("identifies rate limits or quota exhausted signatures and sets warnings", async () => {
    runAdapterExecutionTargetProcess.mockResolvedValueOnce({
      exitCode: 1,
      signal: null,
      timedOut: false,
      stdout: "",
      stderr: "Resource limits exhausted (429): Quota exceeded",
      pid: 333,
      startedAt: new Date().toISOString(),
    });

    const result = await testEnvironment({
      adapterType: "antigravity_local",
      config: {
        command: "agy",
      },
      onLog: async () => {},
    });

    expect(result.status).toBe("warn");
    expect(result.checks.some((c) => c.code === "antigravity_hello_probe_quota_exhausted")).toBe(true);
  });

  /**
   * Scenario: Telemetry timed out.
   * Validates robust warn handling when probes take longer than limits.
   */
  it("warns about timeouts if telemetry probe exceeds configured durations", async () => {
    runAdapterExecutionTargetProcess.mockResolvedValueOnce({
      exitCode: null,
      signal: "SIGTERM",
      timedOut: true,
      stdout: "",
      stderr: "",
      pid: 444,
      startedAt: new Date().toISOString(),
    });

    const result = await testEnvironment({
      adapterType: "antigravity_local",
      config: {
        command: "agy",
      },
      onLog: async () => {},
    });

    expect(result.status).toBe("warn");
    expect(result.checks.some((c) => c.code === "antigravity_hello_probe_timed_out")).toBe(true);
  });

  /**
   * Scenario: API key detection.
   * Verifies credentials info logs depend on configured API keys in environment.
   */
  it("flags api credentials as present when ANTIGRAVITY_API_KEY is supplied", async () => {
    const result = await testEnvironment({
      adapterType: "antigravity_local",
      config: {
        command: "agy",
        env: {
          ANTIGRAVITY_API_KEY: "test-sk-12345",
        },
      },
      onLog: async () => {},
    });

    expect(result.checks.some((c) => c.code === "antigravity_api_key_present")).toBe(true);
    expect(result.checks.some((c) => c.code === "antigravity_api_key_missing")).toBe(false);
  });
});
