import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { VAULT_PATH } from './config.mjs';
import { VaultIndex } from './vault.mjs';
import { createProposal, listProposals } from './store.mjs';
import { RunStore } from './run-store.mjs';
import { AgentOSOrchestrator } from './orchestrator.mjs';
import { detectProviders } from './provider-router.mjs';
import { DirectExecutor } from './direct-executor.mjs';
import { EXECUTION_ROOT } from './config.mjs';

function result(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function compact(note) {
  const { searchText, ...safe } = note;
  return safe;
}

serveStdio(() => {
  const index = new VaultIndex(VAULT_PATH);
  index.refresh();
  const runStore = new RunStore();
  const agentOS = new AgentOSOrchestrator({ index, runStore });
  const providers = detectProviders();
  const directExecutor = new DirectExecutor({ index, runStore, providers });
  const server = new McpServer({ name: 'olivia-agent-os', version: '0.1.0' });

  server.registerTool('search_vault', {
    description: 'Search Olivia’s Obsidian vault. Returns note titles, locations, metadata, and excerpts. Use this before reading full notes.',
    inputSchema: z.object({
      query: z.string().default(''),
      category: z.string().optional(),
      project: z.string().optional(),
      limit: z.number().int().min(1).max(50).default(20)
    })
  }, async input => result(index.search(input).map(compact)));

  server.registerTool('read_note', {
    description: 'Read one Markdown note by the vault-relative path returned from search_vault. This is read-only.',
    inputSchema: z.object({ path: z.string().min(1) })
  }, async ({ path }) => result(compact(index.read(path))));

  server.registerTool('read_os_build_reference', {
    description: 'Read the current Olivia Agent OS build reference in Obsidian: architecture, provider readiness, usage limits, safety, paths, and known gaps. Read this before modifying the OS.',
    inputSchema: z.object({})
  }, async () => result(compact(index.read('00 System/Olivia Agent OS - Build Reference.md'))));

  server.registerTool('list_categories', {
    description: 'List the top-level knowledge categories and their note counts.',
    inputSchema: z.object({})
  }, async () => result(index.categories()));

  server.registerTool('list_recent_notes', {
    description: 'List recently modified notes, optionally restricted to one category.',
    inputSchema: z.object({
      category: z.string().optional(),
      limit: z.number().int().min(1).max(50).default(20)
    })
  }, async input => result(index.recent(input).map(compact)));

  server.registerTool('refresh_vault_index', {
    description: 'Refresh the in-memory index after Obsidian files have changed.',
    inputSchema: z.object({})
  }, async () => result(index.refresh()));

  server.registerTool('propose_note', {
    description: 'Submit a proposed Markdown note for Olivia to review. This does not write into Obsidian until she approves it in the dashboard.',
    inputSchema: z.object({
      title: z.string().min(1).max(180),
      content: z.string().min(1).max(100000),
      category: z.string().min(1).max(180),
      reason: z.string().max(1000).optional()
    })
  }, async input => result(createProposal(input)));

  server.registerTool('list_proposals', {
    description: 'List pending, approved, or rejected note proposals.',
    inputSchema: z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional() })
  }, async ({ status }) => result(listProposals(status || '')));

  server.registerTool('create_goal_run', {
    description: 'Prepare a governed multi-agent run for Olivia to review in Mission Control. This only creates the plan; agents do not start until Olivia approves it.',
    inputSchema: z.object({
      title: z.string().min(1).max(180),
      goal: z.string().min(1).max(12000),
      categories: z.array(z.string().min(1).max(180)).default([]),
      includePrivate: z.boolean().default(true),
      outputCategory: z.string().min(1).max(180).optional()
    })
  }, async input => result(agentOS.createRun(input)));

  server.registerTool('list_goal_runs', {
    description: 'List Agent OS goal runs and their current approval or execution status.',
    inputSchema: z.object({})
  }, async () => result(runStore.list()));

  server.registerTool('get_goal_run', {
    description: 'Read one Agent OS run and its append-only event journal. This is read-only.',
    inputSchema: z.object({ id: z.string().uuid() })
  }, async ({ id }) => result({ run: runStore.get(id), events: runStore.events(id) }));

  server.registerTool('execute_command', {
    description: 'Route a natural-language command to the best ready executor and start it immediately. Commands with potentially consequential actions pause for Olivia’s confirmation in Mission Control.',
    inputSchema: z.object({
      command: z.string().min(1).max(20000),
      workspace: z.string().default(EXECUTION_ROOT),
      provider: z.enum(['auto', 'codex', 'claude', 'perplexity']).default('auto'),
      knowledgeMode: z.enum(['auto', 'on', 'off']).default('auto'),
      memoryMode: z.enum(['auto', 'always', 'never']).default('always'),
      categories: z.array(z.string()).default([]),
      outputCategory: z.string().default('Personal Generic'),
      includePrivate: z.boolean().default(true)
    })
  }, async input => result(directExecutor.create(input)));

  server.registerTool('list_execution_providers', {
    description: 'List Codex, Claude Code, and Perplexity availability used by automatic routing.',
    inputSchema: z.object({})
  }, async () => result(providers));

  return server;
});
