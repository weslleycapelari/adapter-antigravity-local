# Setup Instructions

This document explains how to install, register, and configure the modern Antigravity Local Adapter for Paperclip AI.

Repository:
- `@weslleycapelari/adapter-antigravity-local`

---

## 1. Prerequisites

Ensure the following tools are installed on your environment:

- **Node.js 20+**
- **npm 9+**
- **Paperclip AI**
- **Google Antigravity CLI (`agy`)**

Verify tool availability:

```bash
node --version
npm --version
agy --version
```

Ensure you are logged into Antigravity:

```bash
agy auth login
```

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

Add the adapter registration entry:

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

---

## 4. Multi-Account Pooling Setup (Optional)

If you have multiple Google Antigravity subscription accounts (e.g. personal, work, secondary), you can configure account profiles for automatic quota balancing and 429 failover:

1. Create profile directories under your home folder:
   - `~/.gemini/antigravity-account-1/`
   - `~/.gemini/antigravity-account-2/`
2. Authenticate each profile using the `HOME` environment variable:
   ```bash
   HOME=~/.gemini/antigravity-account-1 agy auth login
   HOME=~/.gemini/antigravity-account-2 agy auth login
   ```
3. Set `accountProfile: "account-1"` in the agent configuration, or leave empty to allow the adapter's dynamic pool scheduler to distribute runs across available quota windows.

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
