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

The default account uses your regular operating-system home directory. Named profiles use isolated homes under `~/.paperclip/credentials/antigravity/<account-key>/`. For example, the adapter expects account tokens at:

- `~/.paperclip/credentials/antigravity/account-1/.gemini/antigravity-cli/antigravity-oauth-token`
- `~/.paperclip/credentials/antigravity/account-2/.gemini/antigravity-cli/antigravity-oauth-token`

On macOS and Linux, create the named profile homes and authenticate each one with that home active:

```bash
mkdir -p "$HOME/.paperclip/credentials/antigravity/account-1"
mkdir -p "$HOME/.paperclip/credentials/antigravity/account-2"

HOME="$HOME/.paperclip/credentials/antigravity/account-1" agy auth login
HOME="$HOME/.paperclip/credentials/antigravity/account-2" agy auth login
```

On Windows PowerShell, set both `HOME` and `USERPROFILE` for the login command, then restore them:

```powershell
$profileHome = Join-Path $env:USERPROFILE ".paperclip\credentials\antigravity\account-1"
New-Item -ItemType Directory -Force -Path $profileHome | Out-Null
$oldHome = $env:HOME
$oldUserProfile = $env:USERPROFILE
try {
  $env:HOME = $profileHome
  $env:USERPROFILE = $profileHome
  agy auth login
} finally {
  $env:HOME = $oldHome
  $env:USERPROFILE = $oldUserProfile
}
```

The adapter recognizes a named profile when its token file exists and contains an access or refresh token. Check that the expected file exists without printing its contents. Then set `accountProfile: "account-1"` in the agent configuration, run a small heartbeat, and confirm the selected profile in the Paperclip run details. Leave `accountProfile` empty to let the adapter's dynamic pool scheduler distribute runs across available quota windows.

Profiles previously created under `~/.gemini/antigravity-account-*` are not moved or deleted. Authenticate again with the isolated home above, or back up and manually migrate credentials if your CLI version supports that safely.

On Windows, the adapter sets both home variables for named-account runs. Separate accounts still depend on the installed CLI's credential storage behavior; if `agy auth login` only stores a shared Windows Credential Manager entry and does not write the expected profile token file, the adapter cannot recognize separate named accounts.

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
