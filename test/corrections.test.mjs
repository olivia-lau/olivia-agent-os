import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VaultIndex } from '../src/vault.mjs';
import { relevantCorrections, saveCorrection } from '../src/corrections.mjs';

test('saves a human correction and recalls it only for similar work in scope', () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'olivia-correction-test-'));
  const index = new VaultIndex(vault);
  index.refresh();
  const run = { id: 'source-run', outputCategory: 'Professional Work' };
  const correction = saveCorrection(index, run, {
    wrong: 'The bunny looked furry.',
    guidance: 'Use the smooth pink clay style from the approved bunny.',
    appliesTo: 'American Greetings Easter bunny concepts',
    category: 'Professional Work'
  });
  assert.ok(fs.existsSync(correction.path));
  assert.match(fs.readFileSync(correction.path, 'utf8'), /The bunny looked furry/);
  const recalled = relevantCorrections(index, { goal: 'Create another American Greetings Easter bunny', category: 'Professional Work' });
  assert.equal(recalled.count, 1);
  assert.match(recalled.packet, /smooth pink clay style/);
  assert.doesNotMatch(recalled.packet, /looked furry/);
  assert.equal(relevantCorrections(index, { goal: 'Prepare a Reddit branding deck', category: 'Professional Work' }).count, 0);
  assert.equal(relevantCorrections(index, { goal: 'Create another American Greetings Easter bunny', category: 'Personal Generic' }).count, 0);
});
