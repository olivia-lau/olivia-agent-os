import { codexUsageSummary, readCodexUsage } from './codex-usage.mjs';

let cached = null;
let lastRead = 0;
let pending = null;

export async function getUsageStatus(providers, { maxAgeMs = 60000 } = {}) {
  if (!cached || Date.now() - lastRead > maxAgeMs) {
    pending ||= readCodexUsage().then(raw => {
      cached = codexUsageSummary(raw);
      lastRead = Date.now();
      return cached;
    }).catch(() => {
      cached = codexUsageSummary(null);
      lastRead = Date.now();
      return cached;
    }).finally(() => { pending = null; });
    await pending;
  }
  return {
    codex: cached,
    claude: { state: 'unknown', remainingPercent: null, label: providers.claude?.ready ? 'Usage unavailable' : 'Sign in required', detail: 'Claude Code does not provide this dashboard with a remaining-usage feed.' },
    perplexity: { state: 'unknown', remainingPercent: null, label: providers.perplexity?.ready ? 'Check API Billing' : 'API key required', detail: 'The API key does not expose remaining credits here. Check the Perplexity API console Billing page.' }
  };
}
