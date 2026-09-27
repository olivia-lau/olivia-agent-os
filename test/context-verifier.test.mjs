import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VaultIndex } from '../src/vault.mjs';
import { buildContextPacket } from '../src/context-broker.mjs';
import { verifyDeliverable } from '../src/verifier.mjs';

test('context broker enforces category and privacy scope with provenance', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'olivia-context-'));
  const professional = path.join(root, 'Master Vault Categories', 'Professional Work');
  const personal = path.join(root, 'Master Vault Categories', 'Personal Generic');
  fs.mkdirSync(professional, { recursive: true });
  fs.mkdirSync(personal, { recursive: true });
  fs.writeFileSync(path.join(professional, 'Public.md'), '---\nsensitivity: public\n---\n# Invoice options\nPayment processor comparison.');
  fs.writeFileSync(path.join(personal, 'Private.md'), '---\nsensitivity: private\n---\n# Invoice anxiety\nPrivate personal note about invoices.');
  const index = new VaultIndex(root);
  index.refresh();
  const packet = buildContextPacket(index, { goal: 'compare invoice options', categories: ['Professional Work'], includePrivate: false });
  assert.equal(packet.sources.length, 1);
  assert.equal(packet.sources[0].category, 'Professional Work');
  assert.equal(packet.sources[0].sensitivity, 'public');
  assert.match(packet.packetHash, /^[a-f0-9]{64}$/);
});

test('verifier requires structure and vault provenance', () => {
  const good = '# Summary\nA sufficiently detailed summary. '.repeat(10) + '\n# Evidence\nvault-1\n# Analysis\nAnalysis.\n# Recommendation\nDo it.\n# Risks\nRisk.\n# Sources\nvault-1';
  assert.equal(verifyDeliverable(good, { sourceIds: ['vault-1'] }).pass, true);
  assert.equal(verifyDeliverable('# Summary\nToo short', { sourceIds: ['vault-1'] }).pass, false);
});
