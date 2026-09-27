const REQUIRED_SECTIONS = ['summary', 'evidence', 'analysis', 'recommendation', 'risks', 'sources'];

export function verifyDeliverable(markdown, { sourceIds = [] } = {}) {
  const text = String(markdown || '').trim();
  const lower = text.toLowerCase();
  const checks = [
    { id: 'non-empty', label: 'Deliverable is present', pass: text.length > 0, detail: `${text.length} characters` },
    { id: 'substantive', label: 'Deliverable is substantive', pass: text.length >= 500, detail: `${text.length}/500 characters` },
    ...REQUIRED_SECTIONS.map(section => ({
      id: `section-${section}`,
      label: `Contains ${section} section`,
      pass: new RegExp(`^#{1,4}\\s+.*${section}`, 'im').test(text),
      detail: section
    }))
  ];
  if (sourceIds.length) {
    const cited = sourceIds.filter(id => lower.includes(id.toLowerCase()));
    checks.push({
      id: 'vault-provenance',
      label: 'Cites supplied vault evidence',
      pass: cited.length > 0,
      detail: cited.length ? `Cited: ${cited.join(', ')}` : `Expected one of: ${sourceIds.join(', ')}`
    });
  }
  const pass = checks.every(check => check.pass);
  return { pass, checks, verifiedAt: new Date().toISOString() };
}

export function reviewerVerdict(output) {
  const value = String(output || '');
  if (/VERDICT\s*:\s*SHIP/i.test(value)) return 'SHIP';
  if (/VERDICT\s*:\s*NEEDS\s+WORK/i.test(value)) return 'NEEDS WORK';
  return 'UNCLEAR';
}
