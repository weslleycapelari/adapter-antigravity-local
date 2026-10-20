/**
 * @fileoverview End-to-end installation test suite for Paperclip AI.
 * Simulates the real Paperclip environment: packages the adapter using `npm pack`,
 * installs the resulting tarball into an isolated consumer project, writes `adapter-plugins.json`,
 * and verifies that Paperclip can import all entry points, instantiate createServerAdapter(),
 * inspect models, run testEnvironment, and decode sessions without errors.
 *
 * @copyright Antigravity Adapter Contributors
 * @license MIT
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { exec, execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

describe("Paperclip AI Adapter Installation & Verification", () => {
  let projectRoot: string;
  let tempHostDir: string;
  let tarballPath: string;

  beforeAll(async () => {
    projectRoot = process.cwd();
    tempHostDir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-install-host-"));

    // Ensure dist exists before packing
    try {
      await fs.access(path.join(projectRoot, "dist", "index.js"));
    } catch {
      await execAsync("npm run build", { cwd: projectRoot });
    }

    // Generate npm package tarball (same artifact published to npm)
    const { stdout: packStdout } = await execAsync(
      `npm pack --pack-destination "${tempHostDir}"`,
      { cwd: projectRoot },
    );

    const tarballFileName = packStdout.trim().split(/\r?\n/).pop()?.trim() || "";
    tarballPath = path.join(tempHostDir, tarballFileName);

    // Initialize an isolated consumer environment simulating ~/.paperclip/extensions
    const hostPackageJson = {
      name: "simulated-paperclip-host",
      version: "1.0.0",
      type: "module",
    };
    await fs.writeFile(
      path.join(tempHostDir, "package.json"),
      JSON.stringify(hostPackageJson, null, 2),
      "utf8",
    );

    // Install the packed adapter into the isolated host
    await execAsync(
      `npm install "${tarballPath}" --prefer-offline --ignore-scripts --no-audit --no-fund --no-progress`,
      { cwd: tempHostDir },
    );
  }, 120000);

  afterAll(async () => {
    if (tempHostDir) {
      await fs.rm(tempHostDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("successfully writes adapter-plugins.json and validates Paperclip registry contract", async () => {
    const installedModulePath = path.join(
      tempHostDir,
      "node_modules",
      "@weslleycapelari",
      "adapter-antigravity-local",
    );

    const pluginRegistry = [
      {
        id: "agy",
        type: "antigravity_local",
        packageName: "@weslleycapelari/adapter-antigravity-local",
        localPath: installedModulePath,
      },
    ];

    const registryPath = path.join(tempHostDir, "adapter-plugins.json");
    await fs.writeFile(registryPath, JSON.stringify(pluginRegistry, null, 2), "utf8");

    // Execution verification script executed in a separate Node.js process inside the consumer host
    const verifierScript = `
import fs from "node:fs/promises";
import path from "node:path";

// 1. Verify plugin manifest reading
const registry = JSON.parse(await fs.readFile("${registryPath.replace(/\\/g, "\\\\")}", "utf8"));
if (!Array.isArray(registry) || registry.length === 0) {
  throw new Error("Invalid plugin registry");
}
const plugin = registry[0];
if (plugin.type !== "antigravity_local") {
  throw new Error("Invalid plugin type: " + plugin.type);
}

// 2. Import root package and all entry points
const rootModule = await import("@weslleycapelari/adapter-antigravity-local");
const serverModule = await import("@weslleycapelari/adapter-antigravity-local/server");
const uiModule = await import("@weslleycapelari/adapter-antigravity-local/ui");
const cliModule = await import("@weslleycapelari/adapter-antigravity-local/cli");

// 3. Verify createServerAdapter contract
const serverAdapter = rootModule.createServerAdapter();
if (serverAdapter.type !== "antigravity_local") {
  throw new Error("Adapter type mismatch: " + serverAdapter.type);
}
if (typeof serverAdapter.execute !== "function") {
  throw new Error("Missing execute method on serverAdapter");
}
if (typeof serverAdapter.testEnvironment !== "function") {
  throw new Error("Missing testEnvironment method on serverAdapter");
}
if (serverAdapter.supportsLocalAgentJwt !== true) {
  throw new Error("Missing supportsLocalAgentJwt on serverAdapter");
}
if (!Array.isArray(serverAdapter.models) || serverAdapter.models.length === 0) {
  throw new Error("Missing or empty models list");
}

// Check key models
const modelIds = serverAdapter.models.map(m => m.id);
const requiredModels = [
  "inherit",
  "gemini-4-argon-high",
  "gemini-3.8-flash-high",
  "claude-opus-5-5-high",
  "gpt-oss-120b-medium"
];
for (const req of requiredModels) {
  if (!modelIds.includes(req)) {
    throw new Error("Required model missing from installed adapter: " + req);
  }
}

// 4. Verify UI configuration builder
const uiConfig = uiModule.buildAntigravityLocalConfig({
  model: "gemini-4-argon-high",
  thinkingEffort: "high",
  dangerouslySkipPermissions: true,
  command: "agy"
});
if (uiConfig.effort !== "high" || uiConfig.dangerouslySkipPermissions !== true) {
  throw new Error("UI config builder failed");
}

// 5. Verify UI stdout parser
const parsedTranscript = uiModule.parseAntigravityStdoutLine(
  JSON.stringify({
    event: "step_update",
    step_update: {
      step_index: 1,
      state: "ACTIVE",
      step_type: "agent_response",
      text_delta: "Hello from Antigravity!"
    }
  })
);
if (!Array.isArray(parsedTranscript) || !parsedTranscript[0]?.text?.includes("Hello from Antigravity!")) {
  throw new Error("UI stdout parser failed");
}

// 6. Verify CLI event formatter
if (typeof cliModule.printAntigravityStreamEvent !== "function") {
  throw new Error("CLI printAntigravityStreamEvent missing");
}

// 7. Verify sessionCodec
const serialized = serverModule.sessionCodec.serialize({
  sessionId: "conv-test-123",
  cwd: process.cwd(),
  accountProfile: "account-1"
});
const deserialized = serverModule.sessionCodec.deserialize(serialized);
if (!deserialized || deserialized.sessionId !== "conv-test-123" || deserialized.accountProfile !== "account-1") {
  throw new Error("sessionCodec roundtrip failed");
}
const displayId = serverModule.sessionCodec.getDisplayId(serialized);
if (displayId !== "conv-test-123") {
  throw new Error("sessionCodec getDisplayId failed: " + displayId);
}

console.log(JSON.stringify({
  success: true,
  installedVersion: rootModule.type,
  totalModels: serverAdapter.models.length,
  models: modelIds
}));
`;

    const scriptPath = path.join(tempHostDir, "verify.mjs");
    await fs.writeFile(scriptPath, verifierScript, "utf8");

    const { stdout } = await execFileAsync(process.execPath, [scriptPath], {
      cwd: tempHostDir,
    });

    const verificationResult = JSON.parse(stdout.trim());
    expect(verificationResult.success).toBe(true);
    expect(verificationResult.installedVersion).toBe("antigravity_local");
    expect(verificationResult.totalModels).toBeGreaterThanOrEqual(15);
    expect(verificationResult.models).toContain("inherit");
    expect(verificationResult.models).toContain("gemini-4-argon-high");
    expect(verificationResult.models).toContain("claude-opus-5-5-high");
    expect(verificationResult.models).toContain("gpt-oss-120b-medium");
  }, 60000);
});
