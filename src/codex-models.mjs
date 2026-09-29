import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { resolveCodexCommand } from './codex-command.mjs';

export function normalizeCodexModels(data) {
  return (Array.isArray(data) ? data : [])
    .filter(item => item && !item.hidden && typeof item.model === 'string' && /^[a-zA-Z0-9._-]+$/.test(item.model))
    .map(item => ({
      id: item.model,
      name: String(item.displayName || item.model),
      efforts: (item.supportedReasoningEfforts || []).map(value => value.reasoningEffort).filter(Boolean),
      defaultEffort: item.defaultReasoningEffort || '',
      isDefault: Boolean(item.isDefault)
    }));
}

// The catalog belongs to the CLI and account on this computer. Never assume
// another installation or ChatGPT account has the same models.
export function getCodexModels({ command = resolveCodexCommand(), spawnImpl = spawn, timeoutMs = 8000 } = {}) {
  return new Promise(resolve => {
    const env = command === process.execPath && process.versions.electron
      ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
      : process.env;
    let child;
    let settled = false;
    let cursor = null;
    const models = [];
    const finish = (error = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child?.kill();
      resolve({ models, error, command });
    };
    const timer = setTimeout(() => finish('Codex model discovery timed out. Update the CLI or enter a model name manually.'), timeoutMs);
    try {
      child = spawnImpl(command, ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false, env });
      child.on('error', error => finish(error.message));
      child.on('close', () => finish(models.length ? '' : 'Codex model discovery ended before returning a catalog.'));
      const send = message => child.stdin.write(`${JSON.stringify(message)}\n`);
      const lines = readline.createInterface({ input: child.stdout });
      lines.on('line', line => {
        if (settled) return;
        let response;
        try { response = JSON.parse(line); } catch { return; }
        if (response.id === 1) {
          if (response.error) return finish(response.error.message || 'Codex initialization failed.');
          send({ method: 'initialized', params: {} });
          send({ method: 'model/list', id: 2, params: { limit: 100, includeHidden: false } });
        } else if (response.id === 2) {
          if (response.error) return finish(response.error.message || 'This Codex CLI cannot list models.');
          models.push(...normalizeCodexModels(response.result?.data));
          cursor = response.result?.nextCursor || null;
          if (cursor) send({ method: 'model/list', id: 2, params: { limit: 100, cursor, includeHidden: false } });
          else finish();
        }
      });
      send({ method: 'initialize', id: 1, params: { clientInfo: { name: 'agent_os', title: 'Agent OS', version: '0.2.17' } } });
    } catch (error) { finish(error.message); }
  });
}
