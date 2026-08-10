/**
 * @fileoverview Stdout stream line parser mapping CLI print messages into UI transcripts.
 * Analyzes logs and constructs typed conversational transcripts displayed to the user.
 * 
 * @copyright Antigravity Adapter Contributors
 * @license MIT
 */

import type { TranscriptEntry } from "@paperclipai/adapter-utils";

/**
 * Parses a single line of stdout captured during process executions.
 * Maps error messages to stderr kinds and general outputs to standard assistant transcript blocks.
 *
 * @param line - The raw stdout line string.
 * @param ts - Current ISO timestamp string to assign to the transcript record.
 * @returns Array representing mapped UI transcript entries.
 */
export function parseAntigravityStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const text = line.trim();
  
  if (!text) {
    return [];
  }

  // Parse structured NDJSON stream events
  if (text.startsWith("{") && text.endsWith("}")) {
    try {
      const event = JSON.parse(text);
      if (event.event === "step_update" && event.step_update?.text_delta) {
        return [{ kind: "assistant", ts, text: event.step_update.text_delta }];
      }
      if (event.event === "result" && event.result?.response) {
        return [{ kind: "assistant", ts, text: event.result.response }];
      }
      if (event.event === "error" || event.error) {
        const errText = typeof event.error === "string" ? event.error : JSON.stringify(event.error);
        return [{ kind: "stderr", ts, text: errText }];
      }
      return [];
    } catch {
      // Fallback to plain text processing below
    }
  }

  // Detect explicit errors printed to standard output streams
  const lowerText = text.toLowerCase();
  if (lowerText.startsWith("error:") || lowerText.startsWith("fatal:")) {
    return [{ kind: "stderr", ts, text }];
  }

  // Treat regular print outputs as assistant responses
  return [{ kind: "assistant", ts, text }];
}