import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-os-project-migration-'));
const data = path.join(root, 'data');
fs.mkdirSync(data, { recursive: true });
process.env.OLIVIA_OS_DATA_PATH = data;
process.env.OLIVIA_VAULT_PATH = path.join(root, 'vault');
const legacy = [{ id: 'old-chat-1', title: 'Endura Vault', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z', attachments: [{ id: 'file-1', name: 'brief.md', path: path.join(root, 'brief.md'), size: 5 }] }];
fs.writeFileSync(path.join(data, 'threads.json'), JSON.stringify(legacy));
const { createThread, getProject, getThread, listProjects, listThreads } = await import('../src/conversation-store.mjs');

test('legacy chats become projects without changing chat ids or attachments', () => {
  const [thread] = listThreads();
  assert.equal(thread.id, legacy[0].id);
  assert.deepEqual(thread.attachments, legacy[0].attachments);
  assert.equal(getProject(thread.projectId).title, 'Endura Vault');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, 'threads.pre-projects.json'), 'utf8')), legacy);
  assert.equal(listProjects().length, 1);
  const next = createThread(thread.projectId);
  assert.notEqual(next.id, thread.id);
  assert.equal(next.projectId, thread.projectId);
  assert.equal(getThread(thread.id).attachments[0].id, 'file-1');
  assert.equal(listProjects().length, 1);
});

test.after(() => fs.rmSync(root, { recursive: true, force: true }));
