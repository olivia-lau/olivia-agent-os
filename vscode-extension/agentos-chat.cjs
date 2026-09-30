const PARTICIPANT_ID = 'olivia-agent-switch.agentos';
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'rejected', 'cancelled']);

function requestedProvider(command) {
  return ['codex', 'claude'].includes(command) ? command : 'auto';
}

function sessionFromHistory(history = []) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    const metadata = item?.result?.metadata || item?.metadata;
    if (metadata?.agentOsThreadId && metadata?.agentOsProjectId) {
      return { threadId: metadata.agentOsThreadId, projectId: metadata.agentOsProjectId };
    }
  }
  return null;
}

function projectTitle(prompt) {
  const title = String(prompt || '').replace(/\s+/g, ' ').trim();
  return (title || 'VS Code chat').slice(0, 72);
}

function isTerminal(status) {
  return TERMINAL_STATUSES.has(status);
}

function progressLabel(event) {
  const data = event?.data || {};
  if (event?.type === 'router.selected') return `Agent OS selected ${data.provider || 'an agent'}.`;
  if (event?.type === 'execution.started') return `Started ${data.provider || 'agent'} CLI execution.`;
  if (event?.type === 'execution.handoff') return `Agent handoff: ${data.from || 'current agent'} → ${data.to || 'backup agent'}.`;
  if (event?.type === 'execution.progress') {
    const activity = data.activity;
    if (typeof activity === 'string' && activity.trim()) return activity.trim().slice(0, 280);
    if (activity?.message) return String(activity.message).slice(0, 280);
    if (data.message) return String(data.message).slice(0, 280);
  }
  if (event?.type === 'execution.completed') return 'Agent finished; collecting the result.';
  return '';
}

module.exports = { PARTICIPANT_ID, requestedProvider, sessionFromHistory, projectTitle, isTerminal, progressLabel };
