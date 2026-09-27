const { app, BrowserWindow, dialog, ipcMain, shell, session, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

app.setName('Agent OS');
if (!app.requestSingleInstanceLock()) app.quit();

let window;
let localServer;
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function readSettings() {
  try {
    const value = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    return fs.statSync(value.vaultPath).isDirectory() ? value : null;
  } catch { return null; }
}

async function cleanSettings(input) {
  const backendType = input?.backendType === 'github' ? 'github' : 'local';
  let vaultPath;
  let repoId = '';
  let repoRoot = '';
  if (backendType === 'github') {
    const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'src', 'github-vault.mjs')).href;
    const { prepareGithubVault } = await import(moduleUrl);
    const prepared = await prepareGithubVault({
      repoUrl: String(input.repoUrl || ''),
      existingFolder: String(input.repoFolder || ''),
      managedRoot: path.join(app.getPath('userData'), 'github-vaults')
    });
    ({ vaultPath, repoId, repoRoot } = prepared);
  } else {
    if (!String(input?.vaultPath || '').trim()) throw new Error('Choose your Obsidian vault folder.');
    vaultPath = path.resolve(String(input.vaultPath));
    if (!fs.existsSync(vaultPath) || !fs.statSync(vaultPath).isDirectory()) throw new Error('Choose an existing Obsidian vault folder.');
  }
  const displayName = String(input?.displayName || 'Agent OS').trim().slice(0, 60) || 'Agent OS';
  return { vaultPath, displayName, backendType, repoId, repoRoot };
}

function writeSettings(value) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  const temporary = `${settingsFile()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, settingsFile());
}

function profilePath(vaultPath) {
  const resolved = path.resolve(vaultPath);
  const id = crypto.createHash('sha256').update(process.platform === 'win32' ? resolved.toLowerCase() : resolved).digest('hex').slice(0, 16);
  return path.join(app.getPath('userData'), 'profiles', id);
}

function addMacCliPaths() {
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', path.join(app.getPath('home'), '.local', 'bin')];
  try {
    const loginShell = process.env.SHELL || '/bin/zsh';
    const output = execFileSync(loginShell, ['-lic', 'printf "\nAGENT_OS_PATH_START%sAGENT_OS_PATH_END\n" "$PATH"'], {
      encoding: 'utf8', timeout: 5000, windowsHide: true
    });
    const match = output.match(/AGENT_OS_PATH_START([^\r\n]*?)AGENT_OS_PATH_END/);
    if (match) extra.push(...match[1].split(path.delimiter));
  } catch { /* Standard installation paths remain available. */ }
  process.env.PATH = [...new Set([...(process.env.PATH || '').split(path.delimiter), ...extra]
    .filter(candidate => candidate && path.isAbsolute(candidate) && fs.existsSync(candidate)))].join(path.delimiter);
}

function makeWindow() {
  window = new BrowserWindow({
    width: 1440, height: 920, minWidth: 920, minHeight: 650,
    backgroundColor: '#181818', title: 'Agent OS',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = localServer && url.startsWith(`http://127.0.0.1:${localServer.address()?.port}/`);
    if (!allowed) event.preventDefault();
  });
  window.on('closed', () => { window = null; });
}

async function showSetup() {
  if (!window) makeWindow();
  await window.loadFile(path.join(__dirname, 'setup.html'));
}

async function startDashboard(settings) {
  if (settings.backendType === 'github') {
    const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'src', 'github-vault.mjs')).href;
    const { githubVaultStatus } = await import(moduleUrl);
    await githubVaultStatus(settings.repoRoot, settings.repoId);
  }
  const profile = profilePath(settings.vaultPath);
  const workspace = path.join(profile, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  process.env.OLIVIA_VAULT_PATH = settings.vaultPath;
  process.env.OLIVIA_OS_DATA_PATH = path.join(profile, 'data');
  process.env.OLIVIA_EXECUTION_ROOT = workspace;
  process.env.OLIVIA_OS_DISPLAY_NAME = settings.displayName;
  process.env.OLIVIA_OS_PORT = '0';
  process.env.OLIVIA_OS_GITHUB_REPO = settings.backendType === 'github' ? settings.repoId : '';
  process.env.OLIVIA_OS_GITHUB_ROOT = settings.backendType === 'github' ? settings.repoRoot : '';
  const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'src', 'server.mjs')).href;
  const { server } = await import(moduleUrl);
  localServer = server;
  if (!server.listening) await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  await window.loadURL(`http://127.0.0.1:${server.address().port}/`);
  window.setTitle(settings.displayName);
}

ipcMain.handle('setup:choose-vault', async () => {
  const result = await dialog.showOpenDialog(window, { title: 'Choose your Obsidian vault folder', properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('setup:save', async (_event, input) => {
  try {
    const settings = await cleanSettings(input);
    writeSettings(settings);
    if (localServer?.listening) { app.relaunch(); app.quit(); return { ok: true }; }
    await startDashboard(settings);
    return { ok: true };
  } catch (error) { return { ok: false, error: error.message }; }
});

app.whenReady().then(async () => {
  if (process.platform === 'darwin') addMacCliPaths();
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const menu = Menu.buildFromTemplate([
    { label: 'Agent OS', submenu: [
      { label: 'Change vault or GitHub repo…', click: () => showSetup() },
      { role: 'quit' }
    ] },
    { role: 'editMenu' }, { role: 'viewMenu' }
  ]);
  Menu.setApplicationMenu(menu);
  makeWindow();
  const settings = readSettings();
  if (settings) {
    try { await startDashboard(settings); }
    catch (error) { dialog.showErrorBox('Agent OS could not start', error.message); await showSetup(); }
  } else await showSetup();
});

app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', async () => {
  if (window) return;
  makeWindow();
  const settings = readSettings();
  if (settings && localServer?.listening) await window.loadURL(`http://127.0.0.1:${localServer.address().port}/`);
  else await showSetup();
});
app.on('before-quit', () => { localServer?.close(); });
