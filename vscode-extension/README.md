# Olivia's Agent Switch Workbench for VS Code

This extension provides two VS Code entry points: an embedded Agent OS workbench and the native `@agentos` chat participant. The participant sends your prompt directly to the local Agent OS server, which runs your already-authenticated Codex or Claude Code CLI account and routes progress/results back into VS Code Chat. It does not call `request.model` or send your prompt through a Copilot language model, so it does not consume Copilot model credits. Your provider's own plan/usage limits still apply.

## Run from this source checkout

1. Open the Olivia's Agent Switch repository folder in VS Code.
2. Install dependencies in that folder with `npm install` if they are not installed yet.
3. Press `F5` to launch an Extension Development Host.
4. In the Extension Development Host, run **Olivia's Agent Switch: Open Workbench** from the Command Palette.
5. Open VS Code Chat, enter `@agentos`, and choose `/codex`, `/claude`, or `/auto` before your prompt. Agent OS automatically uses its configured backup routing. Use `/new` to start a new Agent OS project/conversation; follow-up messages in that VS Code chat continue the same Agent OS conversation.

The first launch uses the same `scripts/start-codex-dashboard.mjs` path as `npm run codex:live`. That requires Olivia's Agent Switch to have been opened once and a vault selected. It reuses the existing local profile, vault, and provider sign-ins. Close the standalone app before starting the Codex-hosted local server; the two must not write to the same profile concurrently. Node.js must be available on the VS Code extension host's `PATH`.

If the repository is not the open workspace, set `agentOS.projectPath` to the local Olivia's Agent Switch source folder. Keep `agentOS.dashboardUrl` on `http://127.0.0.1:4311/`; the dashboard can access local agent credentials, files, and the selected vault.

Set `agentOS.backupProvider` to `auto`, `none`, `codex`, or `claude` to choose the fallback. If the chosen fixed backup matches an explicitly selected primary agent, the extension safely falls back to automatic routing instead. `/auto` always uses automatic routing.

The chat participant uses the first VS Code workspace folder as the agent's working directory (falling back to Agent OS's configured execution folder). It stores the project and conversation in Agent OS and reuses the local Obsidian-backed context and history. Potentially destructive commands remain subject to Agent OS approval; VS Code shows a confirmation before allowing the run to proceed. Cancelling the VS Code response stops waiting but does not kill a CLI process that has already started.

VS Code Chat may itself require an available chat experience/account in your VS Code installation. The extension does not call a Copilot model, but that does not bypass VS Code's own availability requirements for opening Chat.

## Intended direction

- VS Code is the shell, so the task view can sit beside the code, terminal, and Codex CLI workflows.
- Agent OS remains the lightweight coordinator for provider selection, backup handoff, parallel work, scoped Obsidian context, and run history.
- Codex and Claude continue to use their locally authenticated CLI accounts. Perplexity is optional and currently connects to its API, which is billed separately from web-app usage except for any applicable API credits.
- Do not put credentials or vault content in VS Code settings or the extension package.

The webview embeds only the configured loopback Agent OS URL. To use the existing full-screen layout instead, select **Open in browser** in the panel header.
