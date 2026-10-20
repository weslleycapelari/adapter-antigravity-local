/**
 * @fileoverview Unit test suite for createUsageCheckpointLog.
 * Verifies stream buffering, JSON deduplication, onUsage notification triggers, and flushing.
 *
 * @copyright Antigravity Adapter Contributors
 * @license MIT
 */

import { describe, expect, it, vi } from "vitest";
import { createUsageCheckpointLog } from "../../src/server/usage-checkpoint.js";

describe("createUsageCheckpointLog", () => {
  it("forwards logs to onLog delegate", async () => {
    const onLog = vi.fn(async () => {});
    const log = createUsageCheckpointLog(onLog, undefined, () => ({}));

    await log("stdout", "hello");
    await log("stderr", "world");

    expect(onLog).toHaveBeenCalledTimes(2);
    expect(onLog).toHaveBeenNthCalledWith(1, "stdout", "hello");
    expect(onLog).toHaveBeenNthCalledWith(2, "stderr", "world");
  });

  it("buffers stdout and notifies onUsage when extracted accounting changes", async () => {
    const onUsage = vi.fn(async () => {});
    const extract = (stdout: string) => {
      const tokens = stdout.length;
      return { tokens, complete: stdout.includes("DONE") };
    };

    const log = createUsageCheckpointLog(undefined, onUsage, extract);

    await log("stdout", "part1 ");
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenLastCalledWith({ tokens: 6, complete: false });

    // Emitting on stderr should not re-trigger usage extraction
    await log("stderr", "warning");
    expect(onUsage).toHaveBeenCalledTimes(1);

    await log("stdout", "DONE");
    expect(onUsage).toHaveBeenCalledTimes(2);
    expect(onUsage).toHaveBeenLastCalledWith({ tokens: 10, complete: true });
  });

  it("flushes latest checkpoint on flush()", async () => {
    let currentTokens = 10;
    const onUsage = vi.fn(async () => {});
    const extract = () => ({ tokens: currentTokens });

    const log = createUsageCheckpointLog(undefined, onUsage, extract);
    await log("stdout", "data");
    expect(onUsage).toHaveBeenCalledTimes(1);

    // Modify state without new log
    currentTokens = 25;
    await log.flush();
    expect(onUsage).toHaveBeenCalledTimes(2);
    expect(onUsage).toHaveBeenLastCalledWith({ tokens: 25 });
  });
});
