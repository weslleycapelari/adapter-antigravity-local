# @weslleycapelari/adapter-antigravity-local

[![npm version](https://img.shields.io/npm/v/@weslleycapelari/adapter-antigravity-local.svg?style=flat-square)](https://www.npmjs.com/package/@weslleycapelari/adapter-antigravity-local)
[![Build & Test Status](https://img.shields.io/github/actions/workflow/status/weslleycapelari/adapter-antigravity-local/publish.yml?style=flat-square)](https://github.com/weslleycapelari/adapter-antigravity-local/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Tests Passed](https://img.shields.io/badge/Tests--Passed-62%20/%2062-brightgreen?style=flat-square)](tests)

An official-grade, high-performance **Paperclip AI** adapter designed for running **Google Antigravity** (`agy` CLI) agents locally.

This adapter acts as a drop-in, robust, and type-safe replacement for the deprecated Gemini CLI integrations. It allows Paperclip agents to execute prompts through the modern Google Antigravity engine while supporting workspace synchronization, dynamic model selection, environment bindings, and sandboxed execution.

---

## ⚡ Key Features

- **🚀 Native Go CLI Performance**: Spawns the local `agy` binary with fast startup times, low system footprint, and real-time terminal stdout streaming.
- **📂 Multi-Workspace Sync**: Automatically registers and mounts multiple active Paperclip workspaces into `agy` using repeatable `--add-dir <cwd>` arguments.
- **⚙️ Headless Resiliency**: Enforces unattended command executions with `--dangerously-skip-permissions` to bypass OS prompt gates in headless containers.
- **🔒 Isolated Sandboxing**: Enforces strict execution limits and file-system restrictions by appending the `--sandbox` parameter.
- **🛠️ Self-Testing Diagnostics**: Bundles the `testEnvironment` probe checking command availability, workspace permissions, environment variables, and live API credentials via an active "hello" telemetry probe.
- **🛡️ Edge Case Mitigation**: Built-in regex parsers resistant to irregular spacing, multiline empty logs, case-insensitive outputs, and rate limits (HTTP 429).

---

## 🤖 Supported Models

Models are routed dynamically via the `ANTIGRAVITY_MODEL` environment variable (rather than invalid CLI flags).

| Model Family | Supported Profiles & Identifiers |
|---|---|
| **Gemini 3.5 Flash** | `gemini-3.5-flash` |
| **Gemini 3.1 Pro** | `gemini-3.1-pro-high`, `gemini-3.1-pro-low` |
| **Claude Sonnet 4.6** | `claude-sonnet-4.6-thinking`, `claude-sonnet-4.6-standard` |
| **Claude Opus 4.6** | `claude-opus-4.6-thinking` |
| **GPT-OSS 120B** | `gpt-oss-120b-medium` |

> *Note: Model availability depends on your local Antigravity installation and configuration.*

---

## 📦 Quick Installation

Install the adapter globally or within your Paperclip workspace scope via NPM:

```bash
npm install @weslleycapelari/adapter-antigravity-local

```

For complete installation and configuration instructions, please refer to the full setup guide:
👉 **[SETUP.md](./SETUP.md)**

---

## 🔌 Linking in the Paperclip Web UI

1. Open your **Paperclip Web Console**.
2. Navigate to **Settings** ➔ **Adapters** ➔ **Install Custom Adapter**.
3. Choose the **Local Path** method.
4. Select the absolute path to this project's root folder:
`/home/<user>/projects/adapter-antigravity-local`
5. Click **Install**. The adapter will automatically load the compiled JavaScript bundle from `./dist/index.js`.

### Configuration Schema

When configuring a Paperclip Agent, define the following variables in the settings panel:

| Option Key | Type | Description | Default |
| --- | --- | --- | --- |
| `command` | `string` | Binary command executable path or system command name. | `"agy"` |
| `model` | `string` | Target model profile or custom model name (binds to env). | `"claude-sonnet-4.6-thinking"` |
| `sandbox` | `boolean` | Enforces strict OS/Terminal sandbox jail isolation. | `false` |
| `cwd` | `string` | Absolute working directory context path fallback. | `process.cwd()` |
| `timeoutSec` | `number` | Inactivity/run timeout duration in seconds. | `0` (Disabled) |
| `extraArgs` | `string` | Comma-separated list of custom CLI parameters. | `""` |
| `envVars` | `string` | Multi-line `KEY=VALUE` environment variables. | `""` |
| `envBindings` | `object` | Structured credentials mappings and secrets references. | `{}` |

---

## 🛠️ Development

To work on modifications locally, clone the repository and build the distribution assets:

```bash
# Clone and enter the repository
git clone [https://github.com/weslleycapelari/adapter-antigravity-local.git](https://github.com/weslleycapelari/adapter-antigravity-local.git)
cd adapter-antigravity-local

# Install developer dependencies
npm install

# Compile TypeScript production files
npm run build

# Validate types
npm run typecheck

```

---

## 🧪 Architecture Quality & Testing (TDD)

We maintain a senior-grade quality gate enforced by **62 unit & integration tests** running on **Vitest**. The test suite is isolated from production compilation bundles.

Execute the Test Suite:

```bash
npm test

```

*Runs 62 tests across CLI color event formatters, UI config builders, session serializers, skills symlink managers, and environment probes in less than `0.6s`.*

---

## 🚀 DevOps & CI/CD Pipeline

We bundle a production-ready GitHub Action (`publish.yml`) that automates releases.

Whenever you push a version tag starting with `v` (e.g., `v1.0.0`), the pipeline will automatically:

1. Setup Node 20 and install clean dependencies (`npm ci`).
2. Run strict compiler typechecks (`npm run typecheck`).
3. Run all **62 quality tests**. *Any failure aborts publication.*
4. Compile production assets.
5. Publish to the public npm registry.
6. Create a formal **GitHub Release** with automated notes.

> **Note:** Configure a secret named `NPM_TOKEN` in your GitHub Repository settings with an npm Access Token to allow automated publishing.

---

## 📖 Documentation

* **[SETUP.md](./SETUP.md)** — Detailed installation, configuration guide, and troubleshooting.

---

## 🙌 Acknowledgements

Special thanks to **Ryan Lee** for testing the Paperclip integration, documenting the installation process, and providing vital feedback on adapter registration and model configuration.

---

## 👥 Authors & Maintainers

* Designed, built, and maintained by **Weslley Capelari**.
* Open-source repository: [GitHub: weslleycapelari/adapter-antigravity-local](https://github.com/weslleycapelari/adapter-antigravity-local).

License: **[MIT](LICENSE)** — Feel free to use, modify, and distribute.
