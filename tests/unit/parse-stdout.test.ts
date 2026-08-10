import { describe, expect, it } from "vitest";
import { parseAntigravityStdoutLine } from "../../src/ui/parse-stdout.js";

const ts = "2026-05-04T05:43:45.198Z";

/**
 * Unit test suite for real-time visual stdout streaming parser.
 * Asserts the robust mapping of raw stdout line blocks to UI TranscriptEntries.
 */
describe("parseAntigravityStdoutLine", () => {
  
  /**
   * Verifies standard lines map as clean assistant transcript entries.
   */
  it("renders a normal line as an assistant transcript entry", () => {
    const entries = parseAntigravityStdoutLine("hello.", ts);
    expect(entries).toEqual([{ kind: "assistant", ts, text: "hello." }]);
  });

  /**
   * Verifies that error-prefixed stdout lines map as stderr visual entries.
   */
  it("renders error prefixed line as a stderr entry", () => {
    const entries = parseAntigravityStdoutLine("error: database failed", ts);
    expect(entries).toEqual([{ kind: "stderr", ts, text: "error: database failed" }]);
  });

  /**
   * Verifies that fatal-prefixed stdout lines map as stderr visual entries.
   */
  it("renders fatal prefixed line as a stderr entry", () => {
    const entries = parseAntigravityStdoutLine("fatal: crashed", ts);
    expect(entries).toEqual([{ kind: "stderr", ts, text: "fatal: crashed" }]);
  });

  /**
   * Ensures empty lines are silently discarded from the transcript entries.
   */
  it("returns empty array for empty line", () => {
    const entries = parseAntigravityStdoutLine("   ", ts);
    expect(entries).toEqual([]);
  });

  /**
   * Verifies NDJSON step_update text delta events map as assistant entries.
   */
  it("parses NDJSON step_update text delta events correctly", () => {
    const ndjson = '{"event":"step_update","step_update":{"text_delta":"Hello world"}}';
    const entries = parseAntigravityStdoutLine(ndjson, ts);
    expect(entries).toEqual([{ kind: "assistant", ts, text: "Hello world" }]);
  });
});
