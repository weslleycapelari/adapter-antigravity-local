# Paperclip Setup: Antigravity Local Adapter

This guide installs the adapter from the `codex/fix-three-antigravity-issues` branch, registers it with a local Paperclip instance, authenticates the local Antigravity CLI, restarts Paperclip, and creates a first agent.

These commands target macOS with Paperclip running locally as the same user who runs `agy`. Linux is similar; Windows uses different paths and shell syntax.

## 1. Prerequisites

Install and verify:

- Node.js 24.11 or newer
- npm
- Paperclip AI
- Google Antigravity CLI (`agy`)

The adapter's Paperclip utility dependency requires Node.js 24.11 or newer. Check your versions:

```bash
node --version
npm --version
agy --version
```

Paperclip and `agy` should run under the same macOS account so the adapter can find the CLI and its saved credentials. If Paperclip is running in a container or on another host, install the adapter and `agy` in that environment instead.

## 2. Get and build the adapter branch

If you already have a clone, update it:

```bash
cd /path/to/adapter-antigravity-local
git switch codex/fix-three-antigravity-issues
git pull --ff-only origin codex/fix-three-antigravity-issues
```

If you do not have a clone yet:

```bash
mkdir -p "$HOME/src"
cd "$HOME/src"
git clone --branch codex/fix-three-antigravity-issues \
  https://github.com/kevin-kurian/adapter-antigravity-local.git
cd adapter-antigravity-local
```

From the adapter repository root, install development dependencies and build the package:

```bash
npm install
npm run build
```

If npm warns that the optional `fsevents` install script is not approved, you can continue if the build succeeds. Avoid approving all dependency scripts just to clear that warning.

Install the built package into Paperclip's extensions directory:

```bash
mkdir -p "$HOME/.paperclip/extensions"
npm install --prefix "$HOME/.paperclip/extensions" "$PWD"
```

Build before installing: this repository keeps compiled `dist` files out of Git, and Paperclip loads the compiled package.

## 3. Register the adapter with Paperclip

Run this from any directory. It adds or updates this adapter's entry in `~/.paperclip/adapter-plugins.json` and preserves other registered adapters:

```bash
node <<'NODE'
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const home = os.homedir();
const manifest = path.join(home, ".paperclip", "adapter-plugins.json");
const packageDir = path.join(
  home,
  ".paperclip",
  "extensions",
  "node_modules",
  "@weslleycapelari",
  "adapter-antigravity-local"
);

if (!fs.existsSync(path.join(packageDir, "dist", "index.js"))) {
  throw new Error(`Built adapter not found at ${packageDir}; complete step 2 first.`);
}

const adapters = fs.existsSync(manifest)
  ? JSON.parse(fs.readFileSync(manifest, "utf8"))
  : [];

if (!Array.isArray(adapters)) {
  throw new Error(`${manifest} must contain a JSON array.`);
}

const entry = {
  id: "agy",
  type: "antigravity_local",
  packageName: "@weslleycapelari/adapter-antigravity-local",
  localPath: packageDir,
};

const index = adapters.findIndex(
  (adapter) => adapter.id === entry.id || adapter.type === entry.type
);

if (index >= 0) {
  adapters[index] = { ...adapters[index], ...entry };
} else {
  adapters.push(entry);
}

fs.mkdirSync(path.dirname(manifest), { recursive: true });
fs.writeFileSync(manifest, `${JSON.stringify(adapters, null, 2)}\n`);
console.log(`Registered ${entry.type} at ${entry.localPath}`);
NODE
```

The adapter type must be exactly `antigravity_local`.

## 4. Authenticate Antigravity CLI

`agy auth login` is not a valid command in Antigravity CLI 1.4.12. Authentication starts when you launch the CLI; it uses a saved session if one exists and prompts for Google sign-in when needed.

```bash
cd "$HOME"
agy
```

If prompted, complete sign-in in the browser. Confirm the signed-in account appears in the CLI header, then exit the CLI with **Ctrl+C**. If an account is already shown, you are authenticated.

## 5. Restart Paperclip

In the terminal running Paperclip, stop the current process with **Ctrl+C**. Then restart it from your Paperclip working directory. For the local `npx` installation used in this guide:

```bash
cd "$HOME"
npx paperclipai run
```

Leave this terminal open while using Paperclip. If you run Paperclip as a background service or through another process manager, restart it through that same manager.

On startup, expect log messages similar to:

```text
Loading external adapter package ... @weslleycapelari/adapter-antigravity-local ...
Loaded external adapters from plugin store {"count":1,"adapters":["antigravity_local"]}
```

## 6. Create your first Antigravity agent

1. Open [http://127.0.0.1:3100](http://127.0.0.1:3100).
2. Go to **Agents** and choose **Create Agent**.
3. Enter the agent's name and other required details.
4. On the **Adapter** step, select **Antigravity** (the top-left tile), not **Gemini CLI**.
5. Select a concrete model from the model menu. To avoid Argon on a Google AI Pro account, choose **Gemini 3.8 Flash (High)**. Model availability depends on your account and can change; choose a model shown as available in the menu.
6. Select the company and workspace/repository the agent should use, complete any remaining required settings, and save the agent.
7. Open the new agent and run a heartbeat or test run with a simple prompt.
8. Confirm that the run completes and produces an answer. Open the run details to inspect its logs and selected model.

The adapter passes a concrete selected model to `agy`. Choose an explicit model instead of **Default** or **Auto (Inherit)** when you want to control which model runs.

## 7. Optional: named account profiles

The default account uses the normal user home. Named profiles are resolved under:

```text
~/.paperclip/credentials/antigravity/<account-key>/
```

The adapter looks for the profile token at:

```text
~/.paperclip/credentials/antigravity/<account-key>/.gemini/antigravity-cli/antigravity-oauth-token
```

Antigravity CLI 1.4.12 uses its interactive sign-in flow and does not provide an `agy auth login` subcommand. Separate named-profile authentication has not been verified with that CLI version; do not assume that launching `agy` with a different `HOME` creates a separate account. For a reliable first setup, use the default account. If using named profiles, confirm the expected token file exists without displaying its contents, run a small heartbeat with that profile selected, and verify the selected profile in Paperclip.

---

For additional Antigravity CLI authentication details, see the [official installation and authentication guide](https://antigravity.google/docs/install).
