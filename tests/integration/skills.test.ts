import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { syncAntigravitySkills } from "../../src/server/skills.js";

const { readPaperclipRuntimeSkillEntries } = vi.hoisted(() => ({
  readPaperclipRuntimeSkillEntries: vi.fn(async () => [
    {
      key: "test-skill",
      runtimeName: "test-skill-plugin",
      required: false,
      source: "/mock/source/test-skill",
    },
    {
      key: "required-skill",
      runtimeName: "required-skill-plugin",
      required: true,
      source: "/mock/source/required-skill",
    },
  ]),
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

/**
 * Integration test suite for the skills/plugins synchronization engine.
 * Spawns a sandboxed local filesystem directory to assert that symlinks 
 * are correctly created and cleaned up inside ~/.agy/plugins.
 */
describe("skills integration", () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "agy-skills-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempHome, { recursive: true, force: true }).catch(() => {});
    vi.clearAllMocks();
  });

  /**
   * Asserts that desired/selected skills are correctly resolved and symlinked 
   * under the active home's plugins directory.
   */
  it("successfully syncs skills by creating symlinks in ~/.agy/plugins", async () => {
    const ctx = {
      config: {
        env: {
          HOME: tempHome,
        },
      },
    };

    const snapshot = await syncAntigravitySkills(ctx as any, ["test-skill"]);

    expect(snapshot.adapterType).toBe("antigravity_local");
    
    const pluginsDir = path.join(tempHome, ".agy", "plugins");
    
    const dirExists = await fs.stat(pluginsDir).then(s => s.isDirectory()).catch(() => false);
    expect(dirExists).toBe(true);

    const requiredLink = path.join(pluginsDir, "required-skill-plugin");
    const optionalLink = path.join(pluginsDir, "test-skill-plugin");

    const requiredTarget = await fs.readlink(requiredLink);
    const optionalTarget = await fs.readlink(optionalLink);

    expect(requiredTarget).toBe("/mock/source/required-skill");
    expect(optionalTarget).toBe("/mock/source/test-skill");
  });

  /**
   * Ensures that when optional skills are unselected, their corresponding symlinks 
   * are cleanly unlinked/deleted from the plugins home directory on disk.
   */
  it("removes unselected optional symlinks from the plugins directory", async () => {
    const ctx = {
      config: {
        env: {
          HOME: tempHome,
        },
      },
    };

    await syncAntigravitySkills(ctx as any, ["test-skill"]);

    await syncAntigravitySkills(ctx as any, []);

    const pluginsDir = path.join(tempHome, ".agy", "plugins");
    const optionalLink = path.join(pluginsDir, "test-skill-plugin");
    const requiredLink = path.join(pluginsDir, "required-skill-plugin");

    const optionalExists = await fs.stat(optionalLink).catch(() => false);
    expect(optionalExists).toBe(false);

    const requiredExists = await fs.readlink(requiredLink).catch(() => null);
    expect(requiredExists).toBe("/mock/source/required-skill");
  });

  /**
   * Scenario: listAntigravitySkills.
   * Confirms listing resolved skills snapshots correctly without altering paths.
   */
  it("successfully lists all registered and available skills using listAntigravitySkills", async () => {
    const ctx = {
      config: {
        env: {
          HOME: tempHome,
        },
        paperclipSkillSync: {
          desiredSkills: ["test-skill"],
        },
      },
    };

    // First install symlinks
    await syncAntigravitySkills(ctx as any, ["test-skill"]);

    // Then list
    const snapshot = await syncAntigravitySkills(ctx as any, ["test-skill"]);
    
    expect(snapshot.adapterType).toBe("antigravity_local");
    expect(snapshot.desiredSkills).toContain("test-skill");
    expect(snapshot.desiredSkills).toContain("required-skill");
    expect(snapshot.entries.length).toBe(2);
  });

  /**
   * Scenario: resolveAntigravityDesiredSkillNames.
   * Asserts fallback resolving of active desired skill names dictionary arrays.
   */
  it("resolves desired skill names correctly based on configuration", async () => {
    const { resolveAntigravityDesiredSkillNames } = await import("../../src/server/skills.js");

    const config = {
      paperclipSkillSync: {
        desiredSkills: ["test-skill"],
      },
    };
    const available = [
      { key: "test-skill", required: false },
      { key: "required-skill", required: true },
    ];

    const result = resolveAntigravityDesiredSkillNames(config, available);
    expect(result).toContain("test-skill");
  });
});
