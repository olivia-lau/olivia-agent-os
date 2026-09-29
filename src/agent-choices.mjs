const efforts = {
  codex: ['', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  claude: ['', 'low', 'medium', 'high', 'xhigh', 'max'],
  perplexity: ['', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
};

export function validateAgentChoices(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Agent settings must be an object.');
  const choices = {};
  for (const provider of Object.keys(efforts)) {
    const raw = value[provider] || {};
    if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${provider} settings are invalid.`);
    const model = String(raw.model || '').trim();
    const effort = String(raw.effort || '').trim();
    if (model.length > 120 || (model && !/^[a-zA-Z0-9._/\[\]-]+$/.test(model))) throw new Error(`${provider} model name is invalid.`);
    if (!efforts[provider].includes(effort)) throw new Error(`${provider} effort is invalid.`);
    choices[provider] = { model, effort };
  }
  const preset = String(value.perplexity?.preset || 'fast').trim();
  if (!['fast', 'low', 'medium', 'high', 'xhigh'].includes(preset)) throw new Error('Perplexity research depth is invalid.');
  choices.perplexity.preset = preset;
  return choices;
}
