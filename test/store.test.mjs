import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('a proposal requires approval before it becomes a new Obsidian note', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'olivia-os-store-'));
  const vault = path.join(root, 'vault');
  const data = path.join(root, 'data');
  const inbox = path.join(vault, '90 Agent OS Inbox');
  fs.mkdirSync(vault, { recursive: true });
  process.env.OLIVIA_VAULT_PATH = vault;
  process.env.OLIVIA_OS_DATA_PATH = data;
  process.env.OLIVIA_OS_INBOX_PATH = inbox;
  const store = await import(`../src/store.mjs?test=${Date.now()}`);

  const proposal = store.createProposal({
    title: 'A reviewed insight',
    category: 'Personal Generic',
    content: 'This stays outside Obsidian until approval.',
    reason: 'Test the safe write boundary.'
  });
  assert.equal(proposal.status, 'pending');
  assert.equal(fs.existsSync(inbox), false);

  const approved = store.approveProposal(proposal.id);
  assert.equal(approved.status, 'approved');
  const written = path.join(vault, ...approved.notePath.split('/'));
  assert.equal(fs.existsSync(written), true);
  assert.match(fs.readFileSync(written, 'utf8'), /status: inbox/);
  assert.match(fs.readFileSync(written, 'utf8'), /This stays outside Obsidian until approval/);
});
