import test from 'node:test';
import assert from 'node:assert/strict';
import { codexUsageSummary } from '../src/codex-usage.mjs';

test('uses the most depleted Codex window and never invents missing usage', () => {
  const usage = codexUsageSummary({ rateLimits: { primary: { usedPercent: 40, windowDurationMins: 300 }, secondary: { usedPercent: 90, windowDurationMins: 10080 } } });
  assert.equal(usage.remainingPercent, 10);
  assert.match(usage.detail, /7-day window/);
  assert.equal(codexUsageSummary(null).remainingPercent, null);
});
