# @weslleycapelari/adapter-antigravity-local

[![npm version](https://img.shields.io/npm/v/@weslleycapelari/adapter-antigravity-local.svg?style=flat-square)](https://www.npmjs.com/package/@weslleycapelari/adapter-antigravity-local)
[![Build & Test Status](https://img.shields.io/github/actions/workflow/status/weslleycapelari/adapter-antigravity-local/publish.yml?style=flat-square)](https://github.com/weslleycapelari/adapter-antigravity-local/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Tests Passed](https://img.shields.io/badge/Tests--Passed-62%20/%2062-brightgreen?style=flat-square)](tests)

An official-grade, high-performance **Paperclip AI** adapter designed by **Weslley Capelari** for running **Google Antigravity** (`agy` CLI) agents locally.

This adapter acts as a drop-in, robust, and type-safe replacement for the deprecated Gemini CLI integrations, leveraging the native, stateful, and autonomous capabilities of the modern Google Antigravity agent engine.

---

## ⚡ Key Features

- **🚀 Native Go CLI Performance**: Spawns the local `agy` binary with fast startup times, low system footprint, and real-time terminal stdout streaming.
- **🧠 Dynamic Model Routing**: Routes models dynamically via the `ANTIGRAVITY_MODEL` environment variable (rather than invalid CLI flags), mapping descriptive IDs and model profiles:
  - **Gemini 3.5 Flash** (`gemini-3.5-flash`)
  - **Gemini 3.1 Pro** (`gemini-3.1-pro-high` & `gemini-3.1-pro-low`)
  - **Claude 4.6 Sonnet** (`claude-sonnet-4.6-thinking` & `claude-sonnet-4.6-standard`)
  - **Claude 4.6 Opus** (`claude-opus-4.6-thinking`)
  - **GPT-OSS 120B** (`gpt-oss-120b-medium`)
- **📂 Multi-Workspace Sync**: Automatically registers and mounts multiple active Paperclip workspaces into `agy` using repeatable `--add-dir <cwd>` arguments.
- **⚙️ Headless Resiliency**: Enforces unattended command executions with `--dangerously-skip-permissions` to bypass OS prompt gates in headless containers.
- **🔒 Isolated Sandboxing**: Enforces strict execution limits and file-system restrictions by appending the `--sandbox` parameter.
- **🛠️ Self-Testing Diagnostics**: Bundles the `testEnvironment` probe checking command availability, workspace permissions, environment variables, and live API credentials via an active "hello" telemetry probe.
- **🛡️ Edge Case Mitigation**: Built-in regex parsers resistant to irregular spacing, multiline empty logs, case-insensitive outputs, and rate limits (HTTP 429).

---

## 📦 Installation & Setup

### 1. Installation via NPM

Install the adapter globally or within your Paperclip workspace scope:

```bash
npm install @weslleycapelari/adapter-antigravity-local
```

### 2. Manual Development Installation

To work on modifications locally, clone the repository and build the distribution assets:

```bash
# Clone the repository
git clone https://github.com/weslleycapelari/adapter-antigravity-local.git
cd adapter-antigravity-local

# Install developer dependencies
npm install

# Compile TypeScript production files
npm run build
```

---

## 🔌 Linking in the Paperclip Web UI

1. Open your **Paperclip Web Console**.
2. Navigate to **Settings** ➔ **Adapters** ➔ **Install Custom Adapter**.
3. Choose the **Local Path** method.
4. Select the absolute path to this project's root folder:
   `/home/<user>/projects/adapter-antigravity-local`
5. Click **Install**. The adapter will automatically load the compiled JavaScript bundle from `./dist/index.js`.

---

## ⚙️ Configuration Schema

When configuring a Paperclip Agent to use the `antigravity_local` adapter, define the following variables in the agent settings panel:

| Option Key | Type | Description | Default |
|---|---|---|---|
| `command` | `string` | Binary command executable path or system command name. | `"agy"` |
| `model` | `string` | Target model profile or custom model name (binds to env). | `"claude-sonnet-4.6-thinking"` |
| `sandbox` | `boolean` | Enforces strict OS/Terminal sandbox jail isolation. | `false` |
| `cwd` | `string` | Absolute working directory context path fallback. | `process.cwd()` |
| `timeoutSec` | `number` | Inactivity/run timeout duration in seconds. | `0` (Disabled) |
| `extraArgs` | `string` | Comma-separated list of custom CLI parameters. | `""` |
| `envVars` | `string` | Multi-line `KEY=VALUE` environment variables. | `""` |
| `envBindings`| `object` | Structured credentials mappings and secrets references. | `{}` |

---

## 🧪 Architecture Quality & Testing (TDD)

We maintain a senior-grade quality gate enforced by **62 unit & integration tests** running on **Vitest**. The test suite is isolated from production compilation bundles.

### Execute the Test Suite

```bash
npm test
```

*Runs 62 tests across CLI color event formatters, UI config builders, session serializers/deserializers, skills symlink managers, and environment probes in less than `0.6s`.*

### TypeScript Validation

Validate all typings and module contracts:

```bash
npm run typecheck
```

---

## 🤖 DevOps & CI/CD Pipeline

We bundle a production-ready GitHub Action in `.github/workflows/publish.yml` that automates releases:

### 1. Automated Triggers

Whenever you push a version tag starting with `v` (e.g., `v1.0.0`), the pipeline:
1. Performs checkout and sets up Node 20.
2. Installs clean developer locks (`npm ci`).
3. Runs the strict compiler typecheck (`npm run typecheck`).
4. Runs all **62 quality tests** (`npm test`). **Any failure aborts publication.**
5. Compiles production assets (`npm run build`).
6. Publishes `@weslleycapelari/adapter-antigravity-local` to the public npm registry.
7. Creates a formal **GitHub Release** with notes generated automatically.

### 2. Secret Settings

For this to execute successfully, configure a secret named `NPM_TOKEN` in your GitHub Repository settings (**Settings ➔ Secrets and variables ➔ Actions**) containing an npm Access Token with publish permissions.

### 3. Publishing steps

```bash
# Tag the new production release
git tag v1.0.0

# Push the tag to GitHub to fire CI/CD
git push origin v1.0.0
```

---

## 👥 Authors & Maintainers

- Designed, built, and maintained by **Weslley Capelari**.
- Open-source repository: [GitHub: weslleycapelari/adapter-antigravity-local](https://github.com/weslleycapelari/adapter-antigravity-local).

License: [MIT](LICENSE) — Feel free to use, modify, and distribute.
