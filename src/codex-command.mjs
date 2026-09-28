import fs from 'node:fs';
import path from 'node:path';

// Codex Desktop installs its CLI under LocalAppData on Windows, which is not
// always present in the PATH inherited by a newly opened terminal window.
export function resolveCodexCommand(env = process.env) {
  if (process.platform !== 'win32') {
    const fromPath = resolveFromPath('codex', env);
    if (fromPath !== 'codex') return fromPath;
    if (process.platform === 'darwin') {
      const appBundle = '/Applications/Codex.app/Contents/Resources/codex';
      try {
        fs.accessSync(appBundle, fs.constants.X_OK);
        return appBundle;
      } catch {}
    }
    return fromPath;
  }
  if (!env.LOCALAPPDATA) return 'codex';
  const root = path.join(env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin');
  try {
    const versions = fs.readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()
      .reverse();
    for (const version of versions) {
      const candidate = path.join(root, version, 'codex.exe');
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {}
  return 'codex';
}

function resolveFromPath(name, env) {
  for (const directory of String(env.PATH || '').split(path.delimiter)) {
    if (!directory || !path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, name);
    try {
      if (fs.statSync(candidate).isFile()) {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      }
    } catch {}
  }
  return name;
}

export function resolveClaudeCommand(env = process.env) {
  return process.platform === 'win32' ? 'claude' : resolveFromPath('claude', env);
}
