# Setup Instructions

This document explains how to install and configure the Antigravity Local Adapter for Paperclip AI.

Repository:

* @weslleycapelari/adapter-antigravity-local

---

## Prerequisites

Before starting, ensure the following tools are installed and working:

* Node.js 20+
* npm
* Paperclip AI
* Antigravity CLI (`agy`)

Verify installation:

```bash
node --version
npm --version
agy --version
```

---

## Install the Adapter

Navigate to the Paperclip extensions directory:

```bash
cd ~/.paperclip/extensions
```

Install the package:

```bash
npm install @weslleycapelari/adapter-antigravity-local
```

---

## Register the Adapter

Edit:

```text
~/.paperclip/adapter-plugins.json
```

Add:

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

### Important

The property:

```json
"type": "antigravity_local"
```

is required.

Without it, Paperclip may classify the adapter as a builtin adapter and it may not appear correctly in the frontend UI.

---

## Restart Paperclip

Stop the server:

```bash
Ctrl + C
```

Start again:

```bash
npx paperclipai run
```

---

## Verify Installation

Open the Paperclip Web UI.

Create or edit an agent.

Verify that:

* Antigravity Local appears in the Adapter dropdown.
* Available models are displayed correctly.
* Requests are executed through the local Antigravity CLI.

---

## Troubleshooting

### Adapter does not appear

Verify:

```json
"type": "antigravity_local"
```

is present in `adapter-plugins.json`.

### Package not found

Reinstall:

```bash
npm install @weslleycapelari/adapter-antigravity-local
```

### Changes not applied

Restart the Paperclip server.

Paperclip caches adapter metadata during startup.

---

## Acknowledgements

Special thanks to Ryan Lee for helping test the Paperclip integration, identifying adapter registration requirements, and contributing setup documentation and feedback.
