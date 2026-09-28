import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-os-conversations-'));
process.env.OLIVIA_OS_DATA_PATH = path.join(root, 'data');
process.env.OLIVIA_VAULT_PATH = path.join(root, 'vault');
const { addAttachment, createThread, getThread, listThreads, removeAttachment, renameThread, saveAttachmentToVault, threadContext, touchThread } = await import('../src/conversation-store.mjs');
const { RunStore } = await import('../src/run-store.mjs');
const { DirectExecutor } = await import('../src/direct-executor.mjs');

test('conversations carry recent turns and explicit references without crossing topics', () => {
  const first = createThread();
  const second = createThread();
  touchThread(first.id, 'First project');
  touchThread(second.id, 'Other project');
  const runs = [
    { threadId: first.id, mode: 'direct', command: 'Continue the design', finalOutput: 'Design result', provider: 'codex' },
    { threadId: second.id, mode: 'direct', command: 'Private unrelated topic', finalOutput: 'Unrelated result', provider: 'claude' }
  ];
  assert.match(threadContext(runs, first.id), /Design result/);
  assert.doesNotMatch(threadContext(runs, first.id), /Unrelated result/);
  assert.match(threadContext(runs, first.id, second.id), /Unrelated result/);
  assert.equal(listThreads().length, 2);
});

test('project names persist and are not replaced by a later prompt', () => {
  const thread = createThread();
  assert.equal(thread.title, 'New project');
  renameThread(thread.id, 'Endura Vault');
  touchThread(thread.id, 'Unrelated prompt title');
  assert.equal(getThread(thread.id).title, 'Endura Vault');
  assert.throws(() => renameThread(thread.id, '  '), /project name/);
});

test('attachments stay outside the vault until explicitly saved and reject unsafe paths', async () => {
  const thread = createThread();
  assert.throws(() => addAttachment(thread.id, '../escape.txt', Readable.from([Buffer.from('bad')])), /Invalid attachment path/);
  const item = await addAttachment(thread.id, 'Project/brief.txt', Readable.from([Buffer.from('brief')]));
  assert.equal(fs.readFileSync(item.path, 'utf8'), 'brief');
  assert.equal(fs.existsSync(process.env.OLIVIA_VAULT_PATH), false);
  const saved = saveAttachmentToVault(thread.id, item.id);
  assert.equal(fs.readFileSync(saved.savedVaultPath, 'utf8'), 'brief');
  assert.ok(saved.savedVaultPath.startsWith(process.env.OLIVIA_VAULT_PATH));
  assert.equal(getThread(thread.id).attachments.length, 1);
  removeAttachment(thread.id, item.id);
  assert.equal(fs.existsSync(item.path), false);
  assert.equal(fs.existsSync(saved.savedVaultPath), true);
});

test('direct runs keep their conversation, chosen files, and bounded prior context', async () => {
  const thread = createThread();
  const item = await addAttachment(thread.id, 'Notes/input.md', Readable.from([Buffer.from('hello')]));
  const runStore = new RunStore({ runsPath: path.join(root, 'runs.json'), eventsPath: path.join(root, 'events.jsonl'), performancePath: path.join(root, 'performance.json') });
  const executor = new DirectExecutor({ index: { search: () => [], read: () => null }, runStore, providers: { codex: { id: 'codex', name: 'Codex', ready: true } } });
  const first = executor.create({ command: 'delete nothing, test only', provider: 'codex', threadId: thread.id, attachmentIds: [item.id], workspace: root });
  assert.equal(first.status, 'awaiting_execution_approval');
  assert.equal(first.attachments[0].path, item.path);
  runStore.update(first.id, { ...first, finalOutput: 'Prior completed answer', status: 'completed' });
  const next = executor.create({ command: 'delete nothing, follow up', provider: 'codex', threadId: thread.id, workspace: root });
  assert.match(next.conversationContext, /Prior completed answer/);
  assert.equal(next.attachments.length, 0);
  const fresh = executor.create({ command: 'delete nothing, fresh', provider: 'codex', workspace: root });
  assert.equal(fresh.conversationContext, '');
  assert.notEqual(fresh.threadId, thread.id);
});

test.after(() => fs.rmSync(root, { recursive: true, force: true }));
