import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAgentChoices } from '../src/agent-choices.mjs';

test('agent settings stay separate and use each provider default when unset', () => {
  const choices = validateAgentChoices({
    codex: { model: 'gpt-5.3-codex', effort: 'high' },
    claude: { model: 'sonnet', effort: 'medium' },
    perplexity: { preset: 'high', model: 'perplexity/sonar', effort: 'low' }
  });
  assert.equal(choices.codex.effort, 'high');
  assert.equal(choices.claude.model, 'sonnet');
  assert.equal(choices.perplexity.preset, 'high');
  assert.equal(validateAgentChoices().perplexity.preset, 'fast');
  assert.throws(() => validateAgentChoices({ codex: { effort: 'ultra' } }), /effort/);
  assert.throws(() => validateAgentChoices({ claude: { model: 'bad;command' } }), /model/);
});
