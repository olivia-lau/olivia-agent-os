import { spawn } from 'node:child_process';
import { resolveCodexCommand } from './codex-command.mjs';

export function readCodexUsage({ timeoutMs = 8000 } = {}) {
  return new Promise(resolve => {
    const child = spawn(resolveCodexCommand(), ['app-server', '--stdio'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let settled = false;
    let buffer = '';
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    child.on('error', () => finish(null));
    child.on('close', () => finish(null));
    child.stdin.on('error', () => finish(null));
    child.stdout.on('data', chunk => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id === 1 && !message.error) {
          child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
          child.stdin.write(`${JSON.stringify({ id: 2, method: 'account/rateLimits/read', params: { excludeResetCreditDetails: true } })}\n`);
        }
        if (message.id === 2) finish(message.result || null);
      }
    });
    child.stdin.write(`${JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'olivia-agent-os', version: '0.1.0' } } })}\n`);
  });
}

export function codexUsageSummary(payload) {
  const bucket = payload?.rateLimitsByLimitId?.codex || payload?.rateLimits;
  const windows = [bucket?.primary, bucket?.secondary].filter(value => Number.isFinite(value?.usedPercent));
  const limiting = windows.sort((a, b) => b.usedPercent - a.usedPercent)[0];
  if (!limiting) return { state: 'unknown', remainingPercent: null, label: 'Usage unavailable', detail: 'Codex did not return a usable limit.' };
  const remainingPercent = Math.max(0, Math.min(100, 100 - limiting.usedPercent));
  const duration = limiting.windowDurationMins >= 1440 ? `${Math.round(limiting.windowDurationMins / 1440)}-day` : `${Math.round(limiting.windowDurationMins / 60)}-hour`;
  return { state: 'known', remainingPercent, label: `${remainingPercent}% left`, detail: `${duration} window${limiting.resetsAt ? ` · resets ${new Date(limiting.resetsAt * 1000).toLocaleString()}` : ''}`, checkedAt: new Date().toISOString() };
}
