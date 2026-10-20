# @weslleycapelari/adapter-antigravity-local

[![npm version](https://img.shields.io/npm/v/@weslleycapelari/adapter-antigravity-local.svg?style=flat-square)](https://www.npmjs.com/package/@weslleycapelari/adapter-antigravity-local)
[![Build & Test Status](https://img.shields.io/github/actions/workflow/status/weslleycapelari/adapter-antigravity-local/publish.yml?style=flat-square)](https://github.com/weslleycapelari/adapter-antigravity-local/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Tests Passed](https://img.shields.io/badge/Tests--Passed-97%20/%2097-brightgreen?style=flat-square)](tests)

An enterprise-grade, high-performance **Paperclip AI** adapter engineered for modern **Google Antigravity** (`agy` CLI) agents running locally.

This adapter serves as a robust, fully typed, production-ready integration supporting the modern Antigravity CLI architecture: real-time `stream-json` event streaming, thinking/reasoning effort controls, tool execution & MCP tracking, subagent lifecycle observation, intelligent multi-account quota pooling, rolling rate-limit window accounting, automatic 429 failover, and Windows-friendly non-admin junction symlinks.

---

## ⚡ Key Features

- **🚀 Modern Stream-JSON Telemetry**: Native parsing for `stream-json` events (`init`, `step_update`, `tool_call`, `tool_result`, `agent_response` with text deltas, `thinking` with reasoning deltas, `subagent_info`, and `result`).
- **🧠 Reasoning / Thinking Effort Control**: Full support for `--effort` levels (`low`, `medium`, `high`, `xhigh`, `max`), mapping directly to Antigravity's thinking models.
- **🔄 Multi-Account Quota Pooling**: Intelligent profile pool routing (`account-1`, `account-2`, etc.) with automatic rotation, live Google Cloud Code API quota introspection, 5-hour and 7-day rolling window ledgers, and offline brain transcript usage scanners.
- **🛡️ Auto-Recovery & 429 Failover**: Transparent retry with fresh session handoff on expired/corrupted conversations, and automatic rotation to secondary account candidates when hitting rate limits.
- **🛠️ Tools, MCP & Subagent Lifecycle**: Real-time transcript tracking for native tools (`run_command`, `read_file`, `edit_file`, `web_search`), Model Context Protocol (MCP) servers, and hierarchical subagent executions (`invoke_subagent`).
- **📂 Modern Skills Management**: Automatically mounts Paperclip skills to `~/.gemini/antigravity-cli/skills` using Windows directory junctions (no admin rights needed) or Unix symlinks.
- **📊 Progressive Token Checkpoints**: Emits incremental token usage (`input_tokens`, `output_tokens`, `cache_read_tokens`) and USD cost estimates directly to Paperclip during execution.
- **🧪 Zero-Dependency Diagnostics**: Self-testing `testEnvironment` probe validating executable presence, directory permissions, API keys, and active hello probe without depending on Unix-only tools like `which`.

---

## 🤖 Supported Models

Models are passed directly via the `--model` CLI argument with intelligent alias resolution and leadership vs. worker role routing.

| Model Identifier | Display Label | Performance Tier / Family |
|---|---|---|
| `inherit` | Auto (Inherit) | Dynamically inherits system or parent model |
| `gemini-4-argon-high` | Gemini 4 Argon (High) | Flagship reasoning & leadership model |
| `gemini-4-argon-medium` | Gemini 4 Argon (Medium) | Balanced flagship reasoning model |
| `gemini-4-argon-low` | Gemini 4 Argon (Low) | Fast flagship model |
| `gemini-3.8-flash-high` | Gemini 3.8 Flash (High) | High-accuracy fast worker model |
| `gemini-3.8-flash-medium` | Gemini 3.8 Flash (Medium) | Standard fast worker model |
| `gemini-3.8-flash-low` | Gemini 3.8 Flash (Low) | Ultra-lightweight subagent model |
| `gemini-3.1-pro-high` | Gemini 3.1 Pro (High) | Deep coding & architectural reasoning |
| `claude-opus-5-5-high` | Claude Opus 5.5 (High) | Highest capability complex reasoning |
| `claude-opus-5-5-medium` | Claude Opus 5.5 (Medium) | Balanced heavy reasoning |
| `claude-opus-5-5-low` | Claude Opus 5.5 (Low) | Fast reasoning tier |
| `claude-sonnet-5-5-high` | Claude Sonnet 5.5 (High) | Superior code synthesis & tool execution |
| `claude-sonnet-5-5-medium` | Claude Sonnet 5.5 (Medium) | General development worker model |
| `claude-sonnet-5-5-low` | Claude Sonnet 5.5 (Low) | Fast coding assistant |
| `gpt-oss-120b-medium` | GPT-OSS 120B (Medium) | Open-weights 120B reasoning tier |

### Backward-Compatible Aliases

The adapter automatically normalizes legacy aliases:
- `pro` ➔ `gemini-4-argon-high`
- `flash` ➔ `gemini-3.8-flash-medium`
- `flash_lite` ➔ `gemini-3.8-flash-low`

---

## 📦 Quick Installation

Install within your Paperclip extensions directory via NPM:

```bash
cd ~/.paperclip/extensions
npm install @weslleycapelari/adapter-antigravity-local
```

For comprehensive installation and configuration guides, check:
👉 **[SETUP.md](./SETUP.md)**

---

## 🔌 Paperclip Configuration

### Configuration Schema

When configuring a Paperclip Agent, the following options are available:

| Option Key | Type | Description | Default |
| --- | --- | --- | --- |
| `command` | `string` | Antigravity executable path or command name. | `"agy"` |
| `model` | `string` | Model identifier (e.g., `gemini-4-argon-high`, `claude-opus-5-5-high`). | `"inherit"` |
| `effort` | `string` | Reasoning effort: `low`, `medium`, `high`, `xhigh`, `max`. | `""` |
| `accountProfile` | `string` | Target account profile for multi-account pool routing (`account-1`, `account-2`). | `""` |
| `dangerouslySkipPermissions` | `boolean` | Auto-approves tool executions in headless runs. | `true` |
| `cwd` | `string` | Absolute working directory fallback. | `process.cwd()` |
| `timeoutSec` | `number` | Process timeout duration in seconds (0 = disabled). | `0` |
| `graceSec` | `number` | Grace period in seconds before SIGKILL on timeout. | `15` |
| `extraArgs` | `string[]` | Additional command line arguments passed to `agy`. | `[]` |
| `env` | `object` | Key-value dictionary of environment variable bindings. | `{}` |

---

## 🛠️ Development & Quality Assurance

```bash
# Clone the repository
git clone https://github.com/weslleycapelari/adapter-antigravity-local.git
cd adapter-antigravity-local

# Install dependencies
npm install

# Compile TypeScript production bundles
npm run build

# Validate TypeScript type consistency (0 errors)
npm run typecheck

# Run full Vitest test suite (97 tests)
npm test
```

### Test Suite Coverage (97 Tests Passing)
- **Parse & Stream**: Stream-JSON incremental parsing, thinking deltas, tool invocation & results, subagent info, reset time extraction, rate-limit & auth error detection.
- **UI & CLI Formatters**: ANSI colorized event terminal formatting and transcript entry construction.
- **Quota & Pooling**: 5h/7d rolling window calculations, Cloud Code API OAuth credential refresh, transcript usage scanners, candidate plan builder.
- **Skills Management**: Windows junction symlink creation, removal of stale links, path normalization.
- **Execution Engine**: End-to-end execution, session continuation (`--conversation`), unrecoverable session auto-recovery, timeout handling, usage checkpoint streaming.
- **Diagnostics**: Environment test probe pipeline with hello telemetry and sandbox checks.

---

## 👥 Authors & Maintainers

- Designed, built, and maintained by **Weslley Capelari**.
- Open-source repository: [GitHub: weslleycapelari/adapter-antigravity-local](https://github.com/weslleycapelari/adapter-antigravity-local).

License: **[MIT](LICENSE)** — Feel free to use, modify, and distribute.
