import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServerAdapter } from "../../src/index.js";

const execFileAsync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { promisify } = await import("node:util");
  return {
    ...actual,
    execFile: Object.assign(() => {}, { [promisify.custom]: execFileAsync }),
  };
});

const neon = { id: "gemini-4-neon-xhigh", label: "Gemini 4 Neon (XHigh)" };
const hydrogen = { id: "gemini-4-hydrogen-high", label: "Gemini 4 Hydrogen (High)" };

describe("Paperclip model discovery", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(100_000);
    execFileAsync.mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  it("returns the CLI catalog in order with the inherit option", async () => {
    const adapter = createServerAdapter();
    execFileAsync.mockResolvedValue({
      stdout: [
        "Fetching available models...",
        `${neon.id}\t${neon.label}`,
        `${hydrogen.id}\t${hydrogen.label}`,
        `${neon.id}\tDuplicate`,
        "inherit\tDuplicate inherit",
        "empty-label\t",
      ].join("\r\n"),
    });

    expect(await adapter.listModels?.()).toEqual([adapter.models?.[0], neon, hydrogen]);
    expect(execFileAsync).toHaveBeenCalledWith("agy", ["models"], {
      timeout: 15_000,
      killSignal: "SIGKILL",
      windowsHide: true,
    });
  });

  it("shares a lookup, caches the catalog, and replaces it on refresh or expiry", async () => {
    const adapter = createServerAdapter();
    execFileAsync
      .mockResolvedValueOnce({ stdout: `${neon.id}\t${neon.label}` })
      .mockResolvedValueOnce({ stdout: `${hydrogen.id}\t${hydrogen.label}` })
      .mockResolvedValueOnce({ stdout: `${neon.id}\t${neon.label}` });

    const [first, concurrent] = await Promise.all([adapter.listModels?.(), adapter.refreshModels?.()]);
    expect(first).toEqual([adapter.models?.[0], neon]);
    expect(concurrent).toEqual(first);
    expect(await adapter.listModels?.()).toEqual(first);
    expect(execFileAsync).toHaveBeenCalledTimes(1);

    expect(await adapter.refreshModels?.()).toEqual([adapter.models?.[0], hydrogen]);
    expect(await adapter.listModels?.()).toEqual([adapter.models?.[0], hydrogen]);
    expect(execFileAsync).toHaveBeenCalledTimes(2);

    vi.mocked(Date.now).mockReturnValue(400_001);
    expect(await adapter.listModels?.()).toEqual([adapter.models?.[0], neon]);
    expect(execFileAsync).toHaveBeenCalledTimes(3);
  });

  it("lets Paperclip fall back on errors and empty output, then retries", async () => {
    const adapter = createServerAdapter();
    execFileAsync
      .mockRejectedValueOnce(new Error("agy not found"))
      .mockResolvedValueOnce({ stdout: "No models available\n" })
      .mockResolvedValueOnce({ stdout: `${neon.id}\t${neon.label}` });

    expect(await adapter.refreshModels?.()).toEqual([]);
    expect(await adapter.listModels?.()).toEqual([]);
    expect(adapter.models).toContainEqual({ id: "inherit", label: "Auto (Inherit)" });
    expect(execFileAsync).toHaveBeenCalledTimes(1);

    vi.mocked(Date.now).mockReturnValue(130_001);
    expect(await adapter.listModels?.()).toEqual([]);
    expect(await adapter.refreshModels?.()).toEqual([adapter.models?.[0], neon]);
    expect(execFileAsync).toHaveBeenCalledTimes(3);
  });
});
