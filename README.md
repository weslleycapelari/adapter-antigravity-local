# @paperclipai/adapter-antigravity-local

An official-grade, high-performance **Paperclip AI** adapter for running **Google Antigravity** (`agy` CLI) agents locally.

This adapter enables Paperclip to leverage the native, stateful, and autonomous capabilities of the Antigravity agent engine as a drop-in replacement for the deprecated Gemini CLI integrations.

---

## Features

- ⚡ **Native Go Performance**: Spawns the local `agy` binary with fast startup and low resource consumption.
- 🤖 **Frontier Model Selection**: Dynamically routes and configures models via the `ANTIGRAVITY_MODEL` environment variable, including:
  - Gemini 3.5 Flash
  - Gemini 3.1 Pro (High & Low)
  - Claude Sonnet 4.6 (Thinking & Standard)
  - Claude Opus 4.6 (Thinking)
  - GPT-OSS 120B (Medium)
- 📁 **Multi-Workspace Sync**: Automatically maps multiple active Paperclip workspaces to `agy` using repeatable `--add-dir` CLI parameters.
- ⚙️ **Unattended Execution**: Configures execution options with `--dangerously-skip-permissions` to allow agents to work uninterrupted in headless environments.
- 🔒 **Sandboxing Support**: Optionally enforces terminal and file-system restrictions via the `--sandbox` parameter.
- 🛠️ **Diagnostics & Connection Probes**: Includes a self-test suite (`testEnvironment`) to check command availability, working directories, and API credentials.

---

## Installation

### 1. Build the Adapter
Ensure you compile the TypeScript files and copy `package.json` to the distribution folder:
```bash
npm run build
```

### 2. Link in Paperclip Web UI
1. Open your **Paperclip Web Console**.
2. Navigate to **Settings → Adapters → Install Custom Adapter**.
3. Choose the **Local Path** method and select this project's root folder:
   `/path/to/adapter-antigravity-local`
4. Click **Install**. The adapter will load the compiled JavaScript bundle from `/dist`.

---

## Configuration

When configuring a Paperclip Agent to use `antigravity_local`, the following options are supported:

| Field | Type | Description | Default |
|---|---|---|---|
| `command` | `string` | Binary command executable | `"agy"` |
| `model` | `string` | Model ID (or `"auto"` for default) | `"auto"` |
| `sandbox` | `boolean` | Enable strict sandboxing | `false` |
| `timeoutSec`| `number` | Inactivity/run timeout in seconds | `0` (None) |
| `cwd` | `string` | Workdir fallback path | `process.cwd()` |

---

## Development

- **Run Typechecking**: `npm run typecheck`
- **Build Distribution**: `npm run build`
- **Clean output**: `npm run clean`

### Testing
Unit tests are written in `vitest`. The test suite is isolated from production compilation bundles. To execute tests inside a monorepo workspace environment:
```bash
npx vitest run
```

---

## Repository
Designed and maintained by **Weslley Capelari**.
Published at [GitHub: weslleycapelari/adapter-antigravity-local](https://github.com/weslleycapelari/adapter-antigravity-local).

License: MIT
