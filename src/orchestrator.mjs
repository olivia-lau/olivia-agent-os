import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { FileStore, OpenMultiAgent } from '@open-multi-agent/core';
import { APP_ROOT, RUN_ARTIFACTS_PATH } from './config.mjs';
import { buildContextPacket } from './context-broker.mjs';
import { relevantCorrections } from './corrections.mjs';
import { writeRunRecord } from './memory-writer.mjs';
import { approveProposal, createProposal, rejectProposal } from './store.mjs';
import { reviewerVerdict, verifyDeliverable } from './verifier.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(here, 'worker.mjs');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function bounded(value, max) {
  return String(value || '').replaceAll('\0', '').trim().slice(0, max);
}

function safeData(value) {
  try { return JSON.parse(JSON.stringify(value)); }
  catch { return { note: 'Event data could not be serialized.' }; }
}

function agent(role, systemPrompt) {
  return {
    name: role,
    systemPrompt,
    backend: {
      kind: 'process',
      command: process.execPath,
      args: [workerPath, role],
      cwd: APP_ROOT,
      env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {},
      input: 'stdin'
    }
  };
}

function buildPlan() {
  return [
    { id: 'research', title: 'Gather evidence', assignee: 'researcher', dependsOn: [], taskType: 'research' },
    { id: 'analysis', title: 'Analyze independently', assignee: 'analyst', dependsOn: [], taskType: 'analysis' },
    { id: 'synthesis', title: 'Synthesize recommendation', assignee: 'synthesizer', dependsOn: ['Gather evidence', 'Analyze independently'], taskType: 'synthesis' },
    { id: 'review', title: 'Challenge and verify', assignee: 'reviewer', dependsOn: ['Synthesize recommendation'], taskType: 'review' }
  ];
}

function taskDescriptions(run, context) {
  const rules = `\n\nOPERATING RULES:\n- Use only information relevant to the goal.\n- Treat supplied vault content as private. Do not infer facts that are not present.\n- Distinguish evidence, inference, and unknowns.\n- Refer to vault sources by their SOURCE id (for example vault-1).\n- Do not modify files or take external actions.\n${run.correctionPacket ? `\nPREVIOUS USER CORRECTIONS (apply when relevant; the current request wins if it conflicts):\n${run.correctionPacket}\n` : ''}`;
  return [
    {
      title: 'Gather evidence',
      description: `GOAL:\n${run.goal}\n\nReview the supplied vault packet and identify facts, gaps, and useful evidence. If current external research is needed and web access is available, use primary sources and include URLs. Return concise findings with a Sources section.\n\nVAULT PACKET:\n${context.packet}${rules}`,
      assignee: 'researcher'
    },
    {
      title: 'Analyze independently',
      description: `GOAL:\n${run.goal}\n\nIndependently analyze the goal using the supplied context. Identify trade-offs, contradictions, risks, and what would change the recommendation. Do not merely repeat the researcher.\n\nVAULT PACKET:\n${context.packet}${rules}`,
      assignee: 'analyst'
    },
    {
      title: 'Synthesize recommendation',
      description: `GOAL:\n${run.goal}\n\nUse the direct dependency outputs to produce the final decision memo. Required Markdown headings: Summary, Evidence, Analysis, Recommendation, Risks, Sources. Cite relevant supplied vault sources by SOURCE id and retain any valid external URLs. Keep evidence separate from inference.${rules}`,
      assignee: 'synthesizer',
      dependsOn: ['Gather evidence', 'Analyze independently']
    },
    {
      title: 'Challenge and verify',
      description: `Review the synthesized decision memo against the original goal and evidence. Check unsupported claims, missing counterarguments, privacy leakage, and whether the recommendation follows from the evidence. Return headings Summary, Evidence, Issues, and Verdict. End with exactly VERDICT: SHIP or VERDICT: NEEDS WORK.${rules}`,
      assignee: 'reviewer',
      dependsOn: ['Synthesize recommendation'],
      memoryScope: 'all'
    }
  ];
}

function taskState(plan) {
  return plan.map(task => ({ ...task, status: 'pending', startedAt: null, completedAt: null, durationMs: null }));
}

export class AgentOSOrchestrator {
  constructor({ index, runStore, proposals = { createProposal, approveProposal, rejectProposal } }) {
    this.index = index;
    this.runStore = runStore;
    this.proposals = proposals;
    this.running = new Set();
  }

  createRun(input) {
    const title = bounded(input.title, 180) || 'Untitled goal';
    const goal = bounded(input.goal, 12000);
    if (!goal) throw new Error('A goal is required.');
    const categories = Array.isArray(input.categories) ? input.categories.map(value => bounded(value, 180)).filter(Boolean) : [];
    const includePrivate = input.includePrivate !== false;
    const outputCategory = bounded(input.outputCategory, 180) || categories[0] || 'Personal Generic';
    const context = buildContextPacket(this.index, { goal, categories, includePrivate });
    const corrections = relevantCorrections(this.index, { goal, category: outputCategory });
    const plan = buildPlan();
    const planHash = sha256(JSON.stringify({ goal, plan, contextHash: context.packetHash, outputCategory }));
    return this.runStore.create({
      title,
      goal,
      categories,
      includePrivate,
      outputCategory,
      memoryMode: input.memoryMode === 'never' ? 'never' : 'always',
      correctionPacket: corrections.packet,
      correctionCount: corrections.count,
      status: 'awaiting_plan_approval',
      plan,
      planHash,
      context: { query: context.query, policy: context.policy, sources: context.sources, packetHash: context.packetHash, characters: context.characters },
      tasks: taskState(plan),
      finalOutput: null,
      outputHash: null,
      reviewerOutput: null,
      reviewerVerdict: null,
      verification: null,
      proposalId: null,
      destination: null,
      error: null,
      startedAt: null,
      completedAt: null
    });
  }

  approvePlan(id, planHash) {
    const run = this.runStore.get(id);
    if (run.status !== 'awaiting_plan_approval') throw new Error('This plan is not awaiting approval.');
    if (planHash !== run.planHash) throw new Error('The plan changed after it was shown. Refresh and review it again.');
    const updated = this.runStore.update(id, { ...run, status: 'queued', planApprovedAt: new Date().toISOString() });
    this.runStore.event(id, 'plan.approved', { planHash });
    setTimeout(() => this.execute(id).catch(() => {}), 0);
    return updated;
  }

  rejectPlan(id) {
    const run = this.runStore.get(id);
    if (run.status !== 'awaiting_plan_approval') throw new Error('This plan is not awaiting approval.');
    const updated = this.runStore.update(id, { ...run, status: 'rejected', completedAt: new Date().toISOString() });
    this.runStore.event(id, 'plan.rejected', {});
    return updated;
  }

  async execute(id) {
    if (this.running.has(id)) return;
    this.running.add(id);
    const timings = new Map();
    const taskTitles = new Map();
    try {
      let run = this.runStore.get(id);
      if (!['queued', 'retrying'].includes(run.status)) return;
      const context = buildContextPacket(this.index, {
        goal: run.goal,
        categories: run.categories,
        includePrivate: run.includePrivate
      });
      if (context.packetHash !== run.context.packetHash) {
        this.runStore.update(id, { ...run, status: 'context_changed', error: 'The source context changed after plan approval. Create a fresh run to review the new context.' });
        this.runStore.event(id, 'run.context_changed', { approvedHash: run.context.packetHash, currentHash: context.packetHash });
        return;
      }

      const startedAt = new Date().toISOString();
      run = this.runStore.update(id, { ...run, status: 'running', startedAt, error: null });
      this.runStore.event(id, 'run.started', { taskCount: run.plan.length });
      const artifactDir = path.join(RUN_ARTIFACTS_PATH, id);
      fs.mkdirSync(artifactDir, { recursive: true });
      const checkpoint = new FileStore(path.join(artifactDir, 'oma-checkpoint.json'));

      const onProgress = event => {
        const data = safeData(event.data || {});
        if (data.id && data.title) taskTitles.set(data.id, data.title);
        const taskTitle = data.title || taskTitles.get(event.task) || event.task;
        this.runStore.event(id, `oma.${event.type}`, { agent: event.agent, task: taskTitle, data });
        if (event.type === 'task_start' && taskTitle) {
          timings.set(taskTitle, Date.now());
          this.runStore.update(id, current => ({
            ...current,
            tasks: current.tasks.map(task => task.title === taskTitle ? { ...task, status: 'in_progress', startedAt: new Date().toISOString() } : task)
          }));
        }
        if ((event.type === 'task_complete' || event.type === 'error') && taskTitle) {
          const durationMs = Date.now() - (timings.get(taskTitle) || Date.now());
          const success = event.type === 'task_complete';
          this.runStore.update(id, current => ({
            ...current,
            tasks: current.tasks.map(task => task.title === taskTitle ? { ...task, status: success ? 'completed' : 'failed', completedAt: new Date().toISOString(), durationMs } : task)
          }));
          const task = run.plan.find(item => item.title === taskTitle);
          this.runStore.performance({ runId: id, worker: event.agent, taskType: task?.taskType || 'unknown', success, durationMs });
        }
      };

      const orchestrator = new OpenMultiAgent({ maxConcurrency: 2, onProgress });
      const team = orchestrator.createTeam(`olivias-agent-switch-${id}`, {
        name: "Olivia's Agent Switch specialists",
        sharedMemory: true,
        agents: [
          agent('researcher', 'You are the evidence specialist. Find relevant facts, provenance, uncertainty, and current primary sources when needed.'),
          agent('analyst', 'You are the independent analyst. Challenge assumptions, compare options, and surface trade-offs without copying the researcher.'),
          agent('synthesizer', 'You are the decision writer. Reconcile evidence into a structured, concise, actionable memo without inventing facts.'),
          agent('reviewer', 'You are the skeptical verifier. Audit evidence, logic, privacy, and completeness. Never edit files or take external action.')
        ]
      });
      const result = await orchestrator.runTasks(team, taskDescriptions(run, context), { checkpoint: { store: checkpoint } });
      const synthesizer = result.agentResults.get('synthesizer');
      const reviewer = result.agentResults.get('reviewer');
      const finalOutput = String(synthesizer?.output || '').trim();
      const reviewOutput = String(reviewer?.output || '').trim();
      const localVerification = verifyDeliverable(finalOutput, { sourceIds: context.sources.map(source => source.id) });
      const verdict = reviewerVerdict(reviewOutput);
      const verification = { ...localVerification, reviewerVerdict: verdict, pass: localVerification.pass && verdict === 'SHIP' };
      const outputHash = sha256(finalOutput);

      fs.writeFileSync(path.join(artifactDir, 'final.md'), finalOutput, 'utf8');
      fs.writeFileSync(path.join(artifactDir, 'review.md'), reviewOutput, 'utf8');
      fs.writeFileSync(path.join(artifactDir, 'evidence.json'), `${JSON.stringify({ sources: context.sources, verification }, null, 2)}\n`, 'utf8');

      const proposal = this.proposals.createProposal({
        title: run.title,
        category: run.outputCategory,
        content: finalOutput,
        reason: `Agent OS run ${id}; plan ${run.planHash}; output ${outputHash}; verified: ${verification.pass}`
      });
      let memoryPath = null;
      let memoryError = null;
      if (run.memoryMode !== 'never') {
        try {
          memoryPath = writeRunRecord({ ...run, reviewerVerdict: verdict }, finalOutput, { vaultPath: this.index.vaultPath }).path;
          this.index.refresh();
        } catch (error) {
          memoryError = error.message;
          this.runStore.event(id, 'memory.failed', { error: memoryError });
        }
      }
      const status = 'awaiting_output_approval';
      const finished = this.runStore.update(id, current => ({
        ...current,
        status,
        finalOutput,
        memoryPath,
        memoryError,
        outputHash,
        reviewerOutput: reviewOutput,
        reviewerVerdict: verdict,
        verification,
        proposalId: proposal.id,
        executionSuccess: result.success,
        tokenUsage: result.totalTokenUsage,
        tasks: current.tasks.map(task => task.status === 'failed' ? task : { ...task, status: 'completed', completedAt: task.completedAt || new Date().toISOString() }),
        executionFinishedAt: new Date().toISOString()
      }));
      this.runStore.event(id, 'run.awaiting_output_approval', { outputHash, verified: verification.pass, reviewerVerdict: verdict });
      return finished;
    } catch (error) {
      const run = this.runStore.get(id);
      this.runStore.update(id, { ...run, status: 'failed', error: error.message || String(error), completedAt: new Date().toISOString() });
      this.runStore.event(id, 'run.failed', { error: error.message || String(error) });
      throw error;
    } finally {
      this.running.delete(id);
    }
  }

  approveOutput(id, outputHash) {
    const run = this.runStore.get(id);
    if (run.status !== 'awaiting_output_approval') throw new Error('This output is not awaiting approval.');
    if (outputHash !== run.outputHash) throw new Error('The output changed after it was shown. Refresh and review it again.');
    const proposal = this.proposals.approveProposal(run.proposalId);
    const updated = this.runStore.update(id, { ...run, status: 'completed', destination: proposal.notePath, outputApprovedAt: new Date().toISOString(), completedAt: new Date().toISOString() });
    this.runStore.event(id, 'output.approved', { outputHash, destination: proposal.notePath, verificationPass: run.verification?.pass });
    this.index.refresh();
    return updated;
  }

  rejectOutput(id) {
    const run = this.runStore.get(id);
    if (run.status !== 'awaiting_output_approval') throw new Error('This output is not awaiting approval.');
    this.proposals.rejectProposal(run.proposalId);
    const updated = this.runStore.update(id, { ...run, status: 'rejected', completedAt: new Date().toISOString() });
    this.runStore.event(id, 'output.rejected', { outputHash: run.outputHash });
    return updated;
  }

  retry(id) {
    const run = this.runStore.get(id);
    if (!['failed', 'context_changed'].includes(run.status)) throw new Error('Only failed or context-changed runs can be retried.');
    if (run.status === 'context_changed') throw new Error('Create a new run so the changed context can be reviewed.');
    const updated = this.runStore.update(id, current => ({ ...current, status: 'retrying', error: null, tasks: taskState(current.plan) }));
    this.runStore.event(id, 'run.retrying', {});
    setTimeout(() => this.execute(id).catch(() => {}), 0);
    return updated;
  }
}
