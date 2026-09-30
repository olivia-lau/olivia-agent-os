import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ROOT, DATA_PATH, DISPLAY_NAME, EXECUTION_ROOT, HOST, PORT, RUN_ARTIFACTS_PATH, VAULT_PATH } from './config.mjs';
import { VaultIndex } from './vault.mjs';
import { buildContextPacket } from './context-broker.mjs';
import { approveProposal, createProposal, listActivity, listProposals, rejectProposal } from './store.mjs';
import { RunStore } from './run-store.mjs';
import { AgentOSOrchestrator } from './orchestrator.mjs';
import { detectProviders } from './provider-router.mjs';
import { DirectExecutor } from './direct-executor.mjs';
import { getUsageStatus } from './usage-status.mjs';
import { saveCorrection } from './corrections.mjs';
import { beginLogin, connectionView, disconnectProvider, refreshConnections } from './connections.mjs';
import { clearSessionPerplexityKey, setSessionPerplexityKey } from './perplexity-executor.mjs';
import { forgetPerplexityKey, loadPerplexityKey, savePerplexityKey } from './perplexity-key-store.mjs';
import { githubVaultStatus, pullGithubVault, publishAgentNotes, verifyGithubVaultAccess } from './github-vault.mjs';
import { getAgentSettings, saveAgentSettings } from './agent-settings.mjs';
import { getCodexModels } from './codex-models.mjs';
import { addAttachment, adoptLegacyRun, createProject, createThread, listProjects, listThreads, removeAttachment, renameProject, renameThread, saveAttachmentToVault } from './conversation-store.mjs';

const GITHUB_REPO = process.env.OLIVIA_OS_GITHUB_REPO || '';
const GITHUB_ROOT = process.env.OLIVIA_OS_GITHUB_ROOT || '';

try {
  const savedKey = await loadPerplexityKey();
  if (savedKey) setSessionPerplexityKey(savedKey);
} catch {
  console.warn('The saved Perplexity key could not be decrypted. Reconnect it in Agent connections.');
}

const publicRoot = path.join(APP_ROOT, 'public');
const index = new VaultIndex(VAULT_PATH);
index.refresh();
const runStore = new RunStore();
runStore.interruptUnfinished();
for (const run of runStore.list()) {
  if (run.mode !== 'direct' || run.threadId) continue;
  adoptLegacyRun(run);
  runStore.update(run.id, { ...run, threadId: run.id });
}
const agentOS = new AgentOSOrchestrator({ index, runStore });
const providers = detectProviders();
refreshConnections(providers);
const directExecutor = new DirectExecutor({ index, runStore, providers });

function checkLocalOrigin(request) {
  const origin = request.headers.origin;
  const localPort = server.address()?.port || PORT;
  if (origin && ![`http://127.0.0.1:${localPort}`, `http://localhost:${localPort}`].includes(origin)) throw new Error('Connection changes must come from this dashboard.');
}

function systemStatus() {
  return [
    ...Object.values(providers).map(provider => ({ id: `provider-${provider.id}`, name: provider.name, status: provider.ready ? 'ready' : 'deferred', detail: provider.ready ? 'Available for automatic routing' : provider.detail })),
    { id: 'router', name: 'Fast provider router', status: 'ready', detail: 'Uses task fit, readiness, pass rate, and speed; deeper teams remain optional' },
    { id: 'handoff', name: 'Token-limit handoff', status: 'ready', detail: 'Checkpointed continuation across providers or fresh sessions' },
    { id: 'orchestrator', name: 'OMA orchestration', status: 'ready', detail: 'Explicit dependency graph with parallel workers' },
    { id: 'worker', name: 'Codex workers', status: 'ready', detail: 'Authenticated local Codex CLI, read-only execution' },
    { id: 'context', name: 'Context broker', status: 'ready', detail: 'Category, sensitivity, size, provenance, and hash controls' },
    { id: 'knowledge', name: 'Obsidian knowledge', status: 'ready', detail: `${index.notes.length} notes indexed` },
    { id: 'verification', name: 'Native verification', status: 'ready', detail: 'Executable format, provenance, and independent-review checks' },
    { id: 'approvals', name: 'Approval gates', status: 'ready', detail: 'Plan and output hashes must match reviewed content' },
    { id: 'events', name: 'Durable events', status: 'ready', detail: 'Append-only local run history' },
    { id: 'ringer', name: 'Ringer adapter', status: 'deferred', detail: 'Requires WSL and Python 3.12 on this Windows machine' },
    { id: 'gateway', name: 'LiteLLM gateway', status: 'deferred', detail: 'Activates when provider API credentials are configured' },
    { id: 'image-provider', name: 'Image generation', status: 'deferred', detail: 'Needs an image API or host bridge; Codex CLI alone cannot render images' },
    { id: 'remote', name: 'Remote infrastructure', status: 'deferred', detail: 'Docker, LiveSync, NATS, and monitoring follow local proof' }
  ];
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

function text(response, status, value, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  response.end(value);
}

async function bodyJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('Request is too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function noteSummary(note) {
  const { searchText, markdown, ...safe } = note;
  return safe;
}

function agentNotePaths() {
  const paths = [];
  for (const thread of listThreads()) for (const item of thread.attachments || []) if (item.savedVaultPath) paths.push(item.savedVaultPath);
  for (const run of runStore.list()) {
    if (run.memoryPath) {
      paths.push(run.memoryPath);
      const folder = path.dirname(run.memoryPath);
      if (fs.existsSync(folder)) {
        for (const name of fs.readdirSync(folder)) {
          if (name.startsWith(`${run.id.slice(0, 8)}-`)) paths.push(path.join(folder, name));
        }
      }
    }
    for (const correction of run.corrections || []) if (correction.path) paths.push(correction.path);
  }
  for (const proposal of listProposals('approved')) {
    if (proposal.notePath) paths.push(path.resolve(path.dirname(process.env.OLIVIA_OS_INBOX_PATH || path.join(VAULT_PATH, '90 Agent OS Inbox')), proposal.notePath));
  }
  return paths;
}

function fullNote(note) {
  const { searchText, ...safe } = note;
  return safe;
}

const fileTypes = {
  '.png': ['image/png', 'image'], '.jpg': ['image/jpeg', 'image'], '.jpeg': ['image/jpeg', 'image'], '.gif': ['image/gif', 'image'], '.webp': ['image/webp', 'image'], '.svg': ['image/svg+xml', 'image'],
  '.pdf': ['application/pdf', 'pdf'], '.md': ['text/markdown; charset=utf-8', 'text'], '.txt': ['text/plain; charset=utf-8', 'text'], '.json': ['application/json; charset=utf-8', 'text'],
  '.js': ['text/javascript; charset=utf-8', 'text'], '.mjs': ['text/javascript; charset=utf-8', 'text'], '.ts': ['text/plain; charset=utf-8', 'text'], '.tsx': ['text/plain; charset=utf-8', 'text'],
  '.jsx': ['text/plain; charset=utf-8', 'text'], '.css': ['text/css; charset=utf-8', 'text'], '.html': ['text/html; charset=utf-8', 'text'], '.py': ['text/plain; charset=utf-8', 'text'],
  '.csv': ['text/csv; charset=utf-8', 'text'], '.xml': ['application/xml; charset=utf-8', 'text']
};

function allowedRoots() {
  return [...new Set([VAULT_PATH, RUN_ARTIFACTS_PATH, path.join(DATA_PATH, 'thread-attachments'), EXECUTION_ROOT, ...runStore.list().map(run => run.workspace).filter(Boolean)].map(root => path.resolve(root)))];
}

function safeFilePath(value) {
  const absolute = path.resolve(String(value || ''));
  const secretsRoot = path.join(DATA_PATH, 'secrets');
  const secretsRelative = path.relative(secretsRoot, absolute);
  if (secretsRelative === '' || (!secretsRelative.startsWith('..') && !path.isAbsolute(secretsRelative))) throw new Error('Secret files cannot be previewed.');
  const allowed = allowedRoots().some(root => {
    const relative = path.relative(root, absolute);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });
  if (!allowed) throw new Error('That file is outside the approved workspaces.');
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error('File not found.');
  return absolute;
}

function addRunFile(files, candidate, origin) {
  try {
    const absolute = safeFilePath(String(candidate).replace(/^<|>$/g, '').trim());
    if (!files.has(absolute)) {
      const stat = fs.statSync(absolute);
      const ext = path.extname(absolute).toLowerCase();
      files.set(absolute, { path: absolute, name: path.basename(absolute), extension: ext, kind: fileTypes[ext]?.[1] || 'file', size: stat.size, origin });
    }
  } catch {}
}

function runFiles(run) {
  const files = new Map();
  for (const item of run.attachments || []) addRunFile(files, item.path, 'attachment');
  const output = String(run.finalOutput || '');
  const markdownPaths = [...output.matchAll(/\[[^\]]+\]\(<?((?:[A-Za-z]:[\\/]|\/)[^)>]+)>?\)/g)].map(match => match[1]);
  const plainPaths = [...output.matchAll(/(?:^|[\s`(])((?:[A-Za-z]:[\\/]|\/)[^\r\n<>"|?*]+?\.(?:png|jpe?g|gif|webp|svg|pdf|md|txt|json|html|css|m?js|tsx?|jsx|py|csv|xml|docx|xlsx|pptx|blend))/gim)].map(match => match[1]);
  for (const candidate of [...markdownPaths, ...plainPaths]) addRunFile(files, candidate, 'output');
  const artifactDir = path.join(RUN_ARTIFACTS_PATH, run.id);
  if (fs.existsSync(artifactDir)) {
    const stack = [artifactDir];
    while (stack.length && files.size < 40) {
      const directory = stack.pop();
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) stack.push(absolute);
        else if (!entry.name.endsWith('.tmp')) addRunFile(files, absolute, 'run artifact');
      }
    }
  }
  return [...files.values()];
}

function runsWithEvents(limit = 40) {
  return runStore.list().map(run => ({
    ...run,
    tasks: run.mode !== 'direct' && ['awaiting_output_approval', 'completed'].includes(run.status)
      ? (run.tasks || []).map(task => task.status === 'failed' ? task : { ...task, status: 'completed' })
      : run.tasks,
    events: runStore.events(run.id, limit),
    files: runFiles(run)
  }));
}

function staticFile(requestPath, response) {
  const wanted = requestPath === '/' ? 'index.html' : requestPath.slice(1);
  const absolute = path.resolve(publicRoot, wanted);
  if (!absolute.startsWith(publicRoot) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return false;
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
  text(response, 200, fs.readFileSync(absolute), types[path.extname(absolute)] || 'application/octet-stream');
  return true;
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);
    const segments = url.pathname.split('/').filter(Boolean);

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return json(response, 200, { ok: true, vaultPath: VAULT_PATH, indexedAt: index.lastIndexedAt });
    }
    if (request.method === 'GET' && url.pathname === '/api/overview') {
      return json(response, 200, {
        stats: index.stats(),
        categories: index.categories(),
        recent: index.recent({ limit: 12 }).map(noteSummary),
        proposals: listProposals(),
        activity: listActivity(12),
        runs: runsWithEvents(),
        threads: listThreads(), projects: listProjects(),
        system: systemStatus(),
        providers,
        connections: connectionView(providers),
        agentSettings: getAgentSettings(),
        usage: await getUsageStatus(providers),
        executionRoot: EXECUTION_ROOT,
        displayName: DISPLAY_NAME,
        performance: runStore.performanceSummary(),
        simulationEnabled: process.env.OLIVIA_ENABLE_HANDOFF_SIMULATION === '1',
        backend: GITHUB_REPO ? { type: 'github', repoId: GITHUB_REPO } : { type: 'local' }
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/backend') {
      return json(response, 200, GITHUB_REPO ? await githubVaultStatus(GITHUB_ROOT, GITHUB_REPO) : { type: 'local', vaultPath: VAULT_PATH });
    }
    if (request.method === 'POST' && url.pathname === '/api/backend/verify') {
      checkLocalOrigin(request);
      if (!GITHUB_REPO) throw new Error('This vault is not linked to GitHub.');
      return json(response, 200, await verifyGithubVaultAccess(GITHUB_ROOT, GITHUB_REPO));
    }
    if (request.method === 'POST' && url.pathname === '/api/backend/pull') {
      checkLocalOrigin(request);
      if (!GITHUB_REPO) throw new Error('This vault is not linked to GitHub.');
      const result = await pullGithubVault(GITHUB_ROOT, GITHUB_REPO);
      index.refresh();
      return json(response, 200, result);
    }
    if (request.method === 'POST' && url.pathname === '/api/backend/publish') {
      checkLocalOrigin(request);
      if (!GITHUB_REPO) throw new Error('This vault is not linked to GitHub.');
      return json(response, 200, await publishAgentNotes(GITHUB_ROOT, GITHUB_REPO, agentNotePaths()));
    }
    if (request.method === 'GET' && url.pathname === '/api/system') {
      return json(response, 200, { services: systemStatus(), providers, executionRoot: EXECUTION_ROOT, performance: runStore.performanceSummary() });
    }
    if (request.method === 'GET' && url.pathname === '/api/providers') {
      return json(response, 200, { providers, executionRoot: EXECUTION_ROOT });
    }
    if (request.method === 'GET' && url.pathname === '/api/threads') {
      return json(response, 200, { threads: listThreads() });
    }
    if (request.method === 'GET' && url.pathname === '/api/projects') {
      return json(response, 200, { projects: listProjects() });
    }
    if (request.method === 'POST' && url.pathname === '/api/projects') {
      checkLocalOrigin(request);
      const { title } = await bodyJson(request);
      const project = createProject(title || 'New project');
      return json(response, 201, { project, thread: createThread(project.id) });
    }
    if (request.method === 'PATCH' && segments[0] === 'api' && segments[1] === 'projects' && segments[2] && segments.length === 3) {
      checkLocalOrigin(request);
      const { title } = await bodyJson(request);
      return json(response, 200, { project: renameProject(segments[2], title) });
    }
    if (request.method === 'POST' && url.pathname === '/api/threads') {
      checkLocalOrigin(request);
      const { projectId } = await bodyJson(request);
      return json(response, 201, { thread: createThread(projectId) });
    }
    if (request.method === 'PATCH' && segments[0] === 'api' && segments[1] === 'threads' && segments[2] && segments.length === 3) {
      checkLocalOrigin(request);
      const { title } = await bodyJson(request);
      return json(response, 200, { thread: renameThread(segments[2], title) });
    }
    if (request.method === 'POST' && segments[0] === 'api' && segments[1] === 'threads' && segments[2] && segments[3] === 'attachments' && segments.length === 4) {
      checkLocalOrigin(request);
      const attachment = await addAttachment(segments[2], url.searchParams.get('path'), request);
      return json(response, 201, { attachment });
    }
    if (request.method === 'DELETE' && segments[0] === 'api' && segments[1] === 'threads' && segments[2] && segments[3] === 'attachments' && segments[4] && segments.length === 5) {
      checkLocalOrigin(request);
      return json(response, 200, { thread: removeAttachment(segments[2], segments[4]) });
    }
    if (request.method === 'POST' && segments[0] === 'api' && segments[1] === 'threads' && segments[2] && segments[3] === 'attachments' && segments[4] && segments[5] === 'save' && segments.length === 6) {
      checkLocalOrigin(request);
      const attachment = saveAttachmentToVault(segments[2], segments[4]);
      index.refresh();
      return json(response, 200, { attachment });
    }
    if (request.method === 'POST' && url.pathname === '/api/connections/refresh') {
      checkLocalOrigin(request);
      return json(response, 200, { connections: refreshConnections(providers, { settlePending: true }) });
    }
    if (request.method === 'POST' && url.pathname === '/api/connections/login') {
      checkLocalOrigin(request);
      const { provider } = await bodyJson(request);
      return json(response, 202, await beginLogin(provider, providers));
    }
    if (request.method === 'POST' && url.pathname === '/api/connections/logout') {
      checkLocalOrigin(request);
      const { provider } = await bodyJson(request);
      return json(response, 200, await disconnectProvider(provider, providers));
    }
    if (request.method === 'POST' && url.pathname === '/api/agent-settings') {
      checkLocalOrigin(request);
      return json(response, 200, { agentSettings: saveAgentSettings(await bodyJson(request)) });
    }
    if (request.method === 'GET' && url.pathname === '/api/codex/models') {
      return json(response, 200, await getCodexModels());
    }
    if (request.method === 'POST' && url.pathname === '/api/connections/perplexity') {
      checkLocalOrigin(request);
      const { apiKey } = await bodyJson(request);
      await savePerplexityKey(apiKey);
      setSessionPerplexityKey(apiKey);
      index.refresh();
      return json(response, 200, { connections: refreshConnections(providers) });
    }
    if (request.method === 'DELETE' && url.pathname === '/api/connections/perplexity') {
      checkLocalOrigin(request);
      await forgetPerplexityKey();
      clearSessionPerplexityKey();
      return json(response, 200, { connections: refreshConnections(providers) });
    }
    if (request.method === 'GET' && url.pathname === '/api/usage') {
      return json(response, 200, { usage: await getUsageStatus(providers) });
    }
    if (request.method === 'GET' && url.pathname === '/api/file') {
      const absolute = safeFilePath(url.searchParams.get('path'));
      const stat = fs.statSync(absolute);
      const ext = path.extname(absolute).toLowerCase();
      const [mime = 'application/octet-stream', kind = 'file'] = fileTypes[ext] || [];
      const content = kind === 'text' && stat.size <= 2_000_000 ? fs.readFileSync(absolute, 'utf8') : null;
      return json(response, 200, { path: absolute, name: path.basename(absolute), extension: ext, mime, kind, size: stat.size, content, rawUrl: `/api/file/raw?path=${encodeURIComponent(absolute)}` });
    }
    if (request.method === 'GET' && url.pathname === '/api/file/raw') {
      const absolute = safeFilePath(url.searchParams.get('path'));
      const ext = path.extname(absolute).toLowerCase();
      const [mime = 'application/octet-stream'] = fileTypes[ext] || [];
      response.writeHead(200, { 'Content-Type': mime, 'Content-Length': fs.statSync(absolute).size, 'Content-Disposition': `inline; filename="${path.basename(absolute).replaceAll('"', '')}"`, 'Cache-Control': 'no-store' });
      fs.createReadStream(absolute).pipe(response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/commands') {
      const run = directExecutor.create(await bodyJson(request));
      return json(response, 201, run);
    }
    if (request.method === 'GET' && url.pathname === '/api/runs') {
      return json(response, 200, { runs: runsWithEvents() });
    }
    if (request.method === 'GET' && segments[0] === 'api' && segments[1] === 'runs' && segments[2] && segments.length === 3) {
      return json(response, 200, { run: runStore.get(segments[2]), events: runStore.events(segments[2]) });
    }
    if (request.method === 'POST' && segments[0] === 'api' && segments[1] === 'runs' && segments[2] && segments[3] === 'corrections') {
      const run = runStore.get(segments[2]);
      if (!run.finalOutput) throw new Error('This task has no output to correct yet.');
      const correction = saveCorrection(index, run, await bodyJson(request));
      runStore.update(run.id, current => ({ ...current, corrections: [...(current.corrections || []), correction] }));
      runStore.event(run.id, 'memory.corrected', { path: correction.path, category: correction.category, appliesTo: correction.appliesTo });
      return json(response, 201, correction);
    }
    if (request.method === 'POST' && url.pathname === '/api/runs') {
      const run = agentOS.createRun(await bodyJson(request));
      return json(response, 201, run);
    }
    if (request.method === 'POST' && segments[0] === 'api' && segments[1] === 'runs' && segments[2] && segments[3] === 'approve-plan') {
      const body = await bodyJson(request);
      return json(response, 200, agentOS.approvePlan(segments[2], body.planHash));
    }
    if (request.method === 'POST' && segments[0] === 'api' && segments[1] === 'runs' && segments[2] && segments[3] === 'reject-plan') {
      return json(response, 200, agentOS.rejectPlan(segments[2]));
    }
    if (request.method === 'POST' && segments[0] === 'api' && segments[1] === 'runs' && segments[2] && segments[3] === 'approve-output') {
      const body = await bodyJson(request);
      return json(response, 200, agentOS.approveOutput(segments[2], body.outputHash));
    }
    if (request.method === 'POST' && segments[0] === 'api' && segments[1] === 'runs' && segments[2] && segments[3] === 'reject-output') {
      return json(response, 200, agentOS.rejectOutput(segments[2]));
    }
    if (request.method === 'POST' && segments[0] === 'api' && segments[1] === 'runs' && segments[2] && segments[3] === 'retry') {
      const run = runStore.get(segments[2]);
      return json(response, 200, run.mode === 'direct' ? directExecutor.retry(segments[2]) : agentOS.retry(segments[2]));
    }
    if (request.method === 'POST' && segments[0] === 'api' && segments[1] === 'runs' && segments[2] && segments[3] === 'approve-execution') {
      return json(response, 200, directExecutor.approve(segments[2]));
    }
    if (request.method === 'POST' && segments[0] === 'api' && segments[1] === 'runs' && segments[2] && segments[3] === 'reject-execution') {
      return json(response, 200, directExecutor.reject(segments[2]));
    }
    if (request.method === 'GET' && url.pathname === '/api/search') {
      const results = index.search({
        query: url.searchParams.get('q') || '',
        category: url.searchParams.get('category') || '',
        project: url.searchParams.get('project') || '',
        limit: url.searchParams.get('limit') || 50
      }).map(noteSummary);
      return json(response, 200, { results, total: results.length });
    }
    if (request.method === 'POST' && url.pathname === '/api/context-preview') {
      checkLocalOrigin(request);
      const input = await bodyJson(request);
      if (input.knowledgeMode === 'off') return json(response, 200, { sources: [], characters: 0 });
      const context = buildContextPacket(index, { goal: String(input.command || '').slice(0, 20000), categories: Array.isArray(input.categories) ? input.categories : [], includePrivate: input.includePrivate !== false });
      return json(response, 200, { sources: context.sources, characters: context.characters });
    }
    if (request.method === 'GET' && url.pathname === '/api/note') {
      const note = index.read(url.searchParams.get('path') || '');
      return json(response, 200, fullNote(note));
    }
    if (request.method === 'POST' && url.pathname === '/api/refresh') {
      return json(response, 200, index.refresh());
    }
    if (request.method === 'GET' && url.pathname === '/api/proposals') {
      return json(response, 200, { proposals: listProposals(url.searchParams.get('status') || '') });
    }
    if (request.method === 'POST' && url.pathname === '/api/proposals') {
      const proposal = createProposal(await bodyJson(request));
      return json(response, 201, proposal);
    }
    if (request.method === 'POST' && segments[0] === 'api' && segments[1] === 'proposals' && segments[2] && segments[3] === 'approve') {
      const proposal = approveProposal(segments[2]);
      index.refresh();
      return json(response, 200, proposal);
    }
    if (request.method === 'POST' && segments[0] === 'api' && segments[1] === 'proposals' && segments[2] && segments[3] === 'reject') {
      return json(response, 200, rejectProposal(segments[2]));
    }
    if (request.method === 'GET' && url.pathname === '/api/activity') {
      return json(response, 200, { activity: listActivity(url.searchParams.get('limit') || 40) });
    }
    if (request.method === 'GET' && staticFile(url.pathname, response)) return;
    json(response, 404, { error: 'Not found.' });
  } catch (error) {
    json(response, 400, { error: error.message || 'Request failed.' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`${DISPLAY_NAME} is running at http://${HOST}:${server.address().port}`);
  console.log(`Indexed ${index.notes.length} notes from ${VAULT_PATH}`);
});

export { server };
