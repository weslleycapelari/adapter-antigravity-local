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

  // Support structured NDJSON events emitted by --output-format stream-json
  if (line.startsWith("{") && line.endsWith("}")) {
    try {
      const event = JSON.parse(line);
      if (event.event === "step_update" && event.step_update?.text_delta) {
        process.stdout.write(pc.green(event.step_update.text_delta));
        return;
      }
      if (event.event === "error" || event.error) {
        console.log(pc.red(typeof event.error === "string" ? event.error : JSON.stringify(event.error)));
        return;
      }
      // Structural events like init/checkpoint are safely ignored in terminal text stream
      return;
    } catch {
      // Fallback to plain text processing below
    }
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