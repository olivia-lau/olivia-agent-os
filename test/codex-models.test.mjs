import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCodexModels } from '../src/codex-models.mjs';
import { validateAgentChoices } from '../src/agent-choices.mjs';

test('Codex model picker uses visible local catalog entries and supported efforts', () => {
  const models = normalizeCodexModels([
    { model: 'gpt-6-astra', displayName: 'GPT-6 Astra', hidden: false, isDefault: true, defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'ultra' }] },
    { model: 'internal-model', hidden: true },
    { model: 'bad;model', hidden: false }
  ]);
  assert.deepEqual(models, [{ id: 'gpt-6-astra', name: 'GPT-6 Astra', efforts: ['low', 'ultra'], defaultEffort: 'low', isDefault: true }]);
  assert.equal(validateAgentChoices({ codex: { model: models[0].id, effort: 'ultra' } }).codex.model, 'gpt-6-astra');
});
