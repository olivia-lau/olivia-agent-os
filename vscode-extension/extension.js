const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

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

function activate(context) {
  context.subscriptions.push(log);
  context.subscriptions.push(vscode.commands.registerCommand('agentOS.openWorkbench', () => openWorkbench(context)));
}

function deactivate() {
  if (serverProcess && serverProcess.exitCode === null) serverProcess.kill();
}

module.exports = { activate, deactivate };
