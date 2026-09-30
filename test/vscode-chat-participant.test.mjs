import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const chat = require('../vscode-extension/agentos-chat.cjs');
const manifest = JSON.parse(await readFile(new URL('../vscode-extension/package.json', import.meta.url), 'utf8'));

test('extension contributes sticky @agentos with explicit agent routes', () => {
  const [participant] = manifest.contributes.chatParticipants;
  assert.equal(participant.id, chat.PARTICIPANT_ID);
  assert.equal(participant.name, 'agentos');
  assert.equal(participant.isSticky, true);
  assert.deepEqual(participant.commands.map(command => command.name), ['auto', 'codex', 'claude', 'new']);
  assert.ok(manifest.activationEvents.includes(`onChatParticipant:${chat.PARTICIPANT_ID}`));
});

test('agent slash commands select only explicit CLI providers; default stays automatic', () => {
  assert.equal(chat.requestedProvider('claude'), 'claude');
  assert.equal(chat.requestedProvider('codex'), 'codex');
  assert.equal(chat.requestedProvider('auto'), 'auto');
  assert.equal(chat.requestedProvider(undefined), 'auto');
});

test('participant history carries the Agent OS project and conversation between turns', () => {
  const session = chat.sessionFromHistory([
    { result: { metadata: { agentOsThreadId: 'thread-old', agentOsProjectId: 'project-old' } } },
    { result: { metadata: { agentOsThreadId: 'thread-new', agentOsProjectId: 'project-new' } } }
  ]);
  assert.deepEqual(session, { threadId: 'thread-new', projectId: 'project-new' });
  assert.equal(chat.sessionFromHistory([]), null);
});

test('run polling recognizes terminal states and formats handoff progress', () => {
  assert.equal(chat.isTerminal('completed'), true);
  assert.equal(chat.isTerminal('running'), false);
  assert.equal(chat.progressLabel({ type: 'execution.handoff', data: { from: 'claude', to: 'codex' } }), 'Agent handoff: claude → codex.');
});
