import fs from 'node:fs/promises';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DATA_PATH, VAULT_PATH } from './config.mjs';

const CONNECTION_DIR = path.join('00 System', 'Connections');
const KEY_FILE = 'Perplexity API Key.encrypted.txt';
const NOTE_FILE = 'Perplexity API Connection.md';
const MASTER_KEY_FILE = 'perplexity-vault-master-key.bin';

export function savedPerplexityKeyPath(vaultPath = VAULT_PATH) {
  return path.join(vaultPath, CONNECTION_DIR, KEY_FILE);
}

async function masterKey(dataPath, create = false) {
  const file = path.join(dataPath, 'secrets', MASTER_KEY_FILE);
  if (create) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    try { await fs.writeFile(file, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const key = await fs.readFile(file);
  if (key.length !== 32) throw new Error('The local encryption key is invalid.');
  return key;
}

async function encrypt(input, dataPath) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', await masterKey(dataPath, true), nonce);
  const encrypted = Buffer.concat([cipher.update(input, 'utf8'), cipher.final()]);
  return JSON.stringify({ version: 1, algorithm: 'aes-256-gcm', nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: encrypted.toString('base64') });
}

async function decrypt(input, dataPath) {
  const saved = JSON.parse(input);
  if (saved.version !== 1 || saved.algorithm !== 'aes-256-gcm') throw new Error('Unsupported encrypted key format.');
  const decipher = createDecipheriv('aes-256-gcm', await masterKey(dataPath), Buffer.from(saved.nonce, 'base64'));
  decipher.setAuthTag(Buffer.from(saved.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(saved.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

export async function savePerplexityKey(apiKey, vaultPath = VAULT_PATH, dataPath = DATA_PATH) {
  const key = String(apiKey || '').trim();
  if (!key || key.length > 1000 || /\s/.test(key)) throw new Error('Enter a valid Perplexity API key.');
  const encrypted = await encrypt(key, dataPath);
  const directory = path.join(vaultPath, CONNECTION_DIR);
  await fs.mkdir(directory, { recursive: true });
  const destination = savedPerplexityKeyPath(vaultPath);
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, `${encrypted}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
  const note = path.join(directory, NOTE_FILE);
  const markdown = `---\nuid: system-perplexity-api-connection\ntype: connection\nsensitivity: private\n---\n# Perplexity API connection\n\nThe Perplexity API key is saved in [[${KEY_FILE}]] as encrypted text. It is not plaintext in this vault or in Agent OS run records. Olivia OS loads it automatically when the dashboard starts. The decryption key stays outside this vault in the local Agent OS app data, so a vault copy alone cannot reveal the API key. If you move to another computer, reconnect Perplexity there.\n\nUse **Agent connections → Forget saved key** in the dashboard to remove the encrypted copy. Do not paste a plaintext key into this note.\n`;
  try { await fs.writeFile(note, markdown, { encoding: 'utf8', flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return destination;
}

export async function loadPerplexityKey(vaultPath = VAULT_PATH, dataPath = DATA_PATH) {
  let encrypted;
  try { encrypted = await fs.readFile(savedPerplexityKeyPath(vaultPath), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
  return decrypt(encrypted, dataPath);
}

export async function forgetPerplexityKey(vaultPath = VAULT_PATH) {
  await fs.rm(savedPerplexityKeyPath(vaultPath), { force: true });
}
