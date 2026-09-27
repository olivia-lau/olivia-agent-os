import fs from 'node:fs';
import path from 'node:path';

const HIDDEN_FOLDERS = new Set(['.obsidian', '.git', 'node_modules']);

function normalizeRelative(value) {
  return value.split(path.sep).join('/');
}

export function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolveNotePath(vaultPath, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error('A note path is required.');
  }
  const normalized = relativePath.replaceAll('\\', '/');
  if (!normalized.toLowerCase().endsWith('.md')) {
    throw new Error('Only Markdown notes can be read.');
  }
  const absolute = path.resolve(vaultPath, ...normalized.split('/'));
  if (!isInside(vaultPath, absolute)) {
    throw new Error('That path is outside the Obsidian vault.');
  }
  return absolute;
}

export function parseFrontmatter(markdown) {
  if (!markdown.startsWith('---')) return {};
  const end = markdown.indexOf('\n---', 3);
  if (end === -1) return {};
  const result = {};
  for (const line of markdown.slice(4, end).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }
  return result;
}

function stripFrontmatter(markdown) {
  if (!markdown.startsWith('---')) return markdown;
  const end = markdown.indexOf('\n---', 3);
  return end === -1 ? markdown : markdown.slice(end + 4);
}

function plainText(markdown) {
  return stripFrontmatter(markdown)
    .replace(/!\[\[[^\]]+\]\]/g, ' ')
    .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~\-|]/g, ' ')
    .replace(/\[(.*?)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function deriveLocation(relativePath, frontmatter) {
  const segments = relativePath.split('/');
  const masterIndex = segments.indexOf('Master Vault Categories');
  const category = masterIndex >= 0 ? segments[masterIndex + 1] || 'Uncategorized' : 'System';
  const vaultsIndex = segments.indexOf('Vaults');
  const inferredProject = vaultsIndex >= 0 ? segments[vaultsIndex + 1] || '' : '';
  const project = frontmatter.project || inferredProject;
  return { category, project };
}

function titleFrom(markdown, filePath) {
  const heading = stripFrontmatter(markdown).match(/^#\s+(.+)$/m);
  return heading?.[1]?.trim() || path.basename(filePath, '.md');
}

function walkMarkdown(root) {
  const found = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory() && HIDDEN_FOLDERS.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(absolute);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) found.push(absolute);
    }
  }
  return found;
}

function scoreNote(note, terms) {
  let score = 0;
  const title = note.title.toLowerCase();
  const body = note.searchText;
  for (const term of terms) {
    if (title === term) score += 80;
    else if (title.includes(term)) score += 30;
    if (note.category.toLowerCase().includes(term)) score += 14;
    if (note.project.toLowerCase().includes(term)) score += 12;
    const matches = body.split(term).length - 1;
    score += Math.min(matches, 12) * 2;
  }
  return score;
}

export class VaultIndex {
  constructor(vaultPath) {
    this.vaultPath = path.resolve(vaultPath);
    this.notes = [];
    this.byPath = new Map();
    this.lastIndexedAt = null;
  }

  refresh() {
    if (!fs.existsSync(this.vaultPath)) throw new Error(`Vault not found: ${this.vaultPath}`);
    const notes = [];
    for (const absolutePath of walkMarkdown(this.vaultPath)) {
      const markdown = fs.readFileSync(absolutePath, 'utf8');
      const stats = fs.statSync(absolutePath);
      const relativePath = normalizeRelative(path.relative(this.vaultPath, absolutePath));
      const frontmatter = parseFrontmatter(markdown);
      const { category, project } = deriveLocation(relativePath, frontmatter);
      const text = plainText(markdown);
      notes.push({
        path: relativePath,
        title: titleFrom(markdown, absolutePath),
        category,
        project,
        type: frontmatter.type || 'note',
        status: frontmatter.status || '',
        sensitivity: frontmatter.sensitivity || 'private',
        platform: frontmatter.platform || '',
        updated: frontmatter.updated || stats.mtime.toISOString(),
        modifiedAt: stats.mtime.toISOString(),
        excerpt: text.slice(0, 280),
        wordCount: text ? text.split(/\s+/).length : 0,
        searchText: `${text} ${relativePath}`.toLowerCase()
      });
    }
    notes.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    this.notes = notes;
    this.byPath = new Map(notes.map(note => [note.path, note]));
    this.lastIndexedAt = new Date().toISOString();
    return this.stats();
  }

  stats() {
    const categories = new Set(this.notes.map(note => note.category));
    const projects = new Set(this.notes.map(note => note.project).filter(Boolean));
    return {
      notes: this.notes.length,
      categories: categories.size,
      projects: projects.size,
      words: this.notes.reduce((sum, note) => sum + note.wordCount, 0),
      lastIndexedAt: this.lastIndexedAt
    };
  }

  categories() {
    const counts = new Map();
    for (const note of this.notes) counts.set(note.category, (counts.get(note.category) || 0) + 1);
    return [...counts.entries()]
      .map(([name, noteCount]) => ({ name, noteCount }))
      .sort((a, b) => b.noteCount - a.noteCount || a.name.localeCompare(b.name));
  }

  recent({ category = '', limit = 30 } = {}) {
    return this.notes.filter(note => !category || note.category === category).slice(0, Math.min(Number(limit) || 30, 100));
  }

  search({ query = '', category = '', project = '', limit = 40 } = {}) {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    let candidates = this.notes.filter(note =>
      (!category || note.category === category) && (!project || note.project === project)
    );
    if (!terms.length) return candidates.slice(0, Math.min(Number(limit) || 40, 100));
    return candidates
      .map(note => ({ ...note, score: scoreNote(note, terms) }))
      .filter(note => note.score > 0)
      .sort((a, b) => b.score - a.score || b.modifiedAt.localeCompare(a.modifiedAt))
      .slice(0, Math.min(Number(limit) || 40, 100));
  }

  read(relativePath) {
    const absolute = resolveNotePath(this.vaultPath, relativePath);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error('Note not found.');
    const markdown = fs.readFileSync(absolute, 'utf8');
    const indexed = this.byPath.get(normalizeRelative(path.relative(this.vaultPath, absolute)));
    return { ...(indexed || {}), path: normalizeRelative(path.relative(this.vaultPath, absolute)), markdown };
  }
}
