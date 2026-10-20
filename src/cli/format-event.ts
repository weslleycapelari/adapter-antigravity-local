/**
 * @fileoverview Stream event formatter for the Antigravity local CLI execution.
 * Intercepts stdout stream chunks and renders high-visibility formatted messages with colors in the terminal.
 *
 * @copyright Antigravity Adapter Contributors
 * @license MIT
 */

import pc from "picocolors";

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
 * Formats and prints streaming event logs received from the running Antigravity process.
 * Colorizes thinking deltas, agent answers, tool calls, tool results, tokens, and errors.
 *
 * @param raw - The raw text line event from the process stream.
 * @param _debug - Flag indicating debug mode. Required by CLIAdapterModule signature.
 */
export function printAntigravityStreamEvent(raw: string, _debug: boolean): void {
  const line = raw.trim();
  if (!line) return;

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    const lowerLine = line.toLowerCase();
    if (lowerLine.startsWith("error:") || lowerLine.startsWith("fatal:")) {
      console.log(pc.red(line));
      return;
    }
    console.log(line);
    return;
  }

  const eventType = asString(parsed.event).trim();

  // Init event
  if (eventType === "init") {
    const convId = asString(parsed.conversation_id);
    console.log(pc.cyan(`Antigravity init [conversation: ${convId}]`));
    return;
  }

  // Step update event
  if (eventType === "step_update") {
    const step = asRecord(parsed.step_update);
    if (!step) return;

    const stepType = asString(step.step_type).trim();
    const state = asString(step.state).trim().toUpperCase();
    const toolInfo = asRecord(step.tool_info);
    const subagentInfo = asRecord(step.subagent_info);

    if (stepType === "thinking") {
      const thinkingDelta = asString(step.thinking_delta, asString(step.text_delta));
      if (thinkingDelta) {
        process.stdout.write(pc.gray(thinkingDelta));
        return;
      }
      const thinkingText = asString(step.thinking, asString(step.text)).trim();
      if (thinkingText) {
        console.log(pc.gray(`thinking: ${thinkingText}`));
      }
      return;
    }

    if (stepType === "agent_response") {
      const thinkingDelta = asString(step.thinking_delta);
      if (thinkingDelta) {
        process.stdout.write(pc.gray(thinkingDelta));
      } else {
        const thinkingText = asString(step.thinking).trim();
        if (thinkingText) console.log(pc.gray(`thinking: ${thinkingText}`));
      }

      const delta = asString(step.text_delta);
      if (delta) {
        process.stdout.write(pc.green(delta));
      } else {
        const text = asString(step.text).trim();
        if (text) console.log(pc.green(`assistant: ${text}`));
      }

      const errorMessage = asString(step.error_message).trim();
      if ((state === "ERROR" || state === "FAILED") && errorMessage) {
        console.log(pc.red(`\nAntigravity step error: ${errorMessage}`));
      }
      return;
    }

    // Tools and Subagents
    if (
      stepType === "tool" ||
      stepType === "tool_call" ||
      stepType === "tool_result" ||
      toolInfo !== null ||
      subagentInfo !== null
    ) {
      const name =
        asString(step.tool_name) ||
        asString(toolInfo?.name) ||
        asString(step.tool) ||
        asString(step.name) ||
        (subagentInfo ? "invoke_subagent" : "tool");
      const rawInput =
        toolInfo?.parameters ??
        step.input ??
        step.arguments ??
        step.parameters ??
        subagentInfo;

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
        console.log(pc.yellow(`\ntool_call: ${name}`));
        if (rawInput !== undefined && rawInput !== null) {
          const inputRecord = asRecord(rawInput);
          if (!inputRecord || Object.keys(inputRecord).length > 0) {
            console.log(pc.gray(stringifyUnknown(rawInput)));
          }
        }
        return;
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
      const outputText = stringifyUnknown(rawOutput).trim();

      console.log((isError ? pc.red : pc.cyan)(`tool_result: ${name}${isError ? " (error)" : ""}`));
      if (outputText) {
        console.log((isError ? pc.red : pc.gray)(outputText));
      }
      return;
    }

    if (stepType === "system_message") {
      const text = asString(step.text, asString(step.message, "")).trim();
      if (text) console.log(pc.blue(`system: ${text}`));
      return;
    }

    return;
  }

  // Result event
  if (eventType === "result") {
    const res = asRecord(parsed.result) ?? {};
    const usage = asRecord(res.usage) ?? {};
    const input = asNumber(usage.input_tokens);
    const output = asNumber(usage.output_tokens);
    const cached = asNumber(usage.cache_read_tokens);
    const status = asString(res.status).toUpperCase();
    const isError = status === "ERROR" || status === "FAILED";
    const errText = asString(res.error, asString(res.message, "")).trim();

    console.log(
      (isError ? pc.red : pc.blue)(
        `\nAntigravity finished: status=${status} tokens: in=${input} out=${output} cached=${cached}`,
      ),
    );
    if (isError && errText) {
      console.log(pc.red(`Antigravity error: ${errText}`));
    }
    return;
  }

  // Error event
  if (eventType === "error") {
    const errObj = asRecord(parsed.error);
    const text = asString(errObj?.message, asString(parsed.message, "Error"));
    console.log(pc.red(`Antigravity error: ${text}`));
    return;
  }

  console.log(line);
}
