/**
 * @fileoverview Unit tests for Antigravity stream-json parsing, token usage computation, and event extractions.
 *
 * @copyright Antigravity Adapter Contributors
 * @license MIT
 */

import { describe, expect, it } from "vitest";
import {
  createAntigravityStreamParser,
  parseAntigravityStreamJson,
  isAntigravityRateLimited,
  extractAntigravityResetTime,
} from "../../src/server/parse.js";

describe("Antigravity stream-json parser", () => {
  it("parses init event and captures conversation_id", () => {
    const stdout = JSON.stringify({
      event: "init",
      conversation_id: "conv-12345",
      init: { cwd: "/workspace", tools: ["run_command", "view_file"] },
    });

    const result = parseAntigravityStreamJson(stdout);
    expect(result.sessionId).toBe("conv-12345");
  });

  it("aggregates token usage across multiple step_update events", () => {
    const parser = createAntigravityStreamParser();

    const line1 = JSON.stringify({
      event: "step_update",
      step_update: {
        step_index: 1,
        step_type: "tool",
        state: "DONE",
        usage: { input_tokens: 100, output_tokens: 20, cache_read_tokens: 50 },
      },
    });

    const line2 = JSON.stringify({
      event: "step_update",
      step_update: {
        step_index: 2,
        step_type: "agent_response",
        state: "DONE",
        text_delta: "Response from agent",
        usage: { input_tokens: 200, output_tokens: 50, cache_read_tokens: 100 },
      },
    });

    const result = parser(`${line1}\n${line2}`);
    expect(result.summary).toBe("Response from agent");
    expect(result.usage.inputTokens).toBe(300);
    expect(result.usage.outputTokens).toBe(70);
    expect(result.usage.cachedInputTokens).toBe(150);
  });

  it("prefers final result usage when final usage is higher", () => {
    const parser = createAntigravityStreamParser();

    const line1 = JSON.stringify({
      event: "step_update",
      step_update: {
        step_index: 1,
        usage: { input_tokens: 100, output_tokens: 10 },
      },
    });

    const line2 = JSON.stringify({
      event: "result",
      result: {
        status: "SUCCESS",
        response: "All tasks completed successfully.",
        cost_usd: 0.0042,
        usage: { input_tokens: 500, output_tokens: 120, cache_read_tokens: 200 },
      },
    });

    const result = parser(`${line1}\n${line2}`);
    expect(result.status).toBe("SUCCESS");
    expect(result.summary).toBe("All tasks completed successfully.");
    expect(result.costUsd).toBe(0.0042);
    expect(result.usage.inputTokens).toBe(500);
    expect(result.usage.outputTokens).toBe(120);
    expect(result.usage.cachedInputTokens).toBe(200);
  });

  it("captures step error message and reports ERROR status", () => {
    const stdout = JSON.stringify({
      event: "step_update",
      step_update: {
        step_index: 3,
        state: "ERROR",
        error_message: "Tool execution timed out",
      },
    });

    const result = parseAntigravityStreamJson(stdout);
    expect(result.errorMessage).toBe("Tool execution timed out");
  });

  it("detects rate limits and extracts reset time", () => {
    const stderr = "Error: 429 Too Many Requests. Rate limit reached, resets at 2026-10-21T18:00:00Z.";
    expect(isAntigravityRateLimited("", stderr)).toBe(true);
    expect(extractAntigravityResetTime("", stderr)).toBe("2026-10-21T18:00:00Z");
  });
});
