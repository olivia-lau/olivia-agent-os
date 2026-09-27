import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EVENTS_PATH, PERFORMANCE_PATH, RUNS_PATH } from './config.mjs';

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson(filePath, fallback = []) {
  ensureParent(filePath);
  if (!fs.existsSync(filePath)) return fallback;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function writeJson(filePath, value) {
  ensureParent(filePath);
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

export class RunStore {
  constructor({ runsPath = RUNS_PATH, eventsPath = EVENTS_PATH, performancePath = PERFORMANCE_PATH } = {}) {
    this.runsPath = runsPath;
    this.eventsPath = eventsPath;
    this.performancePath = performancePath;
  }

  list() {
    return readJson(this.runsPath).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id) {
    const run = this.list().find(item => item.id === id);
    if (!run) throw new Error('Run not found.');
    return run;
  }

  create(input) {
    const now = new Date().toISOString();
    const run = { id: crypto.randomUUID(), createdAt: now, updatedAt: now, ...input };
    const runs = readJson(this.runsPath);
    runs.unshift(run);
    writeJson(this.runsPath, runs);
    this.event(run.id, 'run.created', { status: run.status, title: run.title });
    return run;
  }

  update(id, updater) {
    const runs = readJson(this.runsPath);
    const index = runs.findIndex(item => item.id === id);
    if (index === -1) throw new Error('Run not found.');
    const updated = typeof updater === 'function' ? updater(runs[index]) : { ...runs[index], ...updater };
    runs[index] = { ...updated, updatedAt: new Date().toISOString() };
    writeJson(this.runsPath, runs);
    return runs[index];
  }

  event(runId, type, data = {}) {
    ensureParent(this.eventsPath);
    const event = { id: crypto.randomUUID(), runId, type, at: new Date().toISOString(), data };
    fs.appendFileSync(this.eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
    return event;
  }

  events(runId, limit = 300) {
    if (!fs.existsSync(this.eventsPath)) return [];
    return fs.readFileSync(this.eventsPath, 'utf8').split(/\r?\n/).filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(event => event && (!runId || event.runId === runId))
      .slice(-Math.min(Number(limit) || 300, 1000));
  }

  performance(entry) {
    const entries = readJson(this.performancePath);
    entries.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), ...entry });
    writeJson(this.performancePath, entries.slice(0, 2000));
  }

  performanceSummary() {
    const groups = new Map();
    for (const entry of readJson(this.performancePath)) {
      const key = `${entry.worker || 'unknown'}|${entry.taskType || 'unknown'}`;
      const group = groups.get(key) || { worker: entry.worker, taskType: entry.taskType, runs: 0, passed: 0, totalDurationMs: 0 };
      group.runs += 1;
      if (entry.success) group.passed += 1;
      group.totalDurationMs += Number(entry.durationMs || 0);
      groups.set(key, group);
    }
    return [...groups.values()].map(group => ({
      ...group,
      passRate: group.runs ? Math.round((group.passed / group.runs) * 100) : 0,
      averageDurationMs: group.runs ? Math.round(group.totalDurationMs / group.runs) : 0
    }));
  }
}
