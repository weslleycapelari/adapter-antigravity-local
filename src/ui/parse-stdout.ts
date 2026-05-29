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

  // Detect explicit errors printed to standard output streams
  const lowerText = text.toLowerCase();
  if (lowerText.startsWith("error:") || lowerText.startsWith("fatal:")) {
    return [{ kind: "stderr", ts, text }];
  }

  // Treat regular print outputs as assistant responses
  return [{ kind: "assistant", ts, text }];
}