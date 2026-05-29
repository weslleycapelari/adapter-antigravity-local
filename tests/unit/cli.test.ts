import { afterEach, describe, expect, it, vi } from "vitest";
import pc from "picocolors";
import { printAntigravityStreamEvent } from "../../src/cli/format-event.js";

/**
 * Unit test suite for the CLI event stream formatting engine.
 * Spies on console.log APIs to assert terminal output strings are correctly decorated.
 */
describe("CLI format-event stream printer", () => {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  afterEach(() => {
    logSpy.mockClear();
  });

  /**
   * Asserts empty strings do not log any lines in the terminal.
   */
  it("silently ignores empty or whitespace-only lines", () => {
    printAntigravityStreamEvent("   ", false);
    expect(logSpy).not.toHaveBeenCalled();
  });

  /**
   * Asserts standard chat outputs are printed in high-visibility green.
   */
  it("prints general streaming plain-text messages in green", () => {
    printAntigravityStreamEvent("This is a response from the agent.", false);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(pc.green("This is a response from the agent."));
  });

  /**
   * Asserts explicit error prefix outputs are printed in high-visibility red.
   */
  it("prints lines starting with 'error:' in red", () => {
    printAntigravityStreamEvent("error: Failed to write scratch script to disk", false);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(pc.red("error: Failed to write scratch script to disk"));
  });

  /**
   * Asserts explicit fatal prefix outputs are printed in high-visibility red.
   */
  it("prints lines starting with 'fatal:' in red", () => {
    printAntigravityStreamEvent("fatal: Agent crashed unexpectedly", false);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(pc.red("fatal: Agent crashed unexpectedly"));
  });
});
