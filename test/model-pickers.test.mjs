import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Codex and Claude have separate model pickers and Claude keeps a custom fallback', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const script = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(html, /id="codexModelPicker"/);
  assert.match(html, /id="claudeModelPicker"/);
  for (const model of ['sonnet', 'opus', 'haiku']) assert.match(html, new RegExp(`<option value="${model}">`));
  assert.match(html, /id="claudeCustomModelLabel" hidden/);
  assert.match(script, /claudeModelInput\.value = custom \? '' : claudeModelPicker\.value/);
});
