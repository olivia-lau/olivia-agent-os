import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ACTIVITY_PATH, DATA_PATH, INBOX_PATH, PROPOSALS_PATH } from './config.mjs';

function ensureData() {
  fs.mkdirSync(DATA_PATH, { recursive: true });
}

function loadJson(filePath, fallback = []) {
  ensureData();
  if (!fs.existsSync(filePath)) return fallback;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function saveJson(filePath, value) {
  ensureData();
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, filePath);
}

function cleanText(value, max) {
  return String(value || '').replaceAll('\0', '').trim().slice(0, max);
}

function slugify(value) {
  return value
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled';
}

function yamlString(value) {
  return JSON.stringify(String(value || ''));
}

export function logActivity(action, details = {}) {
  const activity = loadJson(ACTIVITY_PATH);
  activity.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), action, ...details });
  saveJson(ACTIVITY_PATH, activity.slice(0, 500));
}

export function listActivity(limit = 40) {
  return loadJson(ACTIVITY_PATH).slice(0, Math.min(Number(limit) || 40, 100));
}

export function listProposals(status = '') {
  return loadJson(PROPOSALS_PATH).filter(item => !status || item.status === status);
}

export function createProposal(input) {
  const title = cleanText(input.title, 180);
  const content = cleanText(input.content, 100000);
  const category = cleanText(input.category, 180) || 'Uncategorized';
  const reason = cleanText(input.reason, 1000);
  if (!title) throw new Error('A proposal title is required.');
  if (!content) throw new Error('Proposal content is required.');
  const proposals = loadJson(PROPOSALS_PATH);
  const proposal = {
    id: crypto.randomUUID(),
    title,
    content,
    category,
    reason,
    status: 'pending',
    createdAt: new Date().toISOString(),
    reviewedAt: null,
    notePath: null
  };
  proposals.unshift(proposal);
  saveJson(PROPOSALS_PATH, proposals);
  logActivity('proposal.created', { proposalId: proposal.id, title, category });
  return proposal;
}

function updateProposal(id, updater) {
  const proposals = loadJson(PROPOSALS_PATH);
  const index = proposals.findIndex(item => item.id === id);
  if (index === -1) throw new Error('Proposal not found.');
  proposals[index] = updater(proposals[index]);
  saveJson(PROPOSALS_PATH, proposals);
  return proposals[index];
}

export function approveProposal(id) {
  return updateProposal(id, proposal => {
    if (proposal.status !== 'pending') throw new Error('Only pending proposals can be approved.');
    const day = new Date().toISOString().slice(0, 10);
    const categoryFolder = slugify(proposal.category);
    const destinationFolder = path.join(INBOX_PATH, categoryFolder);
    fs.mkdirSync(destinationFolder, { recursive: true });
    const base = `${day} - ${slugify(proposal.title)}`;
    let destination = path.join(destinationFolder, `${base}.md`);
    let suffix = 2;
    while (fs.existsSync(destination)) destination = path.join(destinationFolder, `${base}-${suffix++}.md`);
    const markdown = [
      '---',
      'type: agent-proposal',
      'status: inbox',
      `category: ${yamlString(proposal.category)}`,
      `proposal_id: ${yamlString(proposal.id)}`,
      `created: ${proposal.createdAt.slice(0, 10)}`,
      `approved: ${day}`,
      'sensitivity: private',
      '---',
      '',
      `# ${proposal.title}`,
      '',
      proposal.content,
      '',
      '---',
      '',
      `*Proposed for: ${proposal.category}*`,
      proposal.reason ? `*Reason: ${proposal.reason}*` : '',
      ''
    ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n');
    fs.writeFileSync(destination, markdown, { encoding: 'utf8', flag: 'wx' });
    const notePath = path.relative(path.dirname(INBOX_PATH), destination).split(path.sep).join('/');
    const updated = { ...proposal, status: 'approved', reviewedAt: new Date().toISOString(), notePath };
    logActivity('proposal.approved', { proposalId: proposal.id, title: proposal.title, notePath });
    return updated;
  });
}

export function rejectProposal(id) {
  return updateProposal(id, proposal => {
    if (proposal.status !== 'pending') throw new Error('Only pending proposals can be rejected.');
    const updated = { ...proposal, status: 'rejected', reviewedAt: new Date().toISOString() };
    logActivity('proposal.rejected', { proposalId: proposal.id, title: proposal.title });
    return updated;
  });
}
