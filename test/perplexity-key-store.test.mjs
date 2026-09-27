import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { forgetPerplexityKey, loadPerplexityKey, savePerplexityKey, savedPerplexityKeyPath } from '../src/perplexity-key-store.mjs';

test('saves only encrypted Perplexity key text in the vault and restores it with an external master key', async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'olivia-key-store-test-'));
  const data = path.join(vault, '..', `${path.basename(vault)}-app-data`);
  const key = 'test-key-not-a-real-credential';
  try {
    await savePerplexityKey(key, vault, data);
    const encrypted = await fs.readFile(savedPerplexityKeyPath(vault), 'utf8');
    assert.ok(encrypted.trim().length > 50);
    assert.equal(encrypted.includes(key), false);
    assert.equal(await loadPerplexityKey(vault, data), key);
    await forgetPerplexityKey(vault);
    assert.equal(await loadPerplexityKey(vault, data), '');
  } finally {
    await fs.rm(vault, { recursive: true, force: true });
    await fs.rm(data, { recursive: true, force: true });
  }
});
