import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { AGENT_TIMEOUT_MS, EXECUTION_ROOT, MAX_HANDOFFS, RUN_ARTIFACTS_PATH, VAULT_PATH } from './config.mjs';
import { buildContextPacket } from './context-broker.mjs';
import { relevantCorrections } from './corrections.mjs';
import { writeRunRecord } from './memory-writer.mjs';
import { runPerplexity } from './perplexity-executor.mjs';
import { resolveClaudeCommand, resolveCodexCommand } from './codex-command.mjs';
import { requiresExecutionApproval, routeCommand, shouldRemember, shouldUseKnowledge, tokenFailureKind } from './provider-router.mjs';

function bounded(value, max) { return String(value || '').replaceAll('\0', '').trim().slice(0, max); }
function titleFrom(command) { return bounded(command.split(/\r?\n/)[0], 90) || 'Untitled command'; }

function runProcess(command, args, { cwd, input, timeout = AGENT_TIMEOUT_MS, onOutput }) {
  return new Promise(resolve => {
    const env = command === process.execPath && process.versions.electron ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env;
    const child = spawn(command, args, { cwd, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'], env });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    child.stdout.on('data', chunk => { stdout.push(chunk); onOutput?.('stdout', chunk.toString('utf8')); });
    child.stderr.on('data', chunk => { stderr.push(chunk); onOutput?.('stderr', chunk.toString('utf8')); });
    child.on('error', error => { clearTimeout(timer); resolve({ ok: false, code: 1, stdout: '', stderr: error.message, timedOut: false }); });
    child.on('close', code => { clearTimeout(timer); resolve({ ok: code === 0 && !timedOut, code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), timedOut }); });
    child.stdin.end(input);
  });
}

function parseCodexOutput(raw, finalPath) {
  if (fs.existsSync(finalPath)) return fs.readFileSync(finalPath, 'utf8').trim();
  const messages = [];
  for (const line of raw.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      const text = event.item?.text || event.message?.content || event.content;
      if (typeof text === 'string') messages.push(text);
    } catch {}
  }
  return messages.at(-1) || raw.trim();
}

function parseClaudeOutput(raw) {
  for (const line of raw.trim().split(/\r?\n/).reverse()) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'result' && typeof event.result === 'string') return event.result.trim();
    } catch {}
  }
  return raw.trim();
}

function activityLine(provider, line) {
  try {
    const event = JSON.parse(line);
    if (provider === 'codex') {
      const item = event.item || {};
      if (event.type === 'item.started' || event.type === 'item.completed' || event.type === 'item.updated') {
        const summary = item.command || item.text || item.title || item.type || '';
        return { kind: item.type || 'step', phase: event.type, text: String(summary).slice(0, 900) };
      }
      if (event.type === 'turn.started' || event.type === 'turn.completed') return { kind: 'turn', phase: event.type, text: event.type.replace('.', ' ') };
    }
    if (provider === 'claude') {
      if (event.type === 'assistant') {
        const blocks = event.message?.content || [];
        const text = blocks.filter(block => block.type === 'text').map(block => block.text).join(' ');
        const tools = blocks.filter(block => block.type === 'tool_use').map(block => block.name).join(', ');
        return { kind: tools ? 'tool' : 'message', phase: 'assistant', text: (tools || text || 'Working').slice(0, 900) };
      }
      if (event.type === 'result') return { kind: 'result', phase: 'completed', text: String(event.result || 'Completed').slice(0, 900) };
    }
  } catch {}
  return null;
}

function handoffPrompt(run, priorProvider, failure, checkpoint) {
  return `Continue this task from another agent. Do not restart completed work.\n\nORIGINAL COMMAND:\n${run.command}\n\nWORKSPACE:\n${run.workspace}\n\nPREVIOUS PROVIDER:\n${priorProvider}\n\nWHY IT HANDED OFF:\n${failure}\n\nCHECKPOINT:\n${checkpoint || 'No checkpoint was written. Inspect the workspace and continue from its current state.'}\n\nFinish the requested work, verify it, and report exactly what was done.`;
}

export class DirectExecutor {
  constructor({ index, runStore, providers }) {
    this.index = index;
    this.runStore = runStore;
    this.providers = providers;
    this.running = new Set();
  }

  create(input) {
    const command = bounded(input.command, 20000);
    if (!command) throw new Error('Tell the system what you want it to do.');
    const workspace = path.resolve(bounded(input.workspace, 1000) || EXECUTION_ROOT);
    if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) throw new Error('The selected workspace folder does not exist.');
    const requestedProvider = bounded(input.provider, 30) || 'auto';
    const codexModel = bounded(input.codexModel, 100);
    if (codexModel && !/^[a-zA-Z0-9._-]+$/.test(codexModel)) throw new Error('The Codex model name contains unsupported characters.');
    const simulateHandoff = input.simulateHandoff === true;
    if (simulateHandoff && (process.env.OLIVIA_ENABLE_HANDOFF_SIMULATION !== '1' || requestedProvider !== 'codex')) {
      throw new Error('Codex handoff simulation is not enabled.');
    }
    const route = routeCommand(command, this.providers, { requested: requestedProvider, performance: this.runStore.performanceSummary() });
    const knowledgeMode = ['auto', 'on', 'off'].includes(input.knowledgeMode) ? input.knowledgeMode : 'auto';
    const memoryMode = ['auto', 'always', 'never'].includes(input.memoryMode) ? input.memoryMode : 'always';
    const categories = Array.isArray(input.categories) ? input.categories.map(value => bounded(value, 180)).filter(Boolean) : [];
    const useKnowledge = shouldUseKnowledge(command, knowledgeMode);
    const context = useKnowledge ? buildContextPacket(this.index, { goal: command, categories, includePrivate: input.includePrivate !== false }) : null;
    const approvalRequired = requiresExecutionApproval(command);
    const run = this.runStore.create({
      mode: 'direct', title: titleFrom(command), goal: command, command, workspace, requestedProvider, simulateHandoff, codexModel,
      provider: route.provider, providerReason: route.reason, taskType: route.taskType, providerHistory: [],
      knowledgeMode, memoryMode, outputCategory: bounded(input.outputCategory, 180) || 'Personal Generic',
      includePrivate: input.includePrivate !== false, context: context ? { query: context.query, policy: context.policy, sources: context.sources, packetHash: context.packetHash, characters: context.characters } : null,
      status: approvalRequired ? 'awaiting_execution_approval' : 'queued', approvalRequired,
      tasks: [{ id: 'execute', title: 'Execute command', assignee: route.provider, status: 'pending', startedAt: null, completedAt: null, durationMs: null }],
      handoffs: [], finalOutput: null, error: null, startedAt: null, completedAt: null, proposalId: null
    });
    this.runStore.event(run.id, 'router.selected', { provider: route.provider, taskType: route.taskType, reason: route.reason });
    if (!approvalRequired) setTimeout(() => this.execute(run.id).catch(() => {}), 0);
    return run;
  }

  approve(id) {
    const run = this.runStore.get(id);
    if (run.mode !== 'direct' || run.status !== 'awaiting_execution_approval') throw new Error('This command is not awaiting execution approval.');
    const updated = this.runStore.update(id, { ...run, status: 'queued', executionApprovedAt: new Date().toISOString() });
    this.runStore.event(id, 'execution.approved', {});
    setTimeout(() => this.execute(id).catch(() => {}), 0);
    return updated;
  }

  reject(id) {
    const run = this.runStore.get(id);
    if (run.mode !== 'direct' || run.status !== 'awaiting_execution_approval') throw new Error('This command is not awaiting execution approval.');
    this.runStore.event(id, 'execution.rejected', {});
    return this.runStore.update(id, { ...run, status: 'rejected', completedAt: new Date().toISOString() });
  }

  retry(id) {
    const run = this.runStore.get(id);
    if (run.mode !== 'direct' || run.status !== 'failed') throw new Error('Only a failed direct command can be retried here.');
    const prior = run.providerHistory.at(-1);
    const checkpointPath = path.join(RUN_ARTIFACTS_PATH, id, 'handoff.md');
    if (prior?.error === 'provider_limit' && fs.existsSync(checkpointPath) && run.handoffs.length < MAX_HANDOFFS) {
      const next = routeCommand(run.command, this.providers, { requested: 'auto', exclude: [...new Set(run.providerHistory.map(item => item.provider))], performance: this.runStore.performanceSummary() });
      const checkpoint = fs.readFileSync(checkpointPath, 'utf8').slice(0, 30000);
      const handoff = { from: prior.provider, to: next.provider, reason: 'provider_limit', simulated: Boolean(prior.simulated || run.simulateHandoff), at: new Date().toISOString(), checkpointPath };
      const updated = this.runStore.update(id, current => ({ ...current, status: 'handing_off', provider: next.provider, taskType: next.taskType, providerReason: `Continued from ${prior.provider}'s checkpoint after ${handoff.simulated ? 'simulated ' : ''}provider limit.`, error: null, completedAt: null, handoffs: [...current.handoffs, handoff], tasks: current.tasks.map(task => ({ ...task, assignee: next.provider, status: 'pending', startedAt: null, completedAt: null, durationMs: null })) }));
      this.runStore.event(id, 'execution.handoff', handoff);
      setTimeout(() => this.execute(id, { providerOverride: next.provider, handoffPromptText: handoffPrompt(run, prior.provider, 'provider limit', checkpoint) }).catch(() => {}), 0);
      return updated;
    }
    const route = routeCommand(run.command, this.providers, { requested: run.requestedProvider || 'auto', performance: this.runStore.performanceSummary() });
    const updated = this.runStore.update(id, current => ({ ...current, status: 'queued', provider: route.provider, providerReason: route.reason, error: null, completedAt: null, tasks: current.tasks.map(task => ({ ...task, assignee: route.provider, status: 'pending', startedAt: null, completedAt: null, durationMs: null })) }));
    this.runStore.event(id, 'execution.retrying', { provider: route.provider });
    setTimeout(() => this.execute(id).catch(() => {}), 0);
    return updated;
  }

  async execute(id, { providerOverride = '', handoffPromptText = '' } = {}) {
    if (this.running.has(id)) return;
    this.running.add(id);
    try {
      let run = this.runStore.get(id);
      if (!['queued', 'handing_off'].includes(run.status)) return;
      const provider = providerOverride || run.provider;
      const artifactDir = path.join(RUN_ARTIFACTS_PATH, id);
      fs.mkdirSync(artifactDir, { recursive: true });
      const checkpointPath = path.join(artifactDir, 'handoff.md');
      const finalPath = path.join(artifactDir, `final-${run.providerHistory.length + 1}.md`);
      const context = run.context ? buildContextPacket(this.index, { goal: run.command, categories: run.context.policy?.categories || [], includePrivate: run.includePrivate }) : null;
      const corrections = relevantCorrections(this.index, { goal: run.command, category: run.outputCategory });
      const correctionText = corrections.count ? `\n\nPREVIOUS USER CORRECTIONS (apply when relevant; the current user request wins if it conflicts):\n${corrections.packet}` : '';
      const simulationInstructions = run.simulateHandoff && provider === 'codex' && run.handoffs.length === 0
        ? `\n\nCONTROLLED HANDOFF TEST: Complete only phase 1 of this task. Research and analyze the options, then write a substantial checkpoint at ${checkpointPath} with findings, source links, work remaining, and clear instructions for the next agent. Stop after that first milestone; do not write the final deliverable. The dashboard will inject a simulated usage-limit interruption after your turn so another agent can finish.`
        : '';
      const directVaultAccess = Boolean(context && run.includePrivate && !run.context?.policy?.categories?.length);
      const vaultGuidance = context ? `\n\nOBSIDIAN KNOWLEDGE SOURCE: The selected Obsidian vault is at ${VAULT_PATH}. It may be a local clone of a GitHub repository. For requests about stored work, articles, projects, or personal history, search this vault first. ${directVaultAccess ? 'You may read its Markdown files directly when the snippets below are insufficient.' : 'Use only the included snippets; direct vault access is intentionally restricted by the current knowledge settings.'} Do not claim to have searched Google Drive or another connector unless you actually used it. Do not substitute an external connector for the vault without telling the user. If the requested item is absent, say that clearly. The dashboard handles its own Obsidian record after the task.\n\nMATCHING VAULT NOTES:\n${context.packet || '(No notes matched the current request.)'}` : '';
      const prompt = (handoffPromptText ? `${handoffPromptText}${vaultGuidance}` : `Perform the task now. You are the primary executor, not a planner. Work directly in the provided workspace, verify the result, and give a concise final report. Do not send messages, make purchases, publish, or perform destructive actions unless the user's command explicitly requests it. For a long task, keep a short checkpoint at ${checkpointPath} after each meaningful milestone so another agent can continue if this session runs out of context or usage.\n\nUSER COMMAND:\n${run.command}${vaultGuidance}${simulationInstructions}`) + correctionText;
      const started = Date.now();
      run = this.runStore.update(id, current => ({ ...current, status: 'running', provider, startedAt: current.startedAt || new Date().toISOString(), tasks: current.tasks.map(task => ({ ...task, assignee: provider, status: 'in_progress', startedAt: new Date().toISOString() })) }));
      this.runStore.event(id, 'execution.started', { provider, workspace: run.workspace, correctionsApplied: corrections.count });
      let lineBuffer = '';
      const onOutput = (stream, chunk) => {
        if (stream === 'stderr') {
          const excerpt = chunk.trim().slice(-900);
          if (excerpt) this.runStore.event(id, 'execution.progress', { provider, kind: 'diagnostic', text: excerpt });
          return;
        }
        lineBuffer += chunk;
        const lines = lineBuffer.split(/\r?\n/);
        lineBuffer = lines.pop() || '';
        for (const line of lines) {
          const activity = activityLine(provider, line);
          if (activity) this.runStore.event(id, 'execution.progress', { provider, ...activity });
        }
      };
      let result;
      if (provider === 'codex') {
        result = await runProcess(resolveCodexCommand(), ['exec', ...(run.codexModel ? ['-m', run.codexModel] : []), '--skip-git-repo-check', '--approve-for-me', '--color', 'never', '--json', '-C', run.workspace, '--add-dir', artifactDir, ...(directVaultAccess ? ['--add-dir', VAULT_PATH] : []), '-o', finalPath, '-'], { cwd: run.workspace, input: prompt, onOutput });
        result.output = parseCodexOutput(result.stdout, finalPath);
      } else if (provider === 'claude') {
        const claudeCommand = process.platform === 'win32' ? process.execPath : resolveClaudeCommand();
        const claudeArgs = process.platform === 'win32'
          ? [path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'), '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'auto', '--effort', 'medium', '--add-dir', artifactDir, ...(directVaultAccess ? ['--add-dir', VAULT_PATH] : [])]
          : ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'auto', '--effort', 'medium', '--add-dir', artifactDir, ...(directVaultAccess ? ['--add-dir', VAULT_PATH] : [])];
        result = await runProcess(claudeCommand, claudeArgs, { cwd: run.workspace, input: prompt, onOutput });
        result.output = parseClaudeOutput(result.stdout);
      } else {
        const researchPrompt = `Answer this research request using current information. Include sources where available. You cannot edit the local workspace or carry out computer actions; say so if the request requires them.\n\n${handoffPromptText ? `HANDOFF FROM PREVIOUS AGENT (continue its work; verify any claims before relying on them):\n${handoffPromptText}` : `USER REQUEST:\n${run.command}`}${context ? `\n\nRELEVANT PRIVATE CONTEXT (use only if needed):\n${context.packet}` : ''}${correctionText}`;
        result = await runPerplexity(researchPrompt, {
          onProgress: activity => this.runStore.event(id, 'execution.progress', { provider, ...activity })
        });
      }
      if (run.simulateHandoff && provider === 'codex' && run.handoffs.length === 0 && result.ok) {
        if (!fs.existsSync(checkpointPath)) fs.writeFileSync(checkpointPath, result.output || 'Codex completed its first phase. Continue from the original task.', 'utf8');
        result = { ...result, ok: false, stderr: 'Simulated provider usage limit after the Codex checkpoint.' };
        this.runStore.event(id, 'execution.simulated_limit', { provider, checkpointPath });
      }
      const durationMs = Date.now() - started;
      if (!(run.simulateHandoff && provider === 'codex')) {
        this.runStore.performance({ runId: id, worker: provider, taskType: run.taskType, success: result.ok, durationMs });
      }
      if (result.ok) {
        fs.writeFileSync(path.join(artifactDir, 'final.md'), result.output, 'utf8');
        let memoryPath = null;
        let memoryError = null;
        if (shouldRemember(run.command, run.taskType, run.memoryMode)) {
          try {
            memoryPath = writeRunRecord(run, result.output, { vaultPath: this.index.vaultPath }).path;
            this.index.refresh();
          } catch (error) {
            memoryError = error.message;
            this.runStore.event(id, 'memory.failed', { error: memoryError });
          }
        }
        this.runStore.event(id, 'execution.completed', { provider, durationMs, memoryPath });
        return this.runStore.update(id, current => ({ ...current, status: 'completed', finalOutput: result.output, memoryPath, memoryError, providerHistory: [...current.providerHistory, { provider, success: true, durationMs }], tasks: current.tasks.map(task => ({ ...task, assignee: provider, status: 'completed', completedAt: new Date().toISOString(), durationMs })), completedAt: new Date().toISOString() }));
      }
      const failureText = run.simulateHandoff && provider === 'codex' && result.stderr?.startsWith('Simulated provider usage limit')
        ? result.stderr
        : `${result.stderr || ''}\n${result.stdout || ''}`.trim();
      const limitKind = result.timedOut ? 'timeout' : tokenFailureKind(failureText);
      if (limitKind && run.handoffs.length < MAX_HANDOFFS) {
        const exclude = limitKind === 'provider_limit' ? [...new Set([...run.providerHistory.map(item => item.provider), provider])] : [];
        let next;
        try { next = routeCommand(run.command, this.providers, { requested: 'auto', exclude, performance: this.runStore.performanceSummary() }); }
        catch {
          if (limitKind === 'context_limit' || limitKind === 'timeout') next = { provider, reason: 'Start a fresh agent with the saved checkpoint.' };
        }
        if (next) {
          const checkpoint = fs.existsSync(checkpointPath)
            ? fs.readFileSync(checkpointPath, 'utf8').slice(0, 30000)
            : (result.output || parseCodexOutput(result.stdout || '', finalPath) || '').slice(-12000);
          const handoff = { from: provider, to: next.provider, reason: limitKind, simulated: Boolean(run.simulateHandoff && provider === 'codex'), at: new Date().toISOString(), checkpointPath };
          this.runStore.update(id, current => ({ ...current, status: 'handing_off', provider: next.provider, providerReason: `Continued after ${provider} ${handoff.simulated ? 'simulated ' : ''}${limitKind.replaceAll('_', ' ')}.`, handoffs: [...current.handoffs, handoff], providerHistory: [...current.providerHistory, { provider, success: false, durationMs, error: limitKind, simulated: handoff.simulated }] }));
          this.runStore.event(id, 'execution.handoff', handoff);
          this.running.delete(id);
          return this.execute(id, { providerOverride: next.provider, handoffPromptText: handoffPrompt(run, provider, limitKind, checkpoint) });
        }
      }
      this.runStore.event(id, 'execution.failed', { provider, error: failureText.slice(-3000), limitKind });
      return this.runStore.update(id, current => ({ ...current, status: 'failed', error: failureText || 'The executor failed.', providerHistory: [...current.providerHistory, { provider, success: false, durationMs, error: limitKind || 'execution_error', simulated: Boolean(run.simulateHandoff && provider === 'codex') }], tasks: current.tasks.map(task => ({ ...task, status: 'failed', completedAt: new Date().toISOString(), durationMs })), completedAt: new Date().toISOString() }));
    } finally {
      this.running.delete(id);
    }
  }
}
