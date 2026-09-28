import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-os-conversations-'));
process.env.OLIVIA_OS_DATA_PATH = path.join(root, 'data');
process.env.OLIVIA_VAULT_PATH = path.join(root, 'vault');
const { addAttachment, createProject, createThread, getProject, getThread, listProjects, listThreads, removeAttachment, renameProject, renameThread, saveAttachmentToVault, threadContext, touchThread } = await import('../src/conversation-store.mjs');
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
  const project = createProject();
  const thread = createThread(project.id);
  assert.equal(project.title, 'New project');
  renameProject(project.id, 'Endura Vault');
  renameThread(thread.id, 'First discussion');
  touchThread(thread.id, 'Unrelated prompt title');
  assert.equal(getProject(project.id).title, 'Endura Vault');
  assert.equal(getThread(thread.id).title, 'First discussion');
  assert.throws(() => renameProject(project.id, '  '), /project name/);
  assert.throws(() => renameThread(thread.id, '  '), /conversation name/);
  const second = createThread(project.id);
  assert.equal(second.projectId, project.id);
  assert.equal(listProjects().filter(item => item.id === project.id).length, 1);
  assert.equal(listThreads().filter(item => item.projectId === project.id).length, 2);
});

test('conversations within one project keep independent context', () => {
  const project = createProject('Shared project');
  const first = createThread(project.id);
  const second = createThread(project.id);
  const runs = [{ threadId: first.id, mode: 'direct', command: 'Secret draft', finalOutput: 'First-only answer', provider: 'codex' }];
  assert.equal(threadContext(runs, second.id), '');
  assert.match(threadContext(runs, second.id, first.id), /First-only answer/);
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

test('saving or removing a file does not prevent the next project prompt', async () => {
  const thread = createThread();
  const first = await addAttachment(thread.id, 'brief.md', Readable.from([Buffer.from('first')]));
  saveAttachmentToVault(thread.id, first.id);
  const second = await addAttachment(thread.id, 'scratch.md', Readable.from([Buffer.from('second')]));
  removeAttachment(thread.id, second.id);
  const runStore = new RunStore({ runsPath: path.join(root, 'file-action-runs.json'), eventsPath: path.join(root, 'file-action-events.jsonl'), performancePath: path.join(root, 'file-action-performance.json') });
  const executor = new DirectExecutor({ index: { search: () => [], read: () => null }, runStore, providers: { codex: { id: 'codex', name: 'Codex', ready: true } } });
  const run = executor.create({ command: 'delete nothing; test prompt after file actions', provider: 'codex', threadId: thread.id, workspace: root });
  assert.equal(run.threadId, thread.id);
  assert.equal(run.status, 'awaiting_execution_approval');
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
