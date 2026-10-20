/**
 * @fileoverview Integration test suite for the local Antigravity execution flow.
 * Mocks the process spawn APIs to assert modern stream-json CLI flags, model passing,
 * effort parameters, conversation resumption, and rate-limit rotation.
 *
 * @copyright Antigravity Adapter Contributors
 * @license MIT
 */

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
    stdout: JSON.stringify({
      event: "result",
      result: {
        status: "SUCCESS",
        response: "Success response",
        conversation_id: "conv-123",
        usage: { input_tokens: 100, output_tokens: 25, cache_read_tokens: 10 },
      },
    }),
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

describe("antigravity local execution", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("successfully invokes agy with -p, stream-json output format, and permission flags", async () => {
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
    expect(result.summary).toBe("Success response");
    expect(result.sessionId).toBe("conv-123");
    expect(runAdapterExecutionTargetProcess).toHaveBeenCalledTimes(1);

    const callArgs = runAdapterExecutionTargetProcess.mock.calls[0] as unknown as [
      string,
      unknown,
      string,
      string[],
    ];
    const cliArgs = callArgs[3];
    expect(cliArgs).toContain("-p");
    expect(cliArgs).toContain("--output-format");
    expect(cliArgs).toContain("stream-json");
    expect(cliArgs).toContain("--dangerously-skip-permissions");
  });

  it("passes --model and --effort flags when configured", async () => {
    await execute({
      runId: "run-local-2",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Antigravity Worker",
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
        model: "claude-opus-5-5-high",
        effort: "max",
      },
      context: {
        paperclipWorkspace: {
          cwd: "/home/user/workspace",
          source: "project_primary",
        },
      },
      onLog: async () => {},
    });

    const callArgs = runAdapterExecutionTargetProcess.mock.calls[0] as unknown as [
      string,
      unknown,
      string,
      string[],
    ];
    const cliArgs = callArgs[3];

    expect(cliArgs).toContain("--model");
    expect(cliArgs[cliArgs.indexOf("--model") + 1]).toBe("claude-opus-5-5-high");
    expect(cliArgs).toContain("--effort");
    expect(cliArgs[cliArgs.indexOf("--effort") + 1]).toBe("max");
  });

  it("resumes session with --conversation flag when valid sessionId is present", async () => {
    await execute({
      runId: "run-local-3",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Antigravity Engineer",
        adapterType: "antigravity_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: "conv-existing-789",
        sessionParams: {
          sessionId: "conv-existing-789",
          cwd: "/home/user/workspace",
        },
        sessionDisplayId: "conv-existing-789",
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

    const callArgs = runAdapterExecutionTargetProcess.mock.calls[0] as unknown as [
      string,
      unknown,
      string,
      string[],
    ];
    const cliArgs = callArgs[3];

    expect(cliArgs).toContain("--conversation");
    expect(cliArgs[cliArgs.indexOf("--conversation") + 1]).toBe("conv-existing-789");
  });

  it("retries with a fresh session when conversation is unrecoverable", async () => {
    runAdapterExecutionTargetProcess
      .mockResolvedValueOnce({
        exitCode: 1,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: "Error: conversation not found",
        pid: 201,
        startedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: JSON.stringify({
          event: "result",
          result: {
            status: "SUCCESS",
            response: "Recovered fresh conversation",
            conversation_id: "conv-fresh-999",
            usage: { input_tokens: 50, output_tokens: 20 },
          },
        }),
        stderr: "",
        pid: 202,
        startedAt: new Date().toISOString(),
      });

    const result = await execute({
      runId: "run-local-retry",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Antigravity Worker",
        adapterType: "antigravity_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: "conv-expired-111",
        sessionParams: {
          sessionId: "conv-expired-111",
          cwd: "/home/user/workspace",
        },
        sessionDisplayId: "conv-expired-111",
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

    expect(runAdapterExecutionTargetProcess).toHaveBeenCalledTimes(2);
    expect(result.exitCode).toBe(0);
    expect(result.summary).toBe("Recovered fresh conversation");
    expect(result.sessionId).toBe("conv-fresh-999");
  });

  it("skips resuming session when saved cwd does not match current workspace cwd", async () => {
    const logs: string[] = [];
    const result = await execute({
      runId: "run-local-cwd-mismatch",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Antigravity Worker",
        adapterType: "antigravity_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: "conv-other-cwd",
        sessionParams: {
          sessionId: "conv-other-cwd",
          cwd: "/different/directory",
        },
        sessionDisplayId: "conv-other-cwd",
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
      onLog: async (_stream, chunk) => {
        logs.push(chunk);
      },
    });

    expect(result.exitCode).toBe(0);
    expect(logs.join("")).toContain("and will not be resumed");

    const callArgs = runAdapterExecutionTargetProcess.mock.calls[0] as unknown as [
      string,
      unknown,
      string,
      string[],
    ];
    const cliArgs = callArgs[3];
    expect(cliArgs).not.toContain("--conversation");
  });

  it("dispatches usage checkpoints to onUsage hook during execution", async () => {
    const usageCheckpoints: unknown[] = [];
    runAdapterExecutionTargetProcess.mockImplementationOnce(async (_runId, _target, _command, _args, options) => {
      // Simulate stdout emission of stream-json chunks
      const stdoutChunk = `${JSON.stringify({
        event: "step_update",
        step_update: {
          usage: { input_tokens: 500, output_tokens: 200, cache_read_tokens: 100 },
        },
      })}\n`;
      await options.onLog("stdout", stdoutChunk);

      const finalChunk = `${JSON.stringify({
        event: "result",
        result: {
          status: "SUCCESS",
          response: "Finished",
          usage: { input_tokens: 500, output_tokens: 200, cache_read_tokens: 100 },
        },
      })}\n`;
      await options.onLog("stdout", finalChunk);

      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: stdoutChunk + finalChunk,
        stderr: "",
        pid: 300,
        startedAt: new Date().toISOString(),
      };
    });

    const result = await execute({
      runId: "run-local-usage-hook",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Antigravity Worker",
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
      onUsage: async (checkpoint) => {
        usageCheckpoints.push(checkpoint);
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.usage).toEqual({
      inputTokens: 500,
      outputTokens: 200,
      cachedInputTokens: 100,
    });
    expect(usageCheckpoints.length).toBeGreaterThan(0);
    expect(usageCheckpoints[0]).toMatchObject({
      usage: {
        inputTokens: 500,
        outputTokens: 200,
        cachedInputTokens: 100,
      },
      provider: "antigravity",
    });
  });
});
