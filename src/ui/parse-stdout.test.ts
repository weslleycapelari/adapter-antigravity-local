import { describe, expect, it } from "vitest";
import { parseAntigravityStdoutLine } from "./parse-stdout.js";

const ts = "2026-05-04T05:43:45.198Z";

describe("parseAntigravityStdoutLine", () => {
  it("renders a normal line as an assistant transcript entry", () => {
    const entries = parseAntigravityStdoutLine("hello.", ts);
    expect(entries).toEqual([{ kind: "assistant", ts, text: "hello." }]);
  });

  it("renders error prefixed line as a stderr entry", () => {
    const entries = parseAntigravityStdoutLine("error: database failed", ts);
    expect(entries).toEqual([{ kind: "stderr", ts, text: "error: database failed" }]);
  });

  it("renders fatal prefixed line as a stderr entry", () => {
    const entries = parseAntigravityStdoutLine("fatal: crashed", ts);
    expect(entries).toEqual([{ kind: "stderr", ts, text: "fatal: crashed" }]);
  });

  it("returns empty array for empty line", () => {
    const entries = parseAntigravityStdoutLine("   ", ts);
    expect(entries).toEqual([]);
  });
});
