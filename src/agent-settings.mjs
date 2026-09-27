import fs from 'node:fs';
import path from 'node:path';
import { DATA_PATH } from './config.mjs';

const settingsPath = path.join(DATA_PATH, 'agent-settings.json');

export function validateCodexModel(value) {
  const model = String(value || '').trim();
  if (model.length > 100 || (model && !/^[a-zA-Z0-9._-]+$/.test(model))) {
    throw new Error('Enter a Codex model name using only letters, numbers, periods, underscores, or hyphens.');
  }
  return model;
}

export function getAgentSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return { codexModel: validateCodexModel(parsed.codexModel) };
  } catch {
    return { codexModel: '' };
  }
}

export function saveAgentSettings(input) {
  const value = { codexModel: validateCodexModel(input?.codexModel) };
  fs.mkdirSync(DATA_PATH, { recursive: true });
  const temporary = `${settingsPath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, settingsPath);
  return value;
}
