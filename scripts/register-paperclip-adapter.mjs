#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const packageName = "@weslleycapelari/adapter-antigravity-local";
const adapterType = "antigravity_local";
const home = homedir();
const manifestPath = join(home, ".paperclip", "adapter-plugins.json");
const packageDir = join(
  home,
  ".paperclip",
  "extensions",
  "node_modules",
  "@weslleycapelari",
  "adapter-antigravity-local"
);
const entrypointPath = join(packageDir, "dist", "index.js");

if (!existsSync(entrypointPath)) {
  throw new Error(
    `Built adapter not found at ${entrypointPath}. Build and install it into ~/.paperclip/extensions first.`
  );
}

let adapters = [];
if (existsSync(manifestPath)) {
  adapters = JSON.parse(readFileSync(manifestPath, "utf8"));

  if (
    !Array.isArray(adapters) ||
    !adapters.every(
      (adapter) => adapter && typeof adapter === "object" && !Array.isArray(adapter)
    )
  ) {
    throw new Error(`${manifestPath} must contain a JSON array of adapter objects.`);
  }
}

const entry = {
  id: "agy",
  type: adapterType,
  packageName,
  localPath: packageDir,
};

const existingIndex = adapters.findIndex(
  (adapter) =>
    adapter.id === entry.id ||
    adapter.type === entry.type ||
    adapter.packageName === entry.packageName
);

if (existingIndex >= 0) {
  adapters[existingIndex] = { ...adapters[existingIndex], ...entry };
} else {
  adapters.push(entry);
}

mkdirSync(join(home, ".paperclip"), { recursive: true });
writeFileSync(manifestPath, `${JSON.stringify(adapters, null, 2)}\n`);

console.log(
  `Registered ${adapterType} at ${packageDir} in ${manifestPath}; other adapter entries were preserved.`
);
