import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VaultIndex } from '../src/vault.mjs';
import { RunStore } from '../src/run-store.mjs';

async function waitFor(store, id, wanted, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const run = store.get(id);
    if (wanted.includes(run.status)) return run;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${wanted.join(', ')}`);
}

test('runs the complete governed pipeline with mock OMA workers', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'olivia-os-run-'));
  const vault = path.join(root, 'vault');
  const noteFolder = path.join(vault, 'Master Vault Categories', 'Professional Work');
  const data = path.join(root, 'data');
  fs.mkdirSync(noteFolder, { recursive: true });
  fs.writeFileSync(path.join(noteFolder, 'Invoice research.md'), '---\nsensitivity: private\n---\n# Invoice research\nThe invoicing workflow needs exportable records and approval controls.');
  process.env.OLIVIA_AGENT_MODE = 'mock';
  process.env.OLIVIA_OS_DATA_PATH = data;
  process.env.OLIVIA_VAULT_PATH = vault;
  const { AgentOSOrchestrator } = await import(`../src/orchestrator.mjs?test=${Date.now()}`);

  const index = new VaultIndex(vault);
  index.refresh();
  const store = new RunStore({
    runsPath: path.join(data, 'runs.json'),
    eventsPath: path.join(data, 'events.jsonl'),
    performancePath: path.join(data, 'performance.json')
  });
  const proposals = new Map();
  const engine = new AgentOSOrchestrator({
    index,
    runStore: store,
    proposals: {
      createProposal(input) { const value = { id: `p-${proposals.size + 1}`, ...input, status: 'pending' }; proposals.set(value.id, value); return value; },
      approveProposal(id) { const value = proposals.get(id); value.status = 'approved'; value.notePath = `90 Agent OS Inbox/${value.title}.md`; return value; },
      rejectProposal(id) { const value = proposals.get(id); value.status = 'rejected'; return value; }
    }
  });

  const created = engine.createRun({
    title: 'Invoice decision',
    goal: 'Recommend an invoicing workflow with evidence and approval controls.',
    categories: ['Professional Work'],
    includePrivate: true,
    outputCategory: 'Professional Work'
  });
  assert.equal(created.status, 'awaiting_plan_approval');
  assert.equal(created.tasks.length, 4);
  assert.equal(created.context.sources.length, 1);

  engine.approvePlan(created.id, created.planHash);
  const reviewable = await waitFor(store, created.id, ['awaiting_output_approval', 'failed']);
  assert.equal(reviewable.status, 'awaiting_output_approval', reviewable.error);
  assert.equal(reviewable.verification.pass, true);
  assert.equal(reviewable.reviewerVerdict, 'SHIP');
  assert.ok(reviewable.outputHash);
  assert.equal(proposals.size, 1);
  assert.ok(fs.existsSync(reviewable.memoryPath), 'a review-labeled run record is saved automatically');
  assert.match(fs.readFileSync(reviewable.memoryPath, 'utf8'), /status: review-pending/);

  const completed = engine.approveOutput(created.id, reviewable.outputHash);
  assert.equal(completed.status, 'completed');
  assert.match(completed.destination, /90 Agent OS Inbox/);
  assert.ok(store.events(created.id).some(event => event.type === 'output.approved'));
});
