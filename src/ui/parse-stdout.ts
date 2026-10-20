/**
 * @fileoverview Stdout stream line parser mapping Antigravity stream-json events into UI transcripts.
 * Parses init, thinking, agent responses, tool calls, MCP actions, subagents, and final results.
 *
 * @copyright Antigravity Adapter Contributors
 * @license MIT
 */

import type { TranscriptEntry } from "@paperclipai/adapter-utils";

/**
 * Safely parses a JSON string, returning null if invalid.
 */
function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Casts an unknown value to a Record if it is an object and not an array.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Coerces an unknown value into a string with a fallback.
 */
function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Coerces an unknown value into a finite number with a fallback.
 */
function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Safely serializes an unknown value to a string.
 */
function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Parses a single line of stdout captured during Antigravity process executions.
 * Translates modern stream-json events into typed UI transcript entries (thinking, assistant, tools, results).
 *
 * @param line - The raw stdout line string.
 * @param ts - Current ISO timestamp string to assign to transcript entries.
 * @returns Array representing mapped UI transcript entries.
 */
export function parseAntigravityStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const trimmedLine = line.trim();
  if (!trimmedLine) return [];

  const parsed = asRecord(safeJsonParse(trimmedLine));
  if (!parsed) {
    const lowerText = trimmedLine.toLowerCase();
    if (lowerText.startsWith("error:") || lowerText.startsWith("fatal:")) {
      return [{ kind: "stderr", ts, text: trimmedLine }];
    }
    return [{ kind: "stdout", ts, text: line }];
  }

  const eventType = asString(parsed.event).trim();

  // Init event: {"event":"init","conversation_id":"...","init":{...}}
  if (eventType === "init") {
    const sessionId = asString(parsed.conversation_id);
    const initObj = asRecord(parsed.init);
    const model = asString(initObj?.model, asString(parsed.model, "antigravity"));
    return [{ kind: "init", ts, model, sessionId }];
  }

  // Step update event: {"event":"step_update","step_update":{...}}
  if (eventType === "step_update") {
    const step = asRecord(parsed.step_update);
    if (!step) return [];

    const stepType = asString(step.step_type).trim();
    const state = asString(step.state).trim().toUpperCase();
    const stepIndex =
      typeof step.step_index === "number" && Number.isFinite(step.step_index)
        ? step.step_index
        : null;
    const toolInfo = asRecord(step.tool_info);
    const subagentInfo = asRecord(step.subagent_info);

    if (stepType === "user_input") {
      const text = asString(step.text).trim();
      return text ? [{ kind: "user", ts, text }] : [];
    }

    if (stepType === "thinking") {
      const rawDelta =
        typeof step.thinking_delta === "string"
          ? step.thinking_delta
          : typeof step.text_delta === "string"
            ? step.text_delta
            : "";
      if (rawDelta.length > 0) {
        const cleaned = state === "DONE" ? rawDelta.replace(/\n$/, "") : rawDelta;
        return cleaned.length > 0
          ? [{ kind: "thinking", ts, text: cleaned, delta: true }]
          : [];
      }
      const staticText = asString(step.thinking, asString(step.text)).trim();
      return staticText ? [{ kind: "thinking", ts, text: staticText }] : [];
    }

    if (stepType === "agent_response") {
      const entries: TranscriptEntry[] = [];

      const thinkingDelta = asString(step.thinking_delta);
      if (thinkingDelta.length > 0) {
        const cleanedThinking = state === "DONE" ? thinkingDelta.replace(/\n$/, "") : thinkingDelta;
        if (cleanedThinking.length > 0) {
          entries.push({ kind: "thinking", ts, text: cleanedThinking, delta: true });
        }
      } else {
        const staticThinking = asString(step.thinking).trim();
        if (staticThinking) {
          entries.push({ kind: "thinking", ts, text: staticThinking });
        }
      }

      const textDelta = asString(step.text_delta);
      if (textDelta.length > 0) {
        const cleanedText = state === "DONE" ? textDelta.replace(/\n$/, "") : textDelta;
        if (cleanedText.length > 0) {
          entries.push({ kind: "assistant", ts, text: cleanedText, delta: true });
        }
      } else {
        const staticText = asString(step.text).trim();
        if (staticText) {
          entries.push({ kind: "assistant", ts, text: staticText });
        }
      }

      const errorMessage = asString(step.error_message).trim();
      if ((state === "ERROR" || state === "FAILED") && errorMessage) {
        entries.push({ kind: "stderr", ts, text: errorMessage });
      }

      return entries;
    }

    // Tools, MCP tools, and native Subagents
    if (
      stepType === "tool" ||
      stepType === "tool_call" ||
      stepType === "tool_result" ||
      toolInfo !== null ||
      subagentInfo !== null
    ) {
      const toolName =
        asString(step.tool_name) ||
        asString(toolInfo?.name) ||
        asString(step.tool) ||
        asString(step.name) ||
        (subagentInfo ? "invoke_subagent" : "tool");
      const toolUseId =
        asString(step.call_id) ||
        asString(step.tool_use_id) ||
        asString(step.toolUseId) ||
        asString(step.id) ||
        (stepIndex !== null ? `step_${stepIndex}` : `tool_${toolName}`);
      const rawInput =
        toolInfo?.parameters ??
        step.input ??
        step.arguments ??
        step.parameters ??
        (subagentInfo ?? {});

      const isStart =
        stepType === "tool_call" ||
        (stepType !== "tool_result" &&
          (state === "ACTIVE" ||
            state === "RUNNING" ||
            state === "PENDING" ||
            (!state &&
              toolInfo?.output === undefined &&
              step.output === undefined &&
              step.result === undefined)));

      if (isStart) {
        return [
          {
            kind: "tool_call",
            ts,
            name: toolName,
            toolUseId,
            input: rawInput,
          },
        ];
      }

      const rawOutput =
        toolInfo?.output ??
        toolInfo?.result ??
        toolInfo?.error ??
        step.output ??
        step.result ??
        step.error_message ??
        step.error;
      const isError =
        step.is_error === true ||
        state === "ERROR" ||
        state === "FAILED" ||
        Boolean(toolInfo?.error) ||
        Boolean(step.error_message);
      const content =
        rawOutput !== undefined && rawOutput !== null
          ? stringifyUnknown(rawOutput)
          : subagentInfo
            ? stringifyUnknown(subagentInfo)
            : isError
              ? `${toolName} failed`
              : `${toolName} completed`;

      return [
        {
          kind: "tool_result",
          ts,
          toolUseId,
          toolName,
          content,
          isError,
        },
      ];
    }

    if (stepType === "system_message") {
      const text = asString(step.text, asString(step.message, "")).trim();
      return text ? [{ kind: "system", ts, text }] : [];
    }

    const errorMessage = asString(step.error_message).trim();
    if ((state === "ERROR" || state === "FAILED") && errorMessage) {
      return [{ kind: "stderr", ts, text: errorMessage }];
    }

    return [];
  }

  // Result event: {"event":"result","result":{"status":"SUCCESS", ...}}
  if (eventType === "result") {
    const res = asRecord(parsed.result) ?? {};
    const usage = asRecord(res.usage) ?? {};
    const status = asString(res.status).toUpperCase();
    const isError = status === "ERROR" || status === "FAILED";
    const text = asString(res.response, asString(res.error, asString(res.message, ""))).trim();
    const errorText = asString(res.error, asString(res.message, "")).trim();

    return [
      {
        kind: "result",
        ts,
        text,
        inputTokens: asNumber(usage.input_tokens),
        outputTokens: asNumber(usage.output_tokens),
        cachedTokens: asNumber(usage.cache_read_tokens),
        costUsd: asNumber(res.cost_usd, asNumber(res.total_cost_usd, 0)),
        subtype: status ? status.toLowerCase() : "result",
        isError,
        errors: isError ? [errorText || text || "Antigravity execution failed"] : [],
      },
    ];
  }

  // Error event: {"event":"error","error":{"message":"..."}}
  if (eventType === "error") {
    const errObj = asRecord(parsed.error);
    const text = asString(errObj?.message, asString(parsed.message, "Error"));
    return [{ kind: "stderr", ts, text }];
  }

  return [{ kind: "stdout", ts, text: line }];
}
