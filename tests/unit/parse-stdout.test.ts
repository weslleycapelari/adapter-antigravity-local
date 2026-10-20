/**
 * @fileoverview Unit test suite for real-time visual stdout streaming parser.
 * Asserts the robust mapping of raw stdout line blocks and stream-json events to UI TranscriptEntries.
 *
 * @copyright Antigravity Adapter Contributors
 * @license MIT
 */

import { describe, expect, it } from "vitest";
import { parseAntigravityStdoutLine } from "../../src/ui/parse-stdout.js";

const ts = "2026-10-20T12:00:00.000Z";

describe("parseAntigravityStdoutLine", () => {
  it("parses init event with conversation_id", () => {
    const entries = parseAntigravityStdoutLine(
      JSON.stringify({
        event: "init",
        conversation_id: "conv-abc",
        init: { cwd: "/workspace", tools: ["view_file", "run_command"], permission_mode: "always-proceed" },
      }),
      ts,
    );
    expect(entries).toEqual([
      {
        kind: "init",
        ts,
        model: "antigravity",
        sessionId: "conv-abc",
      },
    ]);
  });

  it("ignores empty user_input step_update and parses non-empty user_input", () => {
    expect(
      parseAntigravityStdoutLine(
        JSON.stringify({
          event: "step_update",
          step_update: { step_index: 0, state: "DONE", step_type: "user_input" },
        }),
        ts,
      ),
    ).toEqual([]);

    expect(
      parseAntigravityStdoutLine(
        JSON.stringify({
          event: "step_update",
          step_update: { step_index: 0, state: "DONE", step_type: "user_input", text: "Hello agent" },
        }),
        ts,
      ),
    ).toEqual([{ kind: "user", ts, text: "Hello agent" }]);
  });

  it("emits delta assistant and thinking entries with delta: true", () => {
    const thinkingEntries = parseAntigravityStdoutLine(
      JSON.stringify({
        event: "step_update",
        step_update: {
          step_index: 1,
          state: "ACTIVE",
          step_type: "agent_response",
          thinking_delta: "Thinking deeply...",
        },
      }),
      ts,
    );
    expect(thinkingEntries).toEqual([
      { kind: "thinking", ts, text: "Thinking deeply...", delta: true },
    ]);

    const token = parseAntigravityStdoutLine(
      JSON.stringify({
        event: "step_update",
        step_update: {
          step_index: 1,
          state: "ACTIVE",
          step_type: "agent_response",
          text_delta: "Hello world",
        },
      }),
      ts,
    );
    expect(token).toEqual([{ kind: "assistant", ts, text: "Hello world", delta: true }]);
  });

  it("parses tool calls and tool results with matching toolUseId", () => {
    const activeEntries = parseAntigravityStdoutLine(
      JSON.stringify({
        event: "step_update",
        step_update: {
          conversation_id: "conv-1",
          step_index: 2,
          state: "ACTIVE",
          step_type: "tool",
          tool_name: "view_file",
          tool_info: {
            name: "view_file",
            parameters: { AbsolutePath: "/workspace/package.json" },
          },
        },
      }),
      ts,
    );
    expect(activeEntries).toEqual([
      {
        kind: "tool_call",
        ts,
        name: "view_file",
        toolUseId: "step_2",
        input: { AbsolutePath: "/workspace/package.json" },
      },
    ]);

    const doneEntries = parseAntigravityStdoutLine(
      JSON.stringify({
        event: "step_update",
        step_update: {
          conversation_id: "conv-1",
          step_index: 2,
          state: "DONE",
          step_type: "tool",
          tool_name: "view_file",
          tool_info: {
            name: "view_file",
            parameters: { AbsolutePath: "/workspace/package.json" },
            output: "100 lines",
          },
        },
      }),
      ts,
    );
    expect(doneEntries).toEqual([
      {
        kind: "tool_result",
        ts,
        toolUseId: "step_2",
        toolName: "view_file",
        content: "100 lines",
        isError: false,
      },
    ]);
  });

  it("translates native subagent_info into invoke_subagent tool call", () => {
    const entries = parseAntigravityStdoutLine(
      JSON.stringify({
        event: "step_update",
        step_update: {
          step_index: 4,
          state: "ACTIVE",
          subagent_info: {
            subagent_type: "researcher",
            role: "Codebase Explorer",
            prompt: "Investigate database schema",
          },
        },
      }),
      ts,
    );

    expect(entries).toEqual([
      {
        kind: "tool_call",
        ts,
        name: "invoke_subagent",
        toolUseId: "step_4",
        input: {
          subagent_type: "researcher",
          role: "Codebase Explorer",
          prompt: "Investigate database schema",
        },
      },
    ]);
  });

  it("parses terminal result event with metrics and cost", () => {
    const entries = parseAntigravityStdoutLine(
      JSON.stringify({
        event: "result",
        result: {
          status: "SUCCESS",
          response: "Finished successfully.",
          cost_usd: 0.005,
          usage: {
            input_tokens: 1500,
            output_tokens: 350,
            cache_read_tokens: 400,
          },
        },
      }),
      ts,
    );

    expect(entries).toEqual([
      {
        kind: "result",
        ts,
        text: "Finished successfully.",
        inputTokens: 1500,
        outputTokens: 350,
        cachedTokens: 400,
        costUsd: 0.005,
        subtype: "success",
        isError: false,
        errors: [],
      },
    ]);
  });

  it("renders non-JSON plain text lines as stdout entries", () => {
    const entries = parseAntigravityStdoutLine("raw log line", ts);
    expect(entries).toEqual([{ kind: "stdout", ts, text: "raw log line" }]);
  });

  it("renders error prefixed lines as stderr entries", () => {
    const entries = parseAntigravityStdoutLine("error: database connection failed", ts);
    expect(entries).toEqual([{ kind: "stderr", ts, text: "error: database connection failed" }]);
  });

  it("returns empty array for empty or whitespace-only lines", () => {
    expect(parseAntigravityStdoutLine("   ", ts)).toEqual([]);
    expect(parseAntigravityStdoutLine("", ts)).toEqual([]);
  });
});
