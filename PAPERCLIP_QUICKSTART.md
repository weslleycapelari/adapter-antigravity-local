# Paperclip Quickstart

Node.js 24.11+ and a local Paperclip installation are required.

## Install the branch

For a new checkout:

```bash
mkdir -p "$HOME/src"
cd "$HOME/src"
git clone --branch codex/fix-three-antigravity-issues \
  https://github.com/kevin-kurian/adapter-antigravity-local.git
cd adapter-antigravity-local
```

For an existing checkout, run this instead:

```bash
cd /path/to/adapter-antigravity-local
git switch codex/fix-three-antigravity-issues
git pull --ff-only origin codex/fix-three-antigravity-issues
```

Then, from the adapter repository root:

```bash
npm install
npm run build
mkdir -p "$HOME/.paperclip/extensions"
npm install --prefix "$HOME/.paperclip/extensions" "$PWD"
npm run paperclip:register
```

## Sign in and restart

```bash
cd "$HOME"
agy
```

Complete browser sign-in if prompted. When your account appears in the CLI header, exit with **Ctrl+C**. In the terminal running Paperclip, press **Ctrl+C**, then restart:

```bash
cd "$HOME"
npx paperclipai run
```

## Create the agent

1. Open [http://127.0.0.1:3100](http://127.0.0.1:3100).
2. Go to **Agents → Create Agent** and enter the agent details.
3. Select **Antigravity** in the Adapter step.
4. Choose a concrete model. For Gemini 3.8 Flash without Argon, select **Gemini 3.8 Flash (High)**.
5. Select the company and workspace/repository, then save.
6. Run a heartbeat and confirm the agent returns an answer.
