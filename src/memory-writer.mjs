import fs from 'node:fs';
import path from 'node:path';
import { INBOX_PATH, VAULT_PATH } from './config.mjs';

function slug(value) {
  return String(value || 'task').normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'task';
}

function yaml(value) { return JSON.stringify(String(value || '')); }

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function destinationFor(run, vaultPath) {
  const request = run.command || run.goal || '';
  if (/(american greetings|\bAG\b|easter bunny|selfie bunny)/i.test(request)) {
    return { folder: path.join(vaultPath, 'Master Vault Categories', 'Professional Work', 'American Greetings (2026)', 'Vaults', 'American Greetings', '04 Production Record', 'Agent Runs'), project: 'American Greetings Easter Bunnies' };
  }
  const inbox = vaultPath === VAULT_PATH ? INBOX_PATH : path.join(vaultPath, '90 Agent OS Inbox');
  return { folder: path.join(inbox, slug(run.outputCategory || 'Personal Generic')), project: '' };
}

function linkedImages(output, workspace) {
  const paths = [...String(output).matchAll(/\[[^\]]+\]\(<?((?:[A-Za-z]:[\\/]|\/)[^)>]+\.(?:png|jpe?g|gif|webp))>?\)/gi)].map(match => match[1]);
  return [...new Set(paths.map(value => path.resolve(value)))].filter(value => within(workspace, value) && fs.existsSync(value) && fs.statSync(value).isFile() && fs.statSync(value).size <= 25_000_000);
}

export function writeRunRecord(run, output, { vaultPath = VAULT_PATH } = {}) {
  const destination = destinationFor(run, vaultPath);
  fs.mkdirSync(destination.folder, { recursive: true });
  const basename = `${run.createdAt.slice(0, 10)} - ${slug(run.title)} - ${run.id.slice(0, 8)}`;
  const notePath = path.join(destination.folder, `${basename}.md`);
  if (fs.existsSync(notePath)) return { path: notePath, images: [] };
  const images = [];
  for (const source of run.workspace ? linkedImages(output, run.workspace) : []) {
    const targetName = `${run.id.slice(0, 8)}-${path.basename(source)}`;
    const target = path.join(destination.folder, targetName);
    if (!fs.existsSync(target)) fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    images.push(targetName);
  }
  const markdown = [
    '---',
    'type: agent-run',
    `status: ${run.mode === 'direct' ? 'completed' : 'review-pending'}`,
    `project: ${yaml(destination.project)}`,
    `category: ${yaml(run.outputCategory || 'Personal Generic')}`,
    `provider: ${yaml(run.provider)}`,
    `run_id: ${yaml(run.id)}`,
    ...(run.threadId ? [`conversation_id: ${yaml(run.threadId)}`] : []),
    ...(run.referenceThreadId ? [`reference_conversation_id: ${yaml(run.referenceThreadId)}`] : []),
    `created: ${run.createdAt.slice(0, 10)}`,
    'sensitivity: private',
    '---', '',
    `# ${run.title}`, '',
    '## Request', '', run.command || run.goal || '',
    '## Result', '', output, '',
    ...(images.length ? ['## Images', '', ...images.map(name => `![[${name}]]`), ''] : []),
    '## Execution', '',
    `- Agent: ${run.provider}`,
    ...(run.workspace ? [`- Workspace: \`${run.workspace}\``] : []),
    `- Agent OS run: \`${run.id}\``,
    ...(run.attachments?.length ? [`- Local attachments used: ${run.attachments.map(item => item.relativePath).join(', ')} (files remain outside Obsidian unless explicitly saved)`] : []),
    ...(run.reviewerVerdict ? [`- Reviewer verdict: ${run.reviewerVerdict}`] : []),
    ...(run.handoffs?.length ? run.handoffs.map(item => `- Handoff: ${item.from} → ${item.to} (${item.reason})`) : []),
    ''
  ].join('\n');
  fs.writeFileSync(notePath, markdown, { encoding: 'utf8', flag: 'wx' });
  return { path: notePath, images };
}
