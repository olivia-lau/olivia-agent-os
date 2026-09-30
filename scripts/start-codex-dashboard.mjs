import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const userData = process.platform === 'win32'
  ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Agent OS')
  : path.join(os.homedir(), 'Library', 'Application Support', 'Agent OS');
const settingsPath = path.join(userData, 'settings.json');
if (!fs.existsSync(settingsPath)) throw new Error("Open Olivia's Agent Switch once and choose your vault before using the Codex-hosted dashboard.");

try {
  const response = await fetch('http://127.0.0.1:4311/api/overview', { signal: AbortSignal.timeout(1500) });
  const overview = response.ok ? await response.json() : null;
  if (overview?.stats && Array.isArray(overview?.threads)) {
    console.log("Olivia's Agent Switch is already running. Open it in Codex at http://127.0.0.1:4311/");
    process.exit(0);
  }
} catch { /* No Olivia's Agent Switch dashboard is listening on the Codex port. */ }

if (process.platform === 'win32') {
  const commandLines = execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.Name -like '*Agent*Switch.exe' -or $_.Name -eq 'Agent OS.exe' } | ForEach-Object { $_.CommandLine } | ConvertTo-Json -Compress`], { encoding: 'utf8', windowsHide: true });
  const parsed = JSON.parse(commandLines || 'null');
  const processes = (Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean);
  const standaloneOpen = processes.some(command => /^"[^"]*Olivia's Agent Switch\.exe"\s*$/i.test(command));
  if (standaloneOpen || processes.some(command => command.includes('Agent OS.exe'))) throw new Error("Close Olivia's Agent Switch or legacy Agent OS after its active tasks finish. The live dashboard must not write to the same profile simultaneously.");
}

const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
const vaultPath = path.resolve(String(settings.vaultPath || ''));
if (!fs.existsSync(vaultPath) || !fs.statSync(vaultPath).isDirectory()) throw new Error('The vault selected in the standalone app is no longer available.');
const profileId = crypto.createHash('sha256').update(process.platform === 'win32' ? vaultPath.toLowerCase() : vaultPath).digest('hex').slice(0, 16);
const profile = path.join(userData, 'profiles', profileId);
const workspace = path.join(profile, 'workspace');
fs.mkdirSync(workspace, { recursive: true });
process.env.OLIVIA_VAULT_PATH = vaultPath;
process.env.OLIVIA_OS_DATA_PATH = path.join(profile, 'data');
process.env.OLIVIA_EXECUTION_ROOT = workspace;
process.env.OLIVIA_OS_DISPLAY_NAME = settings.displayName === 'Agent OS' || settings.displayName === 'Olivia OS' || !settings.displayName
  ? "Olivia's Agent Switch"
  : settings.displayName;
process.env.OLIVIA_OS_GITHUB_REPO = settings.backendType === 'github' ? settings.repoId || '' : '';
process.env.OLIVIA_OS_GITHUB_ROOT = settings.backendType === 'github' ? settings.repoRoot || '' : '';
process.env.OLIVIA_OS_PORT = '4311';

const { server } = await import('../src/server.mjs');
server.on('error', error => { console.error(`Olivia's Agent Switch could not open port 4311: ${error.message}`); process.exitCode = 1; });
server.on('listening', () => console.log("Open Olivia's Agent Switch in Codex at http://127.0.0.1:4311/"));
