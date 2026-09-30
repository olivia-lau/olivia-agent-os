import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RunStore } from '../src/run-store.mjs';

test('startup recovery marks orphaned running work as interrupted without changing finished runs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-os-recovery-'));
  try {
    const store = new RunStore({ runsPath: path.join(root, 'runs.json'), eventsPath: path.join(root, 'events.jsonl'), performancePath: path.join(root, 'performance.json') });
    const running = store.create({ status: 'running', tasks: [{ id: 'execute', status: 'in_progress' }] });
    const completed = store.create({ status: 'completed', tasks: [{ id: 'execute', status: 'completed' }] });
    assert.deepEqual(store.interruptUnfinished(), [running.id]);
    assert.equal(store.get(running.id).status, 'failed');
    assert.match(store.get(running.id).error, /restarted/);
    assert.equal(store.get(completed.id).status, 'completed');
    assert.deepEqual(store.interruptUnfinished(), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
