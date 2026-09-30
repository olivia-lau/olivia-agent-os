const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { PARTICIPANT_ID, requestedProvider, sessionFromHistory, projectTitle, isTerminal, progressLabel } = require('./agentos-chat.cjs');

const log = vscode.window.createOutputChannel("Olivia's Agent Switch Workbench");
let serverProcess;
let panel;

function configuredRoot() {
  const configured = vscode.workspace.getConfiguration('agentOS').get('projectPath', '').trim();
  const root = configured || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) throw new Error("Open Olivia's Agent Switch source folder in VS Code, or set Olivia's Agent Switch Workbench › Project Path.");
  const absolute = path.resolve(root);
  if (!fs.existsSync(path.join(absolute, 'scripts', 'start-codex-dashboard.mjs')) ||
      !fs.existsSync(path.join(absolute, 'src', 'server.mjs'))) {
    throw new Error(`That folder does not look like an Olivia's Agent Switch source checkout: ${absolute}`);
  }
  return absolute;
}

function dashboardUrl() {
  const value = vscode.workspace.getConfiguration('agentOS').get('dashboardUrl', 'http://127.0.0.1:4311/');
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new Error("For safety, Olivia's Agent Switch Workbench only accepts a loopback dashboard URL.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Olivia's Agent Switch Workbench dashboard URL cannot include credentials, query parameters, or a fragment.");
  }
  return url;
}

async function isHealthy(url) {
  try {
    const response = await fetch(new URL('/api/health', url), { signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch { return false; }
}

async function startDashboard(root, url) {
  if (await isHealthy(url)) return;
  if (!vscode.workspace.getConfiguration('agentOS').get('autoStart', true)) {
      throw new Error("Olivia's Agent Switch is not running. Start it with `npm run codex:live`, or enable Olivia's Agent Switch Workbench › Auto Start.");
  }
  if (serverProcess && serverProcess.exitCode === null) {
      throw new Error("Olivia's Agent Switch is still starting. Check its Workbench output channel for details.");
  }

  log.appendLine(`Starting Olivia's Agent Switch from ${root}`);
  serverProcess = spawn(process.platform === 'win32' ? 'node.exe' : 'node', ['scripts/start-codex-dashboard.mjs'], {
    cwd: root,
    env: { ...process.env },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverProcess.stdout.on('data', data => log.append(data.toString()));
  serverProcess.stderr.on('data', data => log.append(data.toString()));
  serverProcess.on('error', error => log.appendLine(`Could not start Olivia's Agent Switch: ${error.message}`));
  serverProcess.on('exit', (code, signal) => {
    log.appendLine(`Olivia's Agent Switch server exited (code ${code ?? 'none'}, signal ${signal ?? 'none'}).`);
    serverProcess = undefined;
  });

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await isHealthy(url)) return;
    if (!serverProcess || serverProcess.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 400));
  }
    throw new Error("Olivia's Agent Switch did not start. See its Workbench output channel for the startup error.");
}

function workbenchHtml(webview, url) {
  const nonce = [...Array(24)].map(() => Math.random().toString(36)[2]).join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${url.origin}; style-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    html, body { height: 100%; margin: 0; background: #1e1e1e; color: #ddd; font: 13px var(--vscode-font-family, sans-serif); }
    .shell { height: 100%; display: flex; flex-direction: column; }
    header { padding: 8px 12px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid #383838; }
    header strong { font-size: 12px; }
    header span { color: #999; flex: 1; }
    button, a { color: var(--vscode-textLink-foreground, #75beff); background: transparent; border: 0; cursor: pointer; font: inherit; }
    iframe { border: 0; width: 100%; flex: 1; background: #1e1e1e; }
  </style>
</head>
<body><div class="shell">
    <header><strong>Olivia's Agent Switch</strong><span>Local workbench · your selected Obsidian vault</span><button id="reload" type="button">Reload</button><a href="${url.href}" target="_blank" rel="noreferrer">Open in browser ↗</a></header>
    <iframe title="Olivia's Agent Switch Workbench" src="${url.href}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals" allow="clipboard-read; clipboard-write"></iframe>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.getElementById('reload').addEventListener('click', () => {
    const frame = document.querySelector('iframe');
    frame.src = frame.src;
  });
</script>
</body></html>`;
}

async function openWorkbench(context) {
  try {
    const root = configuredRoot();
    const url = dashboardUrl();
    await startDashboard(root, url);
    if (!panel) {
      panel = vscode.window.createWebviewPanel('agentOS.workbench', "Olivia's Agent Switch", vscode.ViewColumn.Beside, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: []
      });
      panel.onDidDispose(() => { panel = undefined; }, null, context.subscriptions);
    } else panel.reveal(vscode.ViewColumn.Beside);
    panel.webview.html = workbenchHtml(panel.webview, url);
  } catch (error) {
    log.appendLine(error.stack || error.message);
    const choice = await vscode.window.showErrorMessage(error.message, "Show Olivia's Agent Switch Logs");
    if (choice) log.show(true);
  }
}

async function apiRequest(url, route, options = {}) {
  const response = await fetch(new URL(route, url), {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || value.message || `Agent OS request failed (${response.status}).`);
  return value;
}

async function waitForRun(url, runId, stream, token) {
  const seen = new Set();
  const deadline = Date.now() + 90 * 60 * 1000;
  while (Date.now() < deadline) {
    if (token.isCancellationRequested) return { cancelled: true };
    const { run, events = [] } = await apiRequest(url, `/api/runs/${encodeURIComponent(runId)}`);
    for (const event of events) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      const label = progressLabel(event);
      if (label) stream.progress(label);
    }
    if (!run) throw new Error('Agent OS no longer has this run in its local history.');
    if (isTerminal(run.status)) return { run };
    if (run.status === 'awaiting_execution_approval') {
      const choice = await vscode.window.showWarningMessage(
        'Agent OS is asking to run a command that needs approval.',
        { modal: true, detail: run.command || 'Review this action in Agent OS before continuing.' },
        'Approve and run', 'Reject'
      );
      if (choice === 'Approve and run') {
        await apiRequest(url, `/api/runs/${encodeURIComponent(runId)}/approve-execution`, { method: 'POST' });
        stream.progress('Approval recorded; waiting for the agent.');
      } else {
        await apiRequest(url, `/api/runs/${encodeURIComponent(runId)}/reject-execution`, { method: 'POST' });
      }
    } else if (run.status === 'awaiting_plan_approval' || run.status === 'awaiting_output_approval') {
      return { run };
    }
    await new Promise(resolve => setTimeout(resolve, 850));
  }
  return { timedOut: true };
}

async function handleAgentOsChat(request, chatContext, stream, token) {
  try {
    const root = configuredRoot();
    const url = dashboardUrl();
    await startDashboard(root, url);
    const { providers = {}, executionRoot, agentSettings = {} } = await apiRequest(url, '/api/overview');
    const configuredBackup = vscode.workspace.getConfiguration('agentOS').get('backupProvider', 'auto');
    const command = String(request.command || '').toLowerCase();
    let session = command === 'new' ? null : sessionFromHistory(chatContext.history);
    const provider = requestedProvider(command);
    const userPrompt = String(request.prompt || '').trim();

    if (command === 'new' || !session) {
      stream.progress(command === 'new' ? 'Starting a new Agent OS project…' : 'Creating an Agent OS project for this chat…');
      const created = await apiRequest(url, '/api/projects', {
        method: 'POST',
        body: JSON.stringify({ title: projectTitle(request.prompt) })
      });
      session = { projectId: created.project.id, threadId: created.thread.id };
      if (command === 'new' && !userPrompt) {
        stream.markdown(`Started a new Agent OS project: **${created.project.title}**. Send your task in the next message, or include it after `/new`.`);
        return { metadata: { agentOsProjectId: session.projectId, agentOsThreadId: session.threadId } };
      }
    }

    if (!userPrompt) {
      stream.markdown('Add a task after `@agentos` (optionally choose `/codex`, `/claude`, or `/auto`).');
      return { metadata: { agentOsProjectId: session.projectId, agentOsThreadId: session.threadId } };
    }
    if (provider !== 'auto' && !providers[provider]?.ready) {
      throw new Error(`${provider === 'claude' ? 'Claude Code' : 'Codex'} is not signed in or ready on this computer. Connect it in Agent OS, then retry.`);
    }

    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || executionRoot;
    if (!workspace) throw new Error('Open a project folder in VS Code or set up a workspace in Agent OS first.');
    stream.progress(`Sending this task to Agent OS${provider === 'auto' ? '' : ` for ${provider === 'claude' ? 'Claude Code' : 'Codex'}`}…`);
    const run = await apiRequest(url, '/api/commands', {
      method: 'POST',
      body: JSON.stringify({
        command: userPrompt,
        provider,
        backupProvider: ['codex', 'claude'].includes(provider) && configuredBackup === provider ? 'auto' : configuredBackup,
        projectId: session.projectId,
        threadId: session.threadId,
        workspace,
        agentChoices: { codex: { model: agentSettings.codexModel || '' } },
        knowledgeMode: 'auto',
        memoryMode: 'always',
        includePrivate: true,
        outputCategory: 'Personal Generic'
      })
    });

    const outcome = await waitForRun(url, run.id, stream, token);
    const metadata = { agentOsProjectId: session.projectId, agentOsThreadId: session.threadId, agentOsRunId: run.id };
    if (outcome.cancelled) {
      stream.markdown(`Stopped waiting in VS Code. The Agent OS run **${run.id}** may still be working; check its dashboard for the eventual result.`);
      return { metadata };
    }
    if (outcome.timedOut) {
      stream.markdown(`Agent OS is still running after 90 minutes. Check the local dashboard for progress and result (run ${run.id}).`);
      return { metadata };
    }

    const finished = outcome.run;
    if (finished.finalOutput) stream.markdown(finished.finalOutput);
    else if (finished.error) stream.markdown(`**Agent OS ${finished.status}.**\n\n${finished.error}`);
    else stream.markdown(`Agent OS finished with status **${finished.status}**. Open the workbench for details.`);
    if (finished.handoffs?.length) {
      const handoffs = finished.handoffs.map(item => `${item.from || 'Agent'} → ${item.to || 'backup agent'}`).join(', ');
      stream.markdown(`\n\n_Agent handoff: ${handoffs}._`);
    }
    return { metadata };
  } catch (error) {
    stream.markdown(`**Agent OS could not run this request.** ${error.message}\n\nOpen **Olivia's Agent Switch: Open Workbench** to check provider sign-in and runtime status.`);
    return {};
  }
}

function activate(context) {
  context.subscriptions.push(log);
  context.subscriptions.push(vscode.commands.registerCommand('agentOS.openWorkbench', () => openWorkbench(context)));
  if (vscode.chat?.createChatParticipant) {
    const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handleAgentOsChat);
    context.subscriptions.push(participant);
  } else {
    log.appendLine('This VS Code version does not expose the Chat Participant API. Update VS Code to use @agentos.');
  }
}

function deactivate() {
  if (serverProcess && serverProcess.exitCode === null) serverProcess.kill();
}

module.exports = { activate, deactivate };
