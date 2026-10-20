/**
 * @fileoverview Integration test suite for the skills synchronization engine.
 * Spawns a sandboxed local filesystem directory to assert that symlinks
 * are correctly created and cleaned up inside ~/.gemini/antigravity-cli/skills.
 *
 * @copyright Antigravity Adapter Contributors
 * @license MIT
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { syncAntigravitySkills, listAntigravitySkills } from "../../src/server/skills.js";

let mockSourceRoot: string;

const { readPaperclipRuntimeSkillEntries } = vi.hoisted(() => ({
  readPaperclipRuntimeSkillEntries: vi.fn(),
}));

vi.mock("@paperclipai/adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/server-utils")>(
    "@paperclipai/adapter-utils/server-utils",
  );
  return {
    ...actual,
    readPaperclipRuntimeSkillEntries,
  };
});

describe("skills integration", () => {
  let tempHome: string;
  let reqSource: string;
  let optSource: string;

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "agy-skills-test-"));
    mockSourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agy-skills-source-"));
    reqSource = path.join(mockSourceRoot, "required-skill");
    optSource = path.join(mockSourceRoot, "test-skill");
    await fs.mkdir(reqSource, { recursive: true });
    await fs.mkdir(optSource, { recursive: true });

    readPaperclipRuntimeSkillEntries.mockResolvedValue([
      {
        key: "test-skill",
        runtimeName: "test-skill-plugin",
        required: false,
        source: optSource,
      },
      {
        key: "required-skill",
        runtimeName: "required-skill-plugin",
        required: true,
        source: reqSource,
      },
    ]);
  });

  afterEach(async () => {
    await fs.rm(tempHome, { recursive: true, force: true }).catch(() => {});
    await fs.rm(mockSourceRoot, { recursive: true, force: true }).catch(() => {});
    vi.clearAllMocks();
  });

  it("successfully syncs skills by creating symlinks in ~/.gemini/antigravity-cli/skills", async () => {
    const ctx = {
      config: {
        env: {
          HOME: tempHome,
        },
      },
    };

    const snapshot = await syncAntigravitySkills(ctx as any, ["test-skill"]);
    expect(snapshot.adapterType).toBe("antigravity_local");

    const skillsDir = path.join(tempHome, ".gemini", "antigravity-cli", "skills");
    const dirExists = await fs.stat(skillsDir).then((s) => s.isDirectory()).catch(() => false);
    expect(dirExists).toBe(true);

    const requiredLink = path.join(skillsDir, "required-skill-plugin");
    const optionalLink = path.join(skillsDir, "test-skill-plugin");

    const requiredTarget = await fs.readlink(requiredLink);
    const optionalTarget = await fs.readlink(optionalLink);

    expect(path.resolve(requiredTarget)).toBe(path.resolve(reqSource));
    expect(path.resolve(optionalTarget)).toBe(path.resolve(optSource));
  });

  it("removes unselected optional symlinks from the skills directory", async () => {
    const ctx = {
      config: {
        env: {
          HOME: tempHome,
        },
      },
    };

    await syncAntigravitySkills(ctx as any, ["test-skill"]);
    await syncAntigravitySkills(ctx as any, []);

    const skillsDir = path.join(tempHome, ".gemini", "antigravity-cli", "skills");
    const optionalLink = path.join(skillsDir, "test-skill-plugin");
    const requiredLink = path.join(skillsDir, "required-skill-plugin");

    const optionalExists = await fs.stat(optionalLink).catch(() => false);
    expect(optionalExists).toBe(false);

    const requiredExists = await fs.readlink(requiredLink).catch(() => null);
    expect(requiredExists).not.toBeNull();
  });

  it("successfully lists all registered and available skills using listAntigravitySkills", async () => {
    const ctx = {
      config: {
        env: {
          HOME: tempHome,
        },
      },
    };

    await syncAntigravitySkills(ctx as any, ["test-skill"]);
    const snapshot = await listAntigravitySkills(ctx as any);

    expect(snapshot.adapterType).toBe("antigravity_local");
    expect(snapshot.entries.length).toBe(2);
  });
});
