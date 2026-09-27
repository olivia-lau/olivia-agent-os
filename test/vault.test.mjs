import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VaultIndex, parseFrontmatter, resolveNotePath } from '../src/vault.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'olivia-os-'));
  const project = path.join(root, 'Master Vault Categories', 'Professional Work', 'Vaults', 'Asana');
  const personal = path.join(root, 'Master Vault Categories', 'Personal Generic');
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(personal, { recursive: true });
  fs.writeFileSync(path.join(project, 'Brief.md'), '---\ntype: project-note\nsensitivity: private\n---\n# Rainbow Brief\nA visual direction for Asana AI teammates.');
  fs.writeFileSync(path.join(personal, 'Home.md'), '# Broadway Home\nRenovation notes and measurements.');
  return root;
}

test('parses simple frontmatter', () => {
  assert.deepEqual(parseFrontmatter('---\ntype: person\nstatus: "active"\n---\n# Note'), { type: 'person', status: 'active' });
});

test('indexes categories and projects and searches content', () => {
  const root = fixture();
  const index = new VaultIndex(root);
  const stats = index.refresh();
  assert.equal(stats.notes, 2);
  const [match] = index.search({ query: 'AI teammates' });
  assert.equal(match.title, 'Rainbow Brief');
  assert.equal(match.category, 'Professional Work');
  assert.equal(match.project, 'Asana');
});

test('blocks reads outside the vault', () => {
  const root = fixture();
  assert.throws(() => resolveNotePath(root, '../secret.md'), /outside/);
  assert.throws(() => resolveNotePath(root, 'image.png'), /Markdown/);
});
