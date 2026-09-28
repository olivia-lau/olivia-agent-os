import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const userData = process.platform === 'win32'
  ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Agent OS')
  : path.join(os.homedir(), 'Library', 'Application Support', 'Agent OS');
const settingsPath = path.join(userData, 'settings.json');
if (!fs.existsSync(settingsPath)) throw new Error('Open the standalone Agent OS app once and choose your vault before using the Codex-hosted dashboard.');

if (process.platform === 'win32') {
  const processes = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Agent OS.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
  if (/"Agent OS\.exe"/i.test(processes)) throw new Error('Close the standalone Agent OS window after its active tasks finish. The live dashboard must not write to the same profile simultaneously.');
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
process.env.OLIVIA_OS_DISPLAY_NAME = settings.displayName || 'Agent OS';
process.env.OLIVIA_OS_GITHUB_REPO = settings.backendType === 'github' ? settings.repoId || '' : '';
process.env.OLIVIA_OS_GITHUB_ROOT = settings.backendType === 'github' ? settings.repoRoot || '' : '';
process.env.OLIVIA_OS_PORT = '4311';

const { server } = await import('../src/server.mjs');
server.on('error', error => { console.error(`Agent OS could not open port 4311: ${error.message}`); process.exitCode = 1; });
server.on('listening', () => console.log('Open Agent OS in Codex at http://127.0.0.1:4311/'));
