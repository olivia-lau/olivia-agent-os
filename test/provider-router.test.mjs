import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCommand, requiresExecutionApproval, routeCommand, shouldRemember, shouldUseKnowledge, tokenFailureKind } from '../src/provider-router.mjs';

const providers = {
  codex: { id: 'codex', name: 'Codex', ready: true },
  claude: { id: 'claude', name: 'Claude Code', ready: true },
  perplexity: { id: 'perplexity', name: 'Perplexity', ready: true }
};

test('routes each command to the fastest suitable ready provider', () => {
  assert.equal(routeCommand('Fix the TypeScript bug and run tests', providers).provider, 'codex');
  assert.equal(routeCommand('Research the latest mortgage rates with sources', providers).provider, 'perplexity');
  assert.equal(routeCommand('Prepare a source-backed decision memo on an API bridge', providers).provider, 'perplexity');
  assert.equal(routeCommand('Rewrite this memo in a warmer voice', providers).provider, 'claude');
  assert.equal(routeCommand('Research current policy', { ...providers, perplexity: { ...providers.perplexity, ready: false } }).provider, 'codex');
  assert.equal(routeCommand('Fix the TypeScript bug', providers, { performance: [{ worker: 'claude', taskType: 'code', runs: 5, passRate: 100, averageDurationMs: 1000 }, { worker: 'codex', taskType: 'code', runs: 5, passRate: 80, averageDurationMs: 800 }] }).provider, 'claude');
});

test('detects approval, knowledge, memory, and handoff conditions', () => {
  assert.equal(classifyCommand('Move these files'), 'computer');
  assert.equal(requiresExecutionApproval('Delete the old export'), true);
  assert.equal(requiresExecutionApproval('Summarize the export'), false);
  assert.equal(shouldUseKnowledge('Use my previous notes', 'auto'), true);
  assert.equal(shouldUseKnowledge('Fix this code', 'auto'), true);
  assert.equal(shouldUseKnowledge('Fix this code', 'off'), false);
  assert.equal(shouldRemember('Research this topic', 'research', 'auto'), true);
  assert.equal(shouldRemember('Fix this file', 'code', 'auto'), true);
  assert.equal(tokenFailureKind('maximum context window exceeded'), 'context_limit');
  assert.equal(tokenFailureKind('weekly usage limit reached'), 'provider_limit');
});
