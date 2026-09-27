import crypto from 'node:crypto';

const STOP_WORDS = new Set('a an and are as at be by for from how i in is it my of on or that the this to what when where which who why with you your'.split(' '));

function queryFromGoal(goal) {
  return [...new Set(String(goal).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]+/gu) || [])]
    .filter(word => word.length > 2 && !STOP_WORDS.has(word))
    .slice(0, 16)
    .join(' ');
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function buildContextPacket(index, {
  goal,
  categories = [],
  includePrivate = true,
  maxNotes = 10,
  maxCharacters = 18000
}) {
  const query = queryFromGoal(goal);
  let candidates = index.search({ query, limit: 100 });
  if (categories.length) candidates = candidates.filter(note => categories.includes(note.category));
  if (!includePrivate) candidates = candidates.filter(note => note.sensitivity !== 'private' && note.sensitivity !== 'restricted');

  if (!candidates.length) {
    candidates = index.recent({ limit: 100 }).filter(note =>
      (!categories.length || categories.includes(note.category)) &&
      (includePrivate || (note.sensitivity !== 'private' && note.sensitivity !== 'restricted'))
    );
  }

  const sources = [];
  const blocks = [];
  let used = 0;
  for (const candidate of candidates.slice(0, Math.max(maxNotes * 3, maxNotes))) {
    if (sources.length >= maxNotes || used >= maxCharacters) break;
    const note = index.read(candidate.path);
    const remaining = maxCharacters - used;
    const content = note.markdown.slice(0, Math.min(2800, remaining));
    if (!content.trim()) continue;
    const sourceId = `vault-${sources.length + 1}`;
    const source = {
      id: sourceId,
      path: note.path,
      title: note.title,
      category: note.category,
      project: note.project,
      sensitivity: note.sensitivity,
      sha256: hash(note.markdown),
      includedCharacters: content.length
    };
    sources.push(source);
    blocks.push(`SOURCE ${sourceId}\nTITLE: ${note.title}\nPATH: ${note.path}\nCATEGORY: ${note.category}\nCONTENT:\n${content}`);
    used += content.length;
  }

  return {
    query,
    policy: { categories, includePrivate, maxNotes, maxCharacters },
    sources,
    packet: blocks.join('\n\n---\n\n'),
    packetHash: hash(blocks.join('\n\n---\n\n')),
    characters: used
  };
}
