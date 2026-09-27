import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCodexModel } from '../src/agent-settings.mjs';

test('Codex model override accepts a model identifier or the default', () => {
  assert.equal(validateCodexModel(''), '');
  assert.equal(validateCodexModel(' gpt-5.6-sol '), 'gpt-5.6-sol');
  assert.throws(() => validateCodexModel('gpt-5.6-sol --dangerously-bypass-approvals-and-sandbox'));
  assert.throws(() => validateCodexModel('x'.repeat(101)));
});
