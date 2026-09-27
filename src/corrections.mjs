import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseFrontmatter } from './vault.mjs';

const STOP = new Set('about after agent agents and are can do for from have into need next our should that the their them then there this with would your'.split(' '));
const words = value => [...new Set((String(value || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter(word => !STOP.has(word)))];
const yaml = value => JSON.stringify(String(value || ''));

export function saveCorrection(index, run, input) {
  const wrong = String(input.wrong || '').trim().slice(0, 5000);
  const guidance = String(input.guidance || '').trim().slice(0, 5000);
  const appliesTo = String(input.appliesTo || '').trim().slice(0, 300);
  const category = String(input.category || run.outputCategory || 'Personal Generic').trim().slice(0, 180);
  if (!wrong || !guidance || !appliesTo) throw new Error('Describe what was wrong, what should happen next time, and when it applies.');
  const id = crypto.randomUUID();
  const folder = path.join(index.vaultPath, '00 System', 'Corrections');
  fs.mkdirSync(folder, { recursive: true });
  const notePath = path.join(folder, `${new Date().toISOString().slice(0, 10)} - ${id.slice(0, 8)}.md`);
  const note = [
    '---',
    'type: correction',
    'status: active',
    `uid: ${yaml(id)}`,
    `source_run: ${yaml(run.id)}`,
    `category_scope: ${yaml(category)}`,
    `applies_to: ${yaml(appliesTo)}`,
    `created: ${new Date().toISOString().slice(0, 10)}`,
    'sensitivity: private',
    '---', '',
    `# Correction — ${appliesTo}`, '',
    '## What was wrong', '', wrong, '',
    '## Follow this next time', '', guidance, '',
    '## Scope', '',
    `- Applies to: ${appliesTo}`,
    `- Category: ${category}`,
    `- Source run: ${run.id}`,
    ''
  ].join('\n');
  fs.writeFileSync(notePath, note, { encoding: 'utf8', flag: 'wx' });
  index.refresh();
  return { id, path: notePath, category, appliesTo };
}

export function relevantCorrections(index, { goal, category, limit = 5, maxCharacters = 6000 }) {
  const goalWords = new Set(words(goal));
  const candidates = [];
  for (const summary of index.notes.filter(note => note.type === 'correction' && note.status === 'active')) {
    const note = index.read(summary.path);
    const meta = parseFrontmatter(note.markdown);
    if (meta.category_scope !== category && meta.category_scope !== 'All categories') continue;
    const scopeWords = words(meta.applies_to);
    const overlap = scopeWords.filter(word => goalWords.has(word)).length;
    if (scopeWords.length && overlap < Math.min(2, scopeWords.length)) continue;
    candidates.push({ note, overlap, updated: summary.modifiedAt });
  }
  candidates.sort((a, b) => b.overlap - a.overlap || b.updated.localeCompare(a.updated));
  const blocks = [];
  let used = 0;
  for (const item of candidates.slice(0, limit)) {
    const meta = parseFrontmatter(item.note.markdown);
    const guidance = item.note.markdown.match(/## Follow this next time\s*([\s\S]*?)(?=\n## |$)/)?.[1]?.trim() || '';
    const content = `APPLIES TO: ${meta.applies_to}\nFOLLOW THIS NEXT TIME: ${guidance}`.slice(0, Math.min(2400, maxCharacters - used));
    if (!content) break;
    blocks.push(`USER CORRECTION (${item.note.path}):\n${content}`);
    used += content.length;
  }
  return { packet: blocks.join('\n\n---\n\n'), count: blocks.length };
}
