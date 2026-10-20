/**
 * @fileoverview Unit test suite for CLI stream event formatting and colorized terminal printing.
 *
 * @copyright Antigravity Adapter Contributors
 * @license MIT
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import pc from "picocolors";
import { printAntigravityStreamEvent } from "../../src/cli/format-event.js";

describe("CLI format-event stream printer", () => {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  afterEach(() => {
    logSpy.mockClear();
    stdoutSpy.mockClear();
  });

  it("silently ignores empty or whitespace-only lines", () => {
    printAntigravityStreamEvent("   ", false);
    expect(logSpy).not.toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("prints init event in cyan", () => {
    const raw = JSON.stringify({ event: "init", conversation_id: "conv-123" });
    printAntigravityStreamEvent(raw, false);
    expect(logSpy).toHaveBeenCalledWith(pc.cyan("Antigravity init [conversation: conv-123]"));
  });

  it("streams agent_response text_delta in green", () => {
    const raw = JSON.stringify({
      event: "step_update",
      step_update: { step_type: "agent_response", text_delta: "Hello from agent" },
    });
    printAntigravityStreamEvent(raw, false);
    expect(stdoutSpy).toHaveBeenCalledWith(pc.green("Hello from agent"));
  });

  it("streams thinking_delta in gray", () => {
    const raw = JSON.stringify({
      event: "step_update",
      step_update: { step_type: "thinking", thinking_delta: "Thinking..." },
    });
    printAntigravityStreamEvent(raw, false);
    expect(stdoutSpy).toHaveBeenCalledWith(pc.gray("Thinking..."));
  });

  it("prints tool_call in yellow and tool_result in cyan", () => {
    const callRaw = JSON.stringify({
      event: "step_update",
      step_update: {
        step_type: "tool_call",
        tool_name: "run_command",
        input: { CommandLine: "ls" },
      },
    });
    printAntigravityStreamEvent(callRaw, false);
    expect(logSpy).toHaveBeenCalledWith(pc.yellow("\ntool_call: run_command"));

    const resultRaw = JSON.stringify({
      event: "step_update",
      step_update: {
        step_type: "tool_result",
        tool_name: "run_command",
        output: "file1.txt",
      },
    });
    printAntigravityStreamEvent(resultRaw, false);
    expect(logSpy).toHaveBeenCalledWith(pc.cyan("tool_result: run_command"));
  });

  it("prints finished result with token summary in blue", () => {
    const raw = JSON.stringify({
      event: "result",
      result: {
        status: "SUCCESS",
        usage: { input_tokens: 500, output_tokens: 100, cache_read_tokens: 50 },
      },
    });
    printAntigravityStreamEvent(raw, false);
    expect(logSpy).toHaveBeenCalledWith(
      pc.blue("\nAntigravity finished: status=SUCCESS tokens: in=500 out=100 cached=50"),
    );
  });

  it("prints lines starting with 'error:' in red", () => {
    printAntigravityStreamEvent("error: Failed to write scratch script to disk", false);
    expect(logSpy).toHaveBeenCalledWith(pc.red("error: Failed to write scratch script to disk"));
  });

  it("prints lines starting with 'fatal:' in red", () => {
    printAntigravityStreamEvent("fatal: Agent crashed unexpectedly", false);
    expect(logSpy).toHaveBeenCalledWith(pc.red("fatal: Agent crashed unexpectedly"));
  });
});
