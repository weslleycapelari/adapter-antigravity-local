import { afterEach, describe, expect, it, vi } from "vitest";
import { execute } from "../../src/server/execute.js";

const {
  runAdapterExecutionTargetProcess,
  ensureAdapterExecutionTargetCommandResolvable,
  resolveAdapterExecutionTargetCommandForLogs,
} = vi.hoisted(() => ({
  runAdapterExecutionTargetProcess: vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "Success",
    stderr: "",
    pid: 123,
    startedAt: new Date().toISOString(),
  })),
  ensureAdapterExecutionTargetCommandResolvable: vi.fn(async () => undefined),
  resolveAdapterExecutionTargetCommandForLogs: vi.fn(async () => "/usr/local/bin/agy"),
}));

vi.mock("@paperclipai/adapter-utils/execution-target", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/execution-target")>(
    "@paperclipai/adapter-utils/execution-target",
  );
  return {
    ...actual,
    runAdapterExecutionTargetProcess,
    ensureAdapterExecutionTargetCommandResolvable,
    resolveAdapterExecutionTargetCommandForLogs,
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
 * Integration test suite for the local Antigravity execution flow.
 * Mocks the system process spawn APIs to assert correct argument building, 
 * environment variables injection, and multi-workspace support.
 */
describe("antigravity local execution", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Assures that a basic local run correctly resolves and spawns the `agy` process
   * with the expected prompt and unattended permission flags.
   */
  it("successfully invokes agy with local command and correct prompt", async () => {
    const result = await execute({
      runId: "run-local-1",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Antigravity CEO",
        adapterType: "antigravity_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        command: "agy",
      },
      context: {
        paperclipWorkspace: {
          cwd: "/home/user/workspace",
          source: "project_primary",
        },
      },
      onLog: async () => {},
    });

    expect(result.exitCode).toBe(0);
    expect(result.summary).toBe("Success");
    expect(runAdapterExecutionTargetProcess).toHaveBeenCalledTimes(1);

    const callArgs = runAdapterExecutionTargetProcess.mock.calls[0] as unknown as [string, unknown, string, string[]];
    const cliArgs = callArgs[3];
    expect(cliArgs).toContain("--print");
    expect(cliArgs).toContain("--output-format");
    expect(cliArgs).toContain("stream-json");
    expect(cliArgs).toContain("--dangerously-skip-permissions");
  });

  /**
   * Asserts that model selection passes the `--model <model>` CLI flag to `agy`.
   */
  it("configures model via --model CLI flag and env.ANTIGRAVITY_MODEL", async () => {
    await execute({
      runId: "run-local-2",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Antigravity CEO",
        adapterType: "antigravity_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        command: "agy",
        model: "claude-sonnet-4.6-thinking",
      },
      context: {
        paperclipWorkspace: {
          cwd: "/home/user/workspace",
          source: "project_primary",
        },
      },
      onLog: async () => {},
    });

    const callArgs = runAdapterExecutionTargetProcess.mock.calls[0] as unknown as [string, unknown, string, string[], { env: Record<string, string> }];
    const cliArgs = callArgs[3];
    const options = callArgs[4];

    const modelIdx = cliArgs.indexOf("--model");
    expect(modelIdx).toBeGreaterThan(-1);
    expect(cliArgs[modelIdx + 1]).toBe("claude-sonnet-4.6-thinking");
    expect(options.env.ANTIGRAVITY_MODEL).toBe("claude-sonnet-4.6-thinking");
  });

  /**
   * Asserts that multiple active workspaces are mapped correctly using
   * repeatable `--add-dir` flags on the spawned command line.
   */
  it("appends multiple workspaces using repeatable --add-dir CLI flags", async () => {
    await execute({
      runId: "run-local-3",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Antigravity CEO",
        adapterType: "antigravity_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        command: "agy",
      },
      context: {
        paperclipWorkspace: {
          cwd: "/home/user/workspace-1",
          source: "project_primary",
        },
        paperclipWorkspaces: [
          { cwd: "/home/user/workspace-1" },
          { cwd: "/home/user/workspace-2" },
        ],
      },
      onLog: async () => {},
    });

    const callArgs = runAdapterExecutionTargetProcess.mock.calls[0] as unknown as [string, unknown, string, string[]];
    const cliArgs = callArgs[3];

    let addDirIndices: number[] = [];
    cliArgs.forEach((arg, idx) => {
      if (arg === "--add-dir") addDirIndices.push(idx);
    });

    expect(addDirIndices.length).toBe(2);
    expect(cliArgs[addDirIndices[0] + 1]).toBe("/home/user/workspace-1");
    expect(cliArgs[addDirIndices[1] + 1]).toBe("/home/user/workspace-2");
  });

  /**
   * Asserts that NDJSON stream events capture generated session ID and usage metrics.
   */
  it("captures generated session ID and usage metrics from stream-json output", async () => {
    runAdapterExecutionTargetProcess.mockImplementationOnce(async () => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: '{"event":"init","conversation_id":"39d9bdfe-3618-4d2d-ae5d-deee2e075ee2"}\n{"event":"result","result":{"conversation_id":"39d9bdfe-3618-4d2d-ae5d-deee2e075ee2","response":"Hello!","usage":{"input_tokens":100,"output_tokens":20,"cache_read_tokens":5},"cost_usd":0.001}}\n',
      stderr: "",
      pid: 123,
      startedAt: new Date().toISOString(),
    }));

    const result = await execute({
      runId: "run-local-4",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Antigravity CEO",
        adapterType: "antigravity_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        command: "agy",
      },
      context: {
        paperclipWorkspace: {
          cwd: "/home/user/workspace",
          source: "project_primary",
        },
      },
      onLog: async () => {},
    });

    expect(result.sessionId).toBe("39d9bdfe-3618-4d2d-ae5d-deee2e075ee2");
    expect(result.summary).toBe("Hello!");
    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cachedInputTokens: 5,
    });
    expect(result.costUsd).toBe(0.001);
  });
});
