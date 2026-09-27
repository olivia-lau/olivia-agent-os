const state = { overview: null, query: '', category: '', previewTabs: [], activePreview: '', dismissedHandoff: sessionStorage.getItem('dismissedHandoff') || '' };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 2500);
}

function renderUsage(usage = {}) {
  for (const [provider, value] of Object.entries(usage)) {
    const meter = document.querySelector(`.usage-meter[data-usage="${provider}"]`);
    if (!meter) continue;
    const known = value?.state === 'known' && Number.isFinite(value.remainingPercent);
    const remaining = known ? Math.max(0, Math.min(100, value.remainingPercent)) : 0;
    meter.classList.toggle('unknown', !known);
    meter.classList.toggle('low', known && remaining <= 25);
    meter.classList.toggle('critical', known && remaining <= 10);
    meter.querySelector('strong').textContent = value?.label || 'Usage unavailable';
    meter.querySelector('small').textContent = value?.detail || '';
    meter.querySelector('i').style.width = known ? `${remaining}%` : '0';
    meter.title = value?.detail || 'Remaining usage is not available';
  }
}

function renderConnections(connections = {}) {
  for (const [id, provider] of Object.entries(connections)) {
    const card = document.querySelector(`[data-connection="${id}"]`);
    if (!card) continue;
    const status = card.querySelector('.connection-status');
    status.textContent = provider.ready ? 'Connected' : provider.loginState === 'opening' ? 'Opening sign-in…' : provider.loginState === 'prompt-opened' ? 'Finish in sign-in window' : provider.loginState === 'failed' ? 'Sign-in needs attention' : provider.installed ? 'Not connected' : 'CLI not found';
    status.classList.toggle('connected', Boolean(provider.ready));
    const login = card.querySelector('[data-login]');
    if (login) {
      login.textContent = provider.ready ? 'Already connected' : !provider.installed ? 'Install CLI first' : provider.loginState === 'opening' ? 'Opening…' : provider.loginState === 'prompt-opened' ? 'Open sign-in again' : `Sign in to ${id === 'codex' ? 'Codex' : 'Claude'}`;
      login.disabled = provider.ready || !provider.installed || provider.loginState === 'opening';
    }
  }
  $('#forgetPerplexity').hidden = connections.perplexity?.credentialSource !== 'vault-encrypted';
}

function renderOverview() {
  const { stats, categories, proposals, activity, runs, system, providers, connections, usage, executionRoot } = state.overview;
  const displayName = state.overview.displayName || 'Agent OS';
  document.title = displayName;
  $('#brandName').textContent = displayName;
  $('#githubBackend').hidden = state.overview.backend?.type !== 'github';
  if (state.overview.backend?.type === 'github') $('#githubBackendStatus').textContent = `${state.overview.backend.repoId} · Checking local clone…`;
  $('#handoffSimulationOption').hidden = !state.overview.simulationEnabled;
  $('#stats').innerHTML = [
    [stats.notes.toLocaleString(), 'Markdown notes'],
    [stats.categories, 'Knowledge categories'],
    [stats.projects, 'Projects'],
    [stats.words.toLocaleString(), 'Indexed words']
  ].map(([value, label]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join('');
  $('#pendingBadge').textContent = proposals.filter(item => item.status === 'pending').length;
  $('#runBadge').textContent = runs.filter(item => !['completed', 'rejected'].includes(item.status)).length;
  const options = categories.map(category => `<option value="${escapeHtml(category.name)}">${escapeHtml(category.name)} (${category.noteCount})</option>`).join('');
  $('#categoryFilter').innerHTML = `<option value="">All categories</option>${options}`;
  $('#proposalCategory').innerHTML = options;
  if (!$('#commandCategories').options.length) $('#commandCategories').innerHTML = options;
  if (!$('#commandOutputCategory').options.length) $('#commandOutputCategory').innerHTML = options;
  if (!$('#commandWorkspace').value) $('#commandWorkspace').value = executionRoot || '';
  for (const provider of Object.values(providers || {})) {
    const form = document.querySelector(`.agent-form[data-provider="${provider.id}"]`);
    if (!form) continue;
    form.classList.toggle('unavailable', !provider.ready);
    $(`#${provider.id}Availability`).textContent = provider.ready ? 'Ready' : provider.id === 'claude' ? 'Sign in required' : 'API key required';
    form.querySelector('button[type="submit"]').disabled = !provider.ready;
  }
  renderUsage(usage);
  renderConnections(connections);
  $('#categoryList').innerHTML = `<button class="category-button active" data-category="">Everything <span>${stats.notes}</span></button>` + categories.map(category =>
    `<button class="category-button" data-category="${escapeHtml(category.name)}">${escapeHtml(category.name)} <span>${category.noteCount}</span></button>`
  ).join('');
  renderProposals(proposals);
  renderActivity(activity);
  renderSystem(system);
  renderRuns(runs);
  renderHandoffBanner(runs);
  renderSidebarRuns(runs);
  search();
}

function providerName(id) {
  return ({ codex: 'Codex', claude: 'Claude Code', perplexity: 'Perplexity' })[id] || id || 'Agent';
}

function handoffMessage(item) {
  const reason = (item.reason || '').replaceAll('_', ' ');
  return `${providerName(item.from)} → ${providerName(item.to)}${reason ? ` · ${reason}` : ''}${item.simulated ? ' · simulation' : ''}`;
}

function renderHandoffBanner(runs) {
  const run = runs.find(candidate => candidate.handoffs?.length);
  const banner = $('#handoffBanner');
  if (!run) { banner.hidden = true; return; }
  const handoff = run.handoffs.at(-1);
  const key = `${run.id}:${run.handoffs.length}`;
  if (state.dismissedHandoff === key) { banner.hidden = true; return; }
  const moving = ['handing_off', 'queued', 'running', 'retrying'].includes(run.status);
  banner.classList.toggle('in-progress', moving);
  banner.innerHTML = `<span class="handoff-banner-icon" aria-hidden="true">⇄</span><div><strong>${moving ? 'Switching agents — task is continuing' : 'Agent handoff recorded'}</strong><span>${escapeHtml(handoffMessage(handoff))}</span></div><button type="button" data-view-handoff="${escapeHtml(run.id)}">View task</button><button type="button" data-dismiss-handoff="${escapeHtml(key)}" aria-label="Dismiss handoff banner">×</button>`;
  banner.hidden = false;
}

$('#handoffBanner').addEventListener('click', event => {
  const dismiss = event.target.closest('[data-dismiss-handoff]');
  if (dismiss) {
    state.dismissedHandoff = dismiss.dataset.dismissHandoff;
    sessionStorage.setItem('dismissedHandoff', state.dismissedHandoff);
    $('#handoffBanner').hidden = true;
    return;
  }
  const view = event.target.closest('[data-view-handoff]');
  if (view) {
    document.querySelector('[data-view="mission"]')?.click();
    document.getElementById(`run-${view.dataset.viewHandoff}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

function renderSidebarRuns(runs) {
  $('#sidebarRuns').innerHTML = runs.slice(0, 12).map(run => `<button class="sidebar-run" data-sidebar-run="${escapeHtml(run.id)}" title="${escapeHtml(run.title)}">${escapeHtml(run.title)}</button>`).join('') || '<span class="muted">No tasks yet</span>';
}

function renderSystem(services) {
  $('#systemStatus').innerHTML = services.map(service => `
    <div class="system-item ${escapeHtml(service.status)}"><i></i><div><strong>${escapeHtml(service.name)}</strong><span>${escapeHtml(service.detail)}</span></div></div>
  `).join('');
}

function statusLabel(status) {
  return {
    awaiting_plan_approval: 'Plan review',
    awaiting_output_approval: 'Output review',
    awaiting_execution_approval: 'Confirmation needed',
    context_changed: 'Context changed',
    handing_off: 'Handing off', queued: 'Queued', running: 'Running', retrying: 'Retrying', completed: 'Completed', failed: 'Failed', rejected: 'Rejected'
  }[status] || status;
}

function activityText(event) {
  const raw = event.data?.text || event.data?.excerpt || event.data?.kind || 'Working';
  if (typeof raw !== 'string') return 'Working';
  try {
    const value = JSON.parse(raw);
    const item = value.item || {};
    if (item.type === 'command_execution') return `Terminal: ${String(item.command || 'command').slice(-220)}`;
    return String(item.text || value.message?.content || item.type || value.type || 'Working').slice(0, 600);
  } catch { return raw.slice(0, 600); }
}

function renderRuns(runs) {
  $('#runs').innerHTML = runs.length ? runs.map(run => {
    const tasks = (run.tasks || []).map(task => `
      <div class="task ${escapeHtml(task.status)}"><span>${escapeHtml(task.assignee)}</span><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(task.status.replaceAll('_', ' '))}${task.durationMs ? ` · ${(task.durationMs / 1000).toFixed(1)}s` : ''}</span></div>
    `).join('');
    const sources = (run.context?.sources || []).map(source => `
      <div class="source-row"><strong>${escapeHtml(source.id)} · ${escapeHtml(source.title)}</strong><span>${escapeHtml(source.path)}</span></div>
    `).join('') || '<div class="source-row"><span>No matching vault sources were included.</span></div>';
    const checks = (run.verification?.checks || []).map(check => `<div class="check ${check.pass ? 'pass' : 'fail'}">${escapeHtml(check.label)} — ${escapeHtml(check.detail)}</div>`).join('');
    const events = (run.events || []).slice(-6).reverse().map(event => `<div class="event-line"><time>${escapeHtml(new Date(event.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</time><span>${escapeHtml(event.type.replaceAll('.', ' · ').replaceAll('_', ' '))}</span></div>`).join('') || '<p class="muted">No run events yet.</p>';
    const liveEvents = (run.events || []).filter(event => event.type === 'execution.progress' && !(event.data?.stream === 'stderr' && /\bwarn\b/i.test(event.data?.excerpt || ''))).slice(run.status === 'running' ? -20 : -6).reverse().map(event => `<div class="live-activity-line"><time>${escapeHtml(new Date(event.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</time><span>${escapeHtml(activityText(event))}</span></div>`).join('');
    const files = (run.files || []).map(file => `<button class="file-link" data-file-path="${escapeHtml(file.path)}" title="${escapeHtml(file.path)}"><span>${file.kind === 'image' ? '▧' : file.kind === 'pdf' ? 'PDF' : '↗'}</span>${escapeHtml(file.name)}</button>`).join('');
    const handoffs = (run.handoffs || []).map(item => `<div class="handoff">${escapeHtml(handoffMessage(item))}</div>`).join('');
    const latestHandoff = run.handoffs?.at(-1);
    const handoffCallout = latestHandoff ? `<div class="handoff-callout"><span aria-hidden="true">⇄</span><div><strong>${run.status === 'handing_off' ? 'Agent switch in progress' : 'Agent switched during this task'}</strong><p>${escapeHtml(handoffMessage(latestHandoff))}</p></div></div>` : '';
    let actions = '';
    if (run.status === 'awaiting_plan_approval') actions = `<div class="run-actions"><button class="button danger" data-run-action="reject-plan" data-run-id="${run.id}">Reject</button><button class="button" data-run-action="approve-plan" data-run-id="${run.id}" data-hash="${run.planHash}">Approve plan and run agents</button></div>`;
    if (run.status === 'awaiting_output_approval') actions = `<div class="run-actions"><button class="button danger" data-run-action="reject-output" data-run-id="${run.id}">Reject output</button><button class="button" data-run-action="approve-output" data-run-id="${run.id}" data-hash="${run.outputHash}">Approve into Obsidian</button></div>`;
    if (run.status === 'failed') actions = `<div class="run-actions"><button class="button" data-run-action="retry" data-run-id="${run.id}">Retry run</button></div>`;
    if (run.status === 'awaiting_execution_approval') actions = `<div class="run-actions"><button class="button danger" data-run-action="reject-execution" data-run-id="${run.id}">Cancel</button><button class="button" data-run-action="approve-execution" data-run-id="${run.id}">Confirm and execute</button></div>`;
    const outputTitle = run.mode === 'direct' ? 'Result' : 'Proposed output';
    const verification = run.verification ? `<div class="verification"><strong>Verification · ${run.verification?.pass ? 'passed' : 'needs attention'} · reviewer ${escapeHtml(run.reviewerVerdict || 'unknown')}</strong>${checks}</div>` : '';
    const output = run.finalOutput ? `<h4>${outputTitle}</h4><div class="output-preview">${escapeHtml(run.finalOutput)}</div>${verification}` : '';
    const route = run.provider ? `<span class="provider-route">${escapeHtml(run.provider)} · ${escapeHtml(run.taskType || 'general')}</span><p class="muted">${escapeHtml(run.providerReason || '')}</p>${handoffs ? `<div class="handoff-list">${handoffs}</div>` : ''}` : '';
    return `<article class="run-card" id="run-${escapeHtml(run.id)}">
      <header class="run-header"><div><p class="eyebrow">${escapeHtml(formatDate(run.createdAt))}</p><h3>${escapeHtml(run.title)}</h3><p class="muted">${escapeHtml(run.goal)}</p>${route}</div><span class="run-status ${escapeHtml(run.status)}">${escapeHtml(statusLabel(run.status))}</span></header>
      <div class="run-body">
        ${handoffCallout}
        ${run.error ? `<p class="run-error">${escapeHtml(run.error)}</p>` : ''}
        <div class="task-graph">${tasks}</div>
        ${liveEvents ? `<h4>Live agent activity</h4><div class="live-activity">${liveEvents}</div>` : run.status === 'running' ? '<p class="muted">Agent started. Waiting for its first activity event…</p>' : ''}
        <div class="run-grid"><div class="run-main">${output || '<p class="muted">The executor’s result will appear here.</p>'}${files ? `<h4>Files</h4><div class="file-links">${files}</div>` : ''}</div><div class="run-side"><h4>${run.context ? 'Selected knowledge context' : 'Obsidian context'}</h4><p class="muted">${run.context ? `${run.context?.sources?.length || 0} sources · ${run.context?.characters || 0} characters · ${run.includePrivate ? 'private notes allowed' : 'private notes excluded'}` : 'Not used for this command.'}</p>${run.context ? `<div class="source-list">${sources}</div>` : ''}<h4>Recent run events</h4><div class="event-list">${events}</div></div></div>
        ${run.memoryPath ? `<button class="memory-link" data-file-path="${escapeHtml(run.memoryPath)}">Open Obsidian record ↗</button>` : run.memoryError ? `<p class="run-error">Obsidian record failed: ${escapeHtml(run.memoryError)}</p>` : ''}
        ${(run.corrections || []).map(correction => `<button class="memory-link" data-file-path="${escapeHtml(correction.path)}">View saved correction ↗</button>`).join('')}
        ${run.finalOutput ? `<button class="button ghost" data-correct-run="${escapeHtml(run.id)}">Correct output · teach future agents</button>` : ''}
        ${run.destination ? `<p class="muted">Saved to ${escapeHtml(run.destination)}</p>` : ''}
        ${actions}
      </div>
    </article>`;
  }).join('') : '<div class="empty">No tasks yet. Use the composer below to start one.</div>';
}

async function search() {
  const params = new URLSearchParams({ q: state.query, category: state.category, limit: '60' });
  const { results } = await api(`/api/search?${params}`);
  $('#resultKicker').textContent = state.query ? 'Search results' : 'Recently updated';
  $('#resultTitle').textContent = state.category || (state.query ? `“${state.query}”` : 'Your knowledge');
  $('#resultCount').textContent = `${results.length} shown`;
  $('#results').innerHTML = results.length ? results.map(note => `
    <button class="note-card" data-path="${escapeHtml(note.path)}">
      <div>
        <span class="tag">${escapeHtml(note.project || note.category)}</span>
        <h4>${escapeHtml(note.title)}</h4>
        <p>${escapeHtml(note.excerpt)}</p>
      </div>
      <div class="meta">${escapeHtml(note.type)}<br>${escapeHtml(formatDate(note.modifiedAt))}</div>
    </button>`).join('') : '<div class="empty">No notes matched this search.</div>';
}

async function openNote(path) {
  const note = await api(`/api/note?path=${encodeURIComponent(path)}`);
  openPreview({ id: `note:${path}`, name: note.title, path: note.path, kind: 'text', content: note.markdown, mime: 'text/markdown' });
}

function openPreview(file) {
  const existing = state.previewTabs.find(item => item.id === file.id);
  if (!existing) state.previewTabs.push(file);
  else Object.assign(existing, file);
  state.activePreview = file.id;
  document.body.classList.add('preview-open');
  renderPreview();
}

async function openFilePreview(path) {
  try {
    const file = await api(`/api/file?path=${encodeURIComponent(path)}`);
    openPreview({ ...file, id: `file:${file.path}` });
  } catch (error) { toast(error.message); }
}

function renderPreview() {
  $('#previewTabs').innerHTML = state.previewTabs.map(tab => `<button class="preview-tab ${tab.id === state.activePreview ? 'active' : ''}" data-preview-id="${escapeHtml(tab.id)}" title="${escapeHtml(tab.path)}">${escapeHtml(tab.name)} <span class="preview-tab-close" data-preview-close="${escapeHtml(tab.id)}">×</span></button>`).join('');
  const active = state.previewTabs.find(tab => tab.id === state.activePreview);
  if (!active) {
    $('#previewBody').innerHTML = '<div class="preview-empty"><strong>No file selected</strong><span>Open a file from a task to preview it here.</span></div>';
    return;
  }
  const header = `<div class="file-preview-header"><strong>${escapeHtml(active.name)}</strong><span>${escapeHtml(active.path)}</span></div>`;
  if (active.kind === 'image') $('#previewBody').innerHTML = `${header}<img class="preview-image" src="${escapeHtml(active.rawUrl)}" alt="${escapeHtml(active.name)}">`;
  else if (active.kind === 'pdf') $('#previewBody').innerHTML = `${header}<iframe class="preview-frame" src="${escapeHtml(active.rawUrl)}" title="${escapeHtml(active.name)}"></iframe>`;
  else if (active.kind === 'text') $('#previewBody').innerHTML = `${header}<pre class="preview-text">${escapeHtml(active.content || 'This text file is too large to preview.')}</pre>`;
  else $('#previewBody').innerHTML = `${header}<div class="preview-empty"><strong>Preview unavailable</strong><a class="file-link" href="${escapeHtml(active.rawUrl)}" target="_blank" rel="noopener">Open file</a></div>`;
}

function renderProposals(proposals) {
  $('#proposals').innerHTML = proposals.length ? proposals.map(item => `
    <article class="proposal">
      <header><div><span class="tag">${escapeHtml(item.category)}</span><h3>${escapeHtml(item.title)}</h3><p class="muted">${escapeHtml(item.reason || 'No reason provided')} · ${formatDate(item.createdAt)}</p></div><span class="tag">${escapeHtml(item.status)}</span></header>
      <pre>${escapeHtml(item.content)}</pre>
      ${item.status === 'pending' && String(item.reason).startsWith('Agent OS run ') ? '<p class="muted">Review this governed output in Mission Control so its run record stays synchronized.</p>' : item.status === 'pending' ? `<div class="proposal-actions"><button class="button danger" data-reject="${item.id}">Reject</button><button class="button" data-approve="${item.id}">Approve into Obsidian</button></div>` : item.notePath ? `<p class="muted">Saved to ${escapeHtml(item.notePath)}</p>` : ''}
    </article>`).join('') : '<div class="empty">No proposals yet. Agent suggestions will wait here for your review.</div>';
}

function renderActivity(activity) {
  const names = { 'proposal.created': 'Proposal submitted', 'proposal.approved': 'Proposal approved into Obsidian', 'proposal.rejected': 'Proposal rejected' };
  $('#activity').innerHTML = activity.length ? activity.map(item => `
    <div class="activity-row"><time>${formatDate(item.at)}</time><p><strong>${escapeHtml(names[item.action] || item.action)}</strong>${item.title ? ` — ${escapeHtml(item.title)}` : ''}</p></div>`
  ).join('') : '<div class="empty">Activity will appear here as proposals are reviewed.</div>';
}

async function reloadOverview() {
  state.overview = await api('/api/overview');
  renderOverview();
  if (state.overview.backend?.type === 'github') await refreshGithubStatus();
}

async function refreshGithubStatus() {
  try {
    const backend = await api('/api/backend');
    $('#githubBackendStatus').textContent = `${backend.repoId} · ${backend.branch} · ${backend.localChanges} local change${backend.localChanges === 1 ? '' : 's'}`;
  } catch (error) { $('#githubBackendStatus').textContent = `GitHub needs attention: ${error.message}`; }
}

for (const [id, endpoint] of [['pullGithub', 'pull'], ['publishGithub', 'publish']]) {
  $(`#${id}`).addEventListener('click', async () => {
    const button = $(`#${id}`);
    button.disabled = true;
    try {
      const result = await api(`/api/backend/${endpoint}`, { method: 'POST' });
      if (endpoint === 'pull') await reloadOverview();
      else await refreshGithubStatus();
      toast(result.message);
    } catch (error) { toast(error.message); $('#githubBackendStatus').textContent = `Sync paused: ${error.message}`; }
    finally { button.disabled = false; }
  });
}

function commonCommandOptions() {
  return { workspace: $('#commandWorkspace').value, knowledgeMode: $('#knowledgeMode').value, memoryMode: $('#memoryMode').value,
    categories: [...$('#commandCategories').selectedOptions].map(option => option.value),
    includePrivate: $('#commandPrivate').checked, outputCategory: $('#commandOutputCategory').value,
    simulateHandoff: $('#simulateHandoff').checked };
}

$$('.agent-form').forEach(form => {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const input = form.querySelector('textarea');
    const command = input.value.trim();
    if (!command) return toast('Enter a prompt first');
    try {
      await api('/api/commands', { method: 'POST', body: JSON.stringify({ command, provider: form.dataset.provider, ...commonCommandOptions() }) });
      input.value = '';
      await reloadOverview();
      toast(`${form.dataset.provider} started`);
    } catch (error) { toast(error.message); }
  });
  form.querySelector('textarea').addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); form.requestSubmit(); }
  });
});

$('#connectionsPanel').addEventListener('click', async event => {
  const button = event.target.closest('[data-login]');
  if (!button) return;
  button.disabled = true;
  try {
    const result = await api('/api/connections/login', { method: 'POST', body: JSON.stringify({ provider: button.dataset.login }) });
    $('#connectionMessage').textContent = result.message || 'Follow the sign-in instructions, then choose Refresh status.';
    await reloadOverview();
  } catch (error) { toast(error.message); button.disabled = false; }
});

$('#perplexityConnectionForm').addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('#perplexityApiKey');
  try {
    await api('/api/connections/perplexity', { method: 'POST', body: JSON.stringify({ apiKey: input.value }) });
    input.value = '';
    $('#connectionMessage').textContent = 'Perplexity key saved encrypted in Obsidian; it will be checked on the first request.';
    await reloadOverview();
    toast('Perplexity key saved encrypted in Obsidian');
  } catch (error) { toast(error.message); }
});

$('#forgetPerplexity').addEventListener('click', async () => {
  try {
    await api('/api/connections/perplexity', { method: 'DELETE' });
    await reloadOverview();
    toast('Saved Perplexity key removed');
  } catch (error) { toast(error.message); }
});

$('#refreshConnections').addEventListener('click', async () => {
  const button = $('#refreshConnections');
  button.disabled = true;
  try {
    await api('/api/connections/refresh', { method: 'POST' });
    await reloadOverview();
    toast('Connection status refreshed');
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});

$('#multiAgentForm').addEventListener('submit', async event => {
  event.preventDefault();
  const goal = $('#multiAgentText').value.trim();
  if (!goal) return toast('Enter a team task first');
  try {
    const options = commonCommandOptions();
    await api('/api/runs', { method: 'POST', body: JSON.stringify({ title: goal.split(/\r?\n/)[0].slice(0, 180), goal, ...options }) });
    $('#multiAgentText').value = '';
    await reloadOverview();
    toast('Team plan ready to review');
  } catch (error) { toast(error.message); }
});

$('#runs').addEventListener('click', async event => {
  const file = event.target.closest('[data-file-path]');
  if (file) return openFilePreview(file.dataset.filePath);
  const correct = event.target.closest('[data-correct-run]');
  if (correct) {
    const run = state.overview.runs.find(item => item.id === correct.dataset.correctRun);
    if (!run) return;
    $('#correctionRunId').value = run.id;
    $('#correctionWrong').value = '';
    $('#correctionGuidance').value = '';
    $('#correctionAppliesTo').value = run.command || run.goal || run.title;
    $('#correctionCategory').innerHTML = `<option value="All categories">All categories</option>` + state.overview.categories.map(category => `<option value="${escapeHtml(category.name)}">${escapeHtml(category.name)}</option>`).join('');
    $('#correctionCategory').value = run.outputCategory || 'Personal Generic';
    $('#correctionDialog').showModal();
    $('#correctionWrong').focus();
    return;
  }
  const button = event.target.closest('[data-run-action]');
  if (!button) return;
  const action = button.dataset.runAction;
  const body = action === 'approve-plan' ? { planHash: button.dataset.hash } : action === 'approve-output' ? { outputHash: button.dataset.hash } : {};
  button.disabled = true;
  try {
    await api(`/api/runs/${button.dataset.runId}/${action}`, { method: 'POST', body: JSON.stringify(body) });
    await reloadOverview();
    toast(action.includes('approve') ? 'Approval recorded' : action === 'retry' ? 'Run queued again' : 'Rejected');
  } catch (error) { toast(error.message); button.disabled = false; }
});

$('#closeCorrection').addEventListener('click', () => $('#correctionDialog').close());
$('#cancelCorrection').addEventListener('click', () => $('#correctionDialog').close());
$('#correctionForm').addEventListener('submit', async event => {
  event.preventDefault();
  const id = $('#correctionRunId').value;
  const body = { wrong: $('#correctionWrong').value, guidance: $('#correctionGuidance').value,
    appliesTo: $('#correctionAppliesTo').value, category: $('#correctionCategory').value };
  try {
    await api(`/api/runs/${encodeURIComponent(id)}/corrections`, { method: 'POST', body: JSON.stringify(body) });
    $('#correctionDialog').close();
    await reloadOverview();
    toast('Correction saved for future tasks');
  } catch (error) { toast(error.message); }
});

let searchTimer;
$('#searchInput').addEventListener('input', event => {
  state.query = event.target.value.trim();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(search, 180);
});
$('#categoryFilter').addEventListener('change', event => {
  state.category = event.target.value;
  $$('.category-button').forEach(button => button.classList.toggle('active', button.dataset.category === state.category));
  search();
});
$('#categoryList').addEventListener('click', event => {
  const button = event.target.closest('[data-category]');
  if (!button) return;
  state.category = button.dataset.category;
  $('#categoryFilter').value = state.category;
  $$('.category-button').forEach(item => item.classList.toggle('active', item === button));
  search();
});
$('#results').addEventListener('click', event => {
  const card = event.target.closest('[data-path]');
  if (card) openNote(card.dataset.path).catch(error => toast(error.message));
});
$('#closeDialog').addEventListener('click', () => $('#noteDialog').close());
$$('.tab').forEach(tab => tab.addEventListener('click', () => {
  $$('.tab').forEach(item => item.classList.toggle('active', item === tab));
  $$('.view').forEach(view => view.classList.remove('active'));
  $(`#${tab.dataset.view}View`).classList.add('active');
  $('#pageTitle').textContent = { mission: 'Tasks', search: 'Knowledge', review: 'Review', activity: 'Activity' }[tab.dataset.view] || 'Olivia OS';
}));
$('.new-task').addEventListener('click', () => {
  $('.tab[data-view="mission"]').click();
  $('.agent-form[data-provider="codex"] textarea').focus();
});
$('#sidebarRuns').addEventListener('click', event => {
  const button = event.target.closest('[data-sidebar-run]');
  if (!button) return;
  $('.tab[data-view="mission"]').click();
  document.querySelector(`#run-${CSS.escape(button.dataset.sidebarRun)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('#togglePreview').addEventListener('click', () => {
  document.body.classList.toggle('preview-open');
  renderPreview();
});
$('#closePreview').addEventListener('click', () => document.body.classList.remove('preview-open'));
$('#previewTabs').addEventListener('click', event => {
  const close = event.target.closest('[data-preview-close]');
  if (close) {
    event.stopPropagation();
    const index = state.previewTabs.findIndex(tab => tab.id === close.dataset.previewClose);
    if (index !== -1) state.previewTabs.splice(index, 1);
    if (state.activePreview === close.dataset.previewClose) state.activePreview = state.previewTabs[Math.max(0, index - 1)]?.id || state.previewTabs[0]?.id || '';
    if (!state.previewTabs.length) document.body.classList.remove('preview-open');
    return renderPreview();
  }
  const tab = event.target.closest('[data-preview-id]');
  if (tab) { state.activePreview = tab.dataset.previewId; renderPreview(); }
});
$('#refreshButton').addEventListener('click', async () => {
  try { await api('/api/refresh', { method: 'POST' }); await reloadOverview(); toast('Vault refreshed'); }
  catch (error) { toast(error.message); }
});
$('#newProposalButton').addEventListener('click', () => $('#proposalForm').classList.remove('hidden'));
$('#cancelProposal').addEventListener('click', () => $('#proposalForm').classList.add('hidden'));
$('#saveProposal').addEventListener('click', async () => {
  try {
    await api('/api/proposals', { method: 'POST', body: JSON.stringify({
      title: $('#proposalTitle').value,
      category: $('#proposalCategory').value,
      content: $('#proposalContent').value,
      reason: $('#proposalReason').value
    }) });
    ['#proposalTitle', '#proposalContent', '#proposalReason'].forEach(selector => $(selector).value = '');
    $('#proposalForm').classList.add('hidden');
    await reloadOverview();
    toast('Proposal added for review');
  } catch (error) { toast(error.message); }
});
$('#proposals').addEventListener('click', async event => {
  const approve = event.target.closest('[data-approve]');
  const reject = event.target.closest('[data-reject]');
  if (!approve && !reject) return;
  try {
    const id = (approve || reject).dataset[approve ? 'approve' : 'reject'];
    await api(`/api/proposals/${id}/${approve ? 'approve' : 'reject'}`, { method: 'POST' });
    await reloadOverview();
    toast(approve ? 'Approved into Obsidian' : 'Proposal rejected');
  } catch (error) { toast(error.message); }
});

setInterval(async () => {
  if (!state.overview) return;
  const activeBefore = state.overview.runs.some(run => ['queued', 'running', 'retrying', 'handing_off'].includes(run.status));
  if (!activeBefore) return;
  try {
    const { runs } = await api('/api/runs');
    const becameReviewable = runs.some(run => run.status === 'awaiting_output_approval') && !state.overview.runs.some(run => run.status === 'awaiting_output_approval');
    state.overview.runs = runs;
    $('#runBadge').textContent = runs.filter(item => !['completed', 'rejected'].includes(item.status)).length;
    renderRuns(runs);
    renderHandoffBanner(runs);
    renderSidebarRuns(runs);
    if (becameReviewable) await reloadOverview();
  } catch {}
}, 1000);

setInterval(async () => {
  try { renderUsage((await api('/api/usage')).usage); } catch {}
}, 60000);

try {
  await api('/api/health');
  $('#health').classList.add('ready');
  $('#health').lastChild.textContent = ' Vault connected';
  await reloadOverview();
} catch (error) {
  $('#health').lastChild.textContent = ' Connection failed';
  toast(error.message);
}
