import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { resolveClaudeCommand, resolveCodexCommand } from './codex-command.mjs';

function commandStatus(command, args, successPattern) {
  try {
    const env = command === process.execPath && process.versions.electron ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env;
    const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 15000, shell: false, env });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    const detail = result.error?.message || output.trim().split(/\r?\n/).filter(Boolean).at(-1) || `Exited with status ${result.status ?? 'unknown'}`;
    return { installed: result.error?.code !== 'ENOENT', ready: !result.error && result.status === 0 && successPattern.test(output), detail, commandPath: command };
  } catch (error) {
    return { installed: error.code !== 'ENOENT', ready: false, detail: error.message, commandPath: command };
  }
}

export function detectProviders(env = process.env) {
  const codex = commandStatus(resolveCodexCommand(env), ['login', 'status'], /logged in/i);
  const claudeCommand = process.platform === 'win32'
    ? process.execPath
    : resolveClaudeCommand(env);
  const claudeArgs = process.platform === 'win32'
    ? [path.join(env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'), 'auth', 'status']
    : ['auth', 'status'];
  const claude = commandStatus(claudeCommand, claudeArgs, /"loggedIn"\s*:\s*true/i);
  if (claude.installed && !claude.ready) claude.detail = 'Installed but not signed in';
  const perplexityReady = Boolean(env.PERPLEXITY_API_KEY);
  return {
    codex: { id: 'codex', name: 'Codex', ...codex, capabilities: ['code', 'files', 'terminal', 'analysis', 'general'] },
    claude: { id: 'claude', name: 'Claude Code', ...claude, capabilities: ['code', 'files', 'writing', 'analysis', 'general'] },
    perplexity: { id: 'perplexity', name: 'Perplexity', installed: perplexityReady, ready: perplexityReady, detail: perplexityReady ? 'API credential configured' : 'Connect a Perplexity API credential to enable live research', capabilities: ['research', 'current-events'] }
  };
}

export function classifyCommand(command) {
  const value = String(command || '').toLowerCase();
  if (/\b(latest|current|today|news|research|look up|find sources|compare products|web search|source-backed|evidence-backed|decision memo)\b/.test(value)) return 'research';
  if (/\b(code|repo|repository|bug|fix|implement|build|test|debug|refactor|typescript|javascript|python|api|website|app)\b/.test(value)) return 'code';
  if (/\b(write|rewrite|draft|edit|summarize|memo|document|story|copy|email)\b/.test(value)) return 'writing';
  if (/\b(file|folder|rename|move|terminal|command|install|computer|open|convert)\b/.test(value)) return 'computer';
  return 'general';
}

export function requiresExecutionApproval(command) {
  return /\b(delete|remove|erase|uninstall|send|email|publish|post|deploy|merge|push|purchase|buy|pay|book|schedule|cancel|password|credential|api key|share|upload)\b/i.test(String(command || ''));
}

export function shouldUseKnowledge(command, mode = 'auto') {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return true;
}

export function shouldRemember(command, taskType, mode = 'auto') {
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  return true;
}

export function routeCommand(command, providers, { requested = 'auto', exclude = [], performance = [] } = {}) {
  const taskType = classifyCommand(command);
  if (requested !== 'auto') {
    const provider = providers[requested];
    if (!provider?.ready) throw new Error(`${provider?.name || requested} is not ready on this machine.`);
    return { provider: requested, taskType, reason: `You selected ${provider.name}.` };
  }
  const preferences = {
    research: ['perplexity', 'codex', 'claude'],
    code: ['codex', 'claude'],
    writing: ['claude', 'codex'],
    computer: ['codex', 'claude'],
    general: ['codex', 'claude', 'perplexity']
  }[taskType];
  const proven = performance
    .filter(item => item.taskType === taskType && item.runs >= 3 && providers[item.worker]?.ready && !exclude.includes(item.worker))
    .sort((a, b) => b.passRate - a.passRate || a.averageDurationMs - b.averageDurationMs)[0];
  const provider = (proven && preferences.includes(proven.worker) ? providers[proven.worker] : null) || preferences.map(id => providers[id]).find(item => item?.ready && !exclude.includes(item.id));
  if (!provider) throw new Error('No execution provider is currently ready.');
  const ideal = preferences[0];
  const fallback = provider.id !== ideal ? `; ${providers[ideal]?.name || ideal} is unavailable` : '';
  const evidence = proven ? ` based on ${proven.runs} completed ${taskType} runs (${proven.passRate}% passed)` : fallback;
  return { provider: provider.id, taskType, reason: `${provider.name} is the fastest ready fit for ${taskType} work${evidence}.` };
}

export function tokenFailureKind(value) {
  const text = String(value || '').toLowerCase();
  if (/(context window|maximum context|too many tokens|prompt is too long|max_tokens)/.test(text)) return 'context_limit';
  if (/(usage limit|rate limit|quota|credit balance|billing|capacity|overloaded)/.test(text)) return 'provider_limit';
  return '';
}
