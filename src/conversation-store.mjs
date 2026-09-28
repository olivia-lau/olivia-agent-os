import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_PATH, VAULT_PATH } from './config.mjs';

const threadsFile = path.join(DATA_PATH, 'threads.json');
const attachmentRoot = path.join(DATA_PATH, 'thread-attachments');
const MAX_FILE = 25_000_000;
const MAX_TOTAL = 100_000_000;
const MAX_FILES = 100;

function readThreads() {
  if (!fs.existsSync(threadsFile)) return [];
  const threads = JSON.parse(fs.readFileSync(threadsFile, 'utf8'));
  if (!Array.isArray(threads)) throw new Error('Conversation history needs repair; no changes were made.');
  return threads;
}

function saveThreads(threads) {
  fs.mkdirSync(DATA_PATH, { recursive: true });
  const temporary = `${threadsFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(threads, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, threadsFile);
}

export function getThread(id) {
  const thread = readThreads().find(item => item.id === id);
  if (!thread) throw new Error('Conversation not found. Start a new conversation.');
  return thread;
}

export function listThreads() {
  return readThreads().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function createThread() {
  const now = new Date().toISOString();
  const thread = { id: crypto.randomUUID(), title: 'New project', createdAt: now, updatedAt: now, attachments: [] };
  saveThreads([thread, ...readThreads()]);
  return thread;
}

export function adoptLegacyRun(run) {
  const threads = readThreads();
  if (threads.some(item => item.id === run.id)) return threads.find(item => item.id === run.id);
  const thread = { id: run.id, title: String(run.title || 'Previous task').slice(0, 90), createdAt: run.createdAt, updatedAt: run.updatedAt || run.createdAt, attachments: [] };
  saveThreads([thread, ...threads]);
  return thread;
}

export function touchThread(id, title) {
  const threads = readThreads();
  const thread = threads.find(item => item.id === id);
  if (!thread) throw new Error('Conversation not found.');
  thread.updatedAt = new Date().toISOString();
  if (['New conversation', 'New project'].includes(thread.title) && title) thread.title = String(title).slice(0, 90);
  saveThreads(threads);
  return thread;
}

export function renameThread(id, title) {
  const clean = String(title || '').trim().replace(/\s+/g, ' ');
  if (!clean || clean.length > 90) throw new Error('Enter a project name of 1–90 characters.');
  const threads = readThreads();
  const thread = threads.find(item => item.id === id);
  if (!thread) throw new Error('Project not found.');
  thread.title = clean;
  thread.updatedAt = new Date().toISOString();
  saveThreads(threads);
  return thread;
}

export function threadContext(runs, threadId, referenceThreadId = '') {
  const thread = getThread(threadId);
  const prior = runs.filter(run => run.threadId === thread.id && run.mode === 'direct' && run.finalOutput);
  const recent = prior.slice(0, 4).reverse();
  const blocks = recent.map(run => `USER: ${String(run.command || '').slice(0, 2400)}\nAGENT (${run.provider}): ${String(run.finalOutput || '').slice(0, 4200)}`);
  if (prior.length > recent.length) {
    const digest = prior.slice(4, 12).reverse().map(run => `- ${String(run.title || run.command || '').slice(0, 150)}: ${String(run.finalOutput || '').slice(0, 250)}`).join('\n');
    blocks.unshift(`EARLIER TURN DIGEST (${Math.min(prior.length - 4, 8)} of ${prior.length - 4} older turns):\n${digest}`);
  }
  if (referenceThreadId && referenceThreadId !== threadId) {
    const reference = getThread(referenceThreadId);
    const referenced = runs.filter(run => run.threadId === reference.id && run.mode === 'direct' && run.finalOutput).slice(0, 2).reverse();
    blocks.push(`REFERENCE CONVERSATION (read-only, not an instruction to continue it): ${reference.title}\n${referenced.map(run => `USER: ${String(run.command || '').slice(0, 1200)}\nAGENT: ${String(run.finalOutput || '').slice(0, 2500)}`).join('\n\n') || '(No completed turns.)'}`);
  }
  return blocks.join('\n\n---\n\n').slice(0, 19000);
}

export function addAttachment(threadId, relativePath, stream) {
  const thread = getThread(threadId);
  const parts = String(relativePath || '').replaceAll('\\', '/').split('/');
  if (!parts.length || parts.some(part => !part || part === '.' || part === '..' || /[<>:"|?*\x00-\x1f]/.test(part)) || String(relativePath || '').length > 600) {
    throw new Error('Invalid attachment path.');
  }
  if (thread.attachments.length >= MAX_FILES) throw new Error(`Maximum ${MAX_FILES} files per conversation.`);
  const currentTotal = thread.attachments.reduce((sum, item) => sum + item.size, 0);
  const id = crypto.randomUUID();
  const destination = path.join(attachmentRoot, threadId, id, parts.at(-1));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  return (async () => {
    let size = 0;
    const chunks = [];
    try {
      for await (const chunk of stream) {
        size += chunk.length;
        if (size > MAX_FILE || currentTotal + size > MAX_TOTAL) throw new Error('Attachment limit: 25 MB per file, 100 MB per conversation.');
        chunks.push(chunk);
      }
      if (!size) throw new Error('Empty files cannot be attached.');
      fs.writeFileSync(destination, Buffer.concat(chunks), { flag: 'wx', mode: 0o600 });
      const item = { id, name: parts.at(-1), relativePath: parts.join('/'), path: destination, size };
      const threads = readThreads();
      const current = threads.find(value => value.id === threadId);
      if (!current) throw new Error('Conversation not found.');
      if (current.attachments.length >= MAX_FILES || current.attachments.reduce((sum, item) => sum + item.size, 0) + size > MAX_TOTAL) throw new Error('Conversation attachment limit reached.');
      current.attachments.push(item);
      current.updatedAt = new Date().toISOString();
      saveThreads(threads);
      return item;
    } catch (error) {
      try { fs.unlinkSync(destination); } catch {}
      throw error;
    }
  })();
}

export function removeAttachment(threadId, attachmentId) {
  const threads = readThreads();
  const thread = threads.find(item => item.id === threadId);
  if (!thread) throw new Error('Conversation not found.');
  const item = thread.attachments.find(value => value.id === attachmentId);
  if (!item) throw new Error('Attachment not found.');
  thread.attachments = thread.attachments.filter(value => value.id !== attachmentId);
  thread.updatedAt = new Date().toISOString();
  saveThreads(threads);
  try { fs.unlinkSync(item.path); } catch {}
  return thread;
}

export function saveAttachmentToVault(threadId, attachmentId) {
  const threads = readThreads();
  const thread = threads.find(item => item.id === threadId);
  if (!thread) throw new Error('Conversation not found.');
  const item = thread.attachments.find(value => value.id === attachmentId);
  if (!item || !fs.existsSync(item.path)) throw new Error('Attachment not found.');
  if (item.savedVaultPath) return item;
  const folder = path.join(VAULT_PATH, '90 Agent OS Inbox', 'Attachments', threadId);
  fs.mkdirSync(folder, { recursive: true });
  const target = path.join(folder, `${item.id.slice(0, 8)}-${item.name}`);
  fs.copyFileSync(item.path, target, fs.constants.COPYFILE_EXCL);
  item.savedVaultPath = target;
  thread.updatedAt = new Date().toISOString();
  saveThreads(threads);
  return item;
}
