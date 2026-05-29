/**
 * @fileoverview Stream event formatter for the Antigravity local CLI execution.
 * Intercepts stdout chunks and outputs formatted messages with custom colors in the terminal.
 * 
 * @copyright Antigravity Adapter Contributors
 * @license MIT
 */

import pc from "picocolors";

/**
 * Formats and prints streaming event logs received from the running Antigravity process.
 * Matches errors or plain text chunks and colors them appropriately before logging.
 *
 * @param raw - The raw text line event from the process stream.
 * @param _debug - Flag indicating debug mode. Required by CLIAdapterModule signature, internally ignored.
 */
export function printAntigravityStreamEvent(raw: string, _debug: boolean): void {
  const line = raw.trim();
  if (!line) {
    return;
  }

  // Intercept explicit errors printed during stream sessions
  const lowerLine = line.toLowerCase();
  if (lowerLine.startsWith("error:") || lowerLine.startsWith("fatal:")) {
    console.log(pc.red(line));
    return;
  }

  // For regular plain-text outputs, log in high-visibility green
  console.log(pc.green(line));
}