# Olivia's Agent Switch Workbench for VS Code

This small extension puts the existing Olivia's Agent Switch workbench in a VS Code panel. It does not replace Codex or Claude Code, nor duplicate the task UI. Olivia's Agent Switch continues to run its local orchestration server and CLI workers; the extension provides a convenient VS Code-hosted window for the current local app.

## Run from this source checkout

1. Open the Olivia's Agent Switch repository folder in VS Code.
2. Install dependencies in that folder with `npm install` if they are not installed yet.
3. Press `F5` to launch an Extension Development Host.
4. In the Extension Development Host, run **Olivia's Agent Switch: Open Workbench** from the Command Palette.

The first launch uses the same `scripts/start-codex-dashboard.mjs` path as `npm run codex:live`. That requires Olivia's Agent Switch to have been opened once and a vault selected. It reuses the existing local profile, vault, and provider sign-ins. Close the standalone app before starting the Codex-hosted local server; the two must not write to the same profile concurrently. Node.js must be available on the VS Code extension host's `PATH`.

If the repository is not the open workspace, set `agentOS.projectPath` to the local Olivia's Agent Switch source folder. Keep `agentOS.dashboardUrl` on `http://127.0.0.1:4311/`; the dashboard can access local agent credentials, files, and the selected vault.

## Intended direction

- VS Code is the shell, so the task view can sit beside the code, terminal, and Codex CLI workflows.
- Agent OS remains the lightweight coordinator for provider selection, backup handoff, parallel work, scoped Obsidian context, and run history.
- Codex and Claude continue to use their locally authenticated CLI accounts. Perplexity is optional and currently connects to its API, which is billed separately from web-app usage except for any applicable API credits.
- Do not put credentials or vault content in VS Code settings or the extension package.

The webview embeds only the configured loopback Agent OS URL. To use the existing full-screen layout instead, select **Open in browser** in the panel header.
