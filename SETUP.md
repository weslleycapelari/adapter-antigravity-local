# Setup Instructions

This document explains how to install, register, and configure the modern Antigravity Local Adapter for Paperclip AI.

Repository:
- `@weslleycapelari/adapter-antigravity-local`

---

## 1. Prerequisites

Ensure the following tools are installed on your environment:

- **Node.js 24.11+**
- **npm 9+**
- **Paperclip AI**
- **Google Antigravity CLI (`agy`)**

Verify tool availability:

```bash
node --version
npm --version
agy --version
```

Antigravity CLI 1.4.12 signs in when you launch it. `agy auth login` is not a valid subcommand:

```bash
cd "$HOME"
agy
```

Complete browser sign-in if prompted. If your account appears in the CLI header, you are already authenticated. Exit with **Ctrl+C**.

---

## 2. Install the Adapter

Navigate to your Paperclip extensions directory:

```bash
cd ~/.paperclip/extensions
npm install @weslleycapelari/adapter-antigravity-local
```

Alternatively, if developing locally from source:

```bash
cd /path/to/adapter-antigravity-local
npm install
npm run build
```

---

## 3. Register the Adapter Plugin

Edit or create the plugin manifest:

```text
~/.paperclip/adapter-plugins.json
```

Add this entry to the manifest array, preserving any other adapters already listed:

```json
[
  {
    "id": "agy",
    "type": "antigravity_local",
    "packageName": "@weslleycapelari/adapter-antigravity-local",
    "localPath": "~/.paperclip/extensions/node_modules/@weslleycapelari/adapter-antigravity-local"
  }
]
```

> **Important**: The property `"type": "antigravity_local"` must match exactly so Paperclip renders the modern settings schema and tools UI.

If you installed from the source branch, you can create or update this entry without editing JSON manually by running `npm run paperclip:register` from the adapter repository root.

---

## 4. Multi-Account Pooling Setup (Optional)

If you have multiple Google Antigravity subscription accounts (e.g. personal, work, secondary), you can configure account profiles for automatic quota balancing and 429 failover:

The default account uses your regular operating-system home directory. Named profiles use isolated homes under `~/.paperclip/credentials/antigravity/<account-key>/`. For example, the adapter expects account tokens at:

- `~/.paperclip/credentials/antigravity/account-1/.gemini/antigravity-cli/antigravity-oauth-token`
- `~/.paperclip/credentials/antigravity/account-2/.gemini/antigravity-cli/antigravity-oauth-token`

On macOS and Linux, create the named profile homes:

```bash
mkdir -p "$HOME/.paperclip/credentials/antigravity/account-1"
mkdir -p "$HOME/.paperclip/credentials/antigravity/account-2"
```

The installed Antigravity CLI 1.4.12 does not provide an `agy auth login` subcommand. Its interactive sign-in uses the system keyring; authenticating separate named accounts by changing `HOME` has not been verified. Do not assume that launching `agy` with a different `HOME` creates a separate profile. The adapter recognizes a named profile only when its expected token file exists.

On Windows, the adapter sets both home variables for named-account runs. Separate accounts still depend on the installed CLI's credential storage behavior; if it does not write a token into the expected profile home, the adapter cannot recognize separate named accounts.

The adapter recognizes a named profile when its token file exists and contains an access or refresh token. Check that the expected file exists without printing its contents. Then set `accountProfile: "account-1"` in the agent configuration, run a small heartbeat, and confirm the selected profile in the Paperclip run details. Leave `accountProfile` empty to let the adapter's dynamic pool scheduler distribute runs across available quota windows.

Profiles previously created under `~/.gemini/antigravity-account-*` are not moved or deleted. Back up credentials before any manual migration.

---

## 5. Restart Paperclip

Stop the running Paperclip daemon and restart:

```bash
npx paperclipai run
```

---

## 6. Verify Installation

1. Open the Paperclip Web UI (`http://localhost:3100`).
2. Navigate to **Agents** ➔ **Create Agent** (or edit an existing one).
3. Select **Antigravity CLI** in the Adapter dropdown.
4. Verify modern models appear in the Model dropdown:
   - `Gemini 4 Argon (High)`
   - `Gemini 3.8 Flash (High)`
   - `Claude Opus 5.5 (High)`
   - `Claude Sonnet 5.5 (High)`
   - `GPT-OSS 120B (Medium)`
5. Run an agent heartbeat and confirm live streaming logs, reasoning tokens, and tools execution.
