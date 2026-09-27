import { spawn } from 'node:child_process';
import { detectProviders } from './provider-router.mjs';
import { hasSessionPerplexityKey } from './perplexity-executor.mjs';
import { resolveClaudeCommand, resolveCodexCommand } from './codex-command.mjs';

const loginState = { codex: 'idle', claude: 'idle' };
const active = new Map();

export function refreshConnections(providers) {
  Object.assign(providers, detectProviders());
  if (hasSessionPerplexityKey()) {
    Object.assign(providers.perplexity, { installed: true, ready: true, detail: 'Encrypted vault API key loaded; verified on first request' });
  }
  for (const id of ['codex', 'claude']) {
    if (providers[id].ready) loginState[id] = 'connected';
    else if (loginState[id] === 'connected') loginState[id] = 'idle';
  }
  return connectionView(providers);
}

export function connectionView(providers) {
  return {
    codex: { ...providers.codex, loginState: loginState.codex },
    claude: { ...providers.claude, loginState: loginState.claude },
    perplexity: { ...providers.perplexity, credentialSource: hasSessionPerplexityKey() ? 'vault-encrypted' : process.env.PERPLEXITY_API_KEY ? 'environment' : 'none' }
  };
}

export async function beginLogin(id, providers) {
  if (!['codex', 'claude'].includes(id)) throw new Error('Use an API key to connect Perplexity.');
  refreshConnections(providers);
  if (providers[id].ready) return { connections: connectionView(providers), message: `${providers[id].name} is already signed in on this computer. No login page is needed.` };
  if (!providers[id].installed) throw new Error(`${providers[id].name} CLI was not found on this computer. Install it before signing in.`);
  if (active.has(id)) throw new Error(`${providers[id].name} sign-in is already running. Close its terminal window before trying again.`);
  const codexCommand = resolveCodexCommand();
  const claudeCommand = resolveClaudeCommand();
  const loginCommand = id === 'codex' ? `"${codexCommand}" login` : 'claude auth login';
  let command;
  let args;
  if (process.platform === 'win32') {
    // Windows Terminal is the most reliable way to give a CLI OAuth flow a real
    // interactive console when Agent OS itself was launched from a background process.
    command = process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Microsoft\\WindowsApps\\wt.exe` : 'wt.exe';
    args = ['new-tab', '--title', `${providers[id].name} sign-in`, 'cmd.exe', '/d', '/k', loginCommand];
  } else if (process.platform === 'darwin') {
    command = 'osascript';
    const executable = id === 'codex' ? codexCommand : claudeCommand;
    const terminalCommand = `'${executable.replaceAll("'", "'\\''")}' ${id === 'codex' ? 'login' : 'auth login'}`;
    args = ['-e', 'tell application "Terminal" to activate', '-e', `tell application "Terminal" to do script ${JSON.stringify(terminalCommand)}`];
  } else {
    command = id === 'codex' ? codexCommand : claudeCommand;
    args = id === 'codex' ? ['login'] : ['auth', 'login'];
  }
  const child = spawn(command, args, { windowsHide: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  loginState[id] = 'opening';
  active.set(id, child);
  let diagnostic = '';
  child.stderr.on('data', chunk => { diagnostic = `${diagnostic}${chunk}`.slice(-600); });
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(diagnostic.trim() || `launcher exited with code ${code}`)));
    });
    loginState[id] = 'prompt-opened';
  } catch (error) {
    loginState[id] = 'failed';
    throw new Error(`Could not open ${providers[id].name} sign-in: ${error.message}`);
  } finally {
    active.delete(id);
    refreshConnections(providers);
  }
  return { connections: connectionView(providers), message: `A visible ${process.platform === 'darwin' ? 'Terminal' : 'Windows Terminal'} window is opening for ${providers[id].name}. Follow its browser link or on-screen instructions, then choose Refresh status.` };
}
