import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export function githubRepoId(value) {
  const input = String(value || '').trim();
  let owner;
  let repo;
  if (input.startsWith('git@github.com:')) {
    const match = input.match(/^git@github\.com:([^/]+)\/([^/]+)\/?$/i);
    if (match) [, owner, repo] = match;
  } else {
    let url;
    try { url = new URL(input); } catch {}
    if (url?.protocol === 'https:' && url.hostname.toLowerCase() === 'github.com' && !url.username && !url.password && !url.search && !url.hash && !url.port) {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length === 2) [owner, repo] = parts;
    }
  }
  repo = repo?.replace(/\.git$/i, '');
  if (!owner || !repo || !/^[A-Za-z0-9-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo) || repo === '.' || repo === '..') {
    throw new Error('Enter a GitHub repository URL such as https://github.com/name/obsidian-vault. Do not include a token in the URL.');
  }
  return `${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

async function git(args, cwd, timeout = 30000) {
  try {
    const { stdout } = await execute('git', args, {
      cwd, encoding: 'utf8', timeout, maxBuffer: 2_000_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
      windowsHide: true
    });
    return stdout.trim();
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Git is not installed. Install Git or GitHub Desktop on this computer first.');
    throw new Error(`Git could not complete this action. ${String(error.stderr || error.message || '').trim().slice(0, 400)}`);
  }
}

function inside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export async function prepareGithubVault({ repoUrl, existingFolder = '', managedRoot }) {
  const repoId = githubRepoId(repoUrl);
  const destination = existingFolder
    ? path.resolve(existingFolder)
    : path.join(managedRoot, crypto.createHash('sha256').update(repoId).digest('hex').slice(0, 16));
  if (!existingFolder && !fs.existsSync(destination)) {
    fs.mkdirSync(managedRoot, { recursive: true });
    try { await git(['clone', '--', repoUrl.trim(), destination], managedRoot, 120000); }
    catch (error) { throw new Error(`${error.message} For a private repository, sign in with GitHub Desktop, clone it there, then choose that folder in Agent OS.`); }
  }
  if (!fs.existsSync(destination) || !fs.statSync(destination).isDirectory()) throw new Error('Choose an existing local clone of that GitHub repository.');
  const root = path.resolve(await git(['rev-parse', '--show-toplevel'], destination));
  if (root !== destination) throw new Error('Choose the root folder of the GitHub clone, not a folder inside it.');
  const actualId = githubRepoId(await git(['config', '--get', 'remote.origin.url'], root));
  if (actualId !== repoId) throw new Error('The selected folder is connected to a different GitHub repository. No files were changed.');
  await verifyGithubVaultAccess(root, repoId);
  return { repoId, repoRoot: root, vaultPath: root };
}

export async function verifyGithubVaultAccess(repoRoot, repoId) {
  const status = await githubVaultStatus(repoRoot, repoId);
  try {
    await git(['ls-remote', '--exit-code', 'origin', 'HEAD'], repoRoot, 30000);
  } catch (error) {
    throw new Error(`Could not verify live access to ${repoId}. ${error.message} Sign in to the GitHub account that can access this repository, then retry. For a private vault, cloning it in GitHub Desktop and choosing that clone is the simplest route.`);
  }
  return { ...status, remoteVerifiedAt: new Date().toISOString(), message: `Verified live GitHub access to ${repoId}.` };
}

export async function githubVaultStatus(repoRoot, repoId) {
  const actualId = githubRepoId(await git(['config', '--get', 'remote.origin.url'], repoRoot));
  if (actualId !== repoId) throw new Error('The GitHub remote no longer matches the linked repository.');
  const branch = await git(['branch', '--show-current'], repoRoot);
  if (!branch) throw new Error('The GitHub vault is on a detached commit. Select a branch in GitHub Desktop first.');
  const changes = await git(['status', '--porcelain', '--untracked-files=all'], repoRoot);
  return { type: 'github', repoId, branch, localChanges: changes ? changes.split(/\r?\n/).length : 0, repoRoot };
}

export async function pullGithubVault(repoRoot, repoId) {
  const status = await githubVaultStatus(repoRoot, repoId);
  if (status.localChanges) throw new Error('This vault has local changes. Commit or discard them in GitHub Desktop before pulling; Agent OS will not overwrite them.');
  await git(['pull', '--ff-only', 'origin', status.branch], repoRoot, 120000);
  return { ...await githubVaultStatus(repoRoot, repoId), message: 'Vault updated from GitHub without overwriting local changes.' };
}

export async function publishAgentNotes(repoRoot, repoId, paths) {
  const status = await githubVaultStatus(repoRoot, repoId);
  if (await git(['diff', '--cached', '--name-only'], repoRoot)) throw new Error('Other changes are already staged in Git. Review them in GitHub Desktop before publishing Agent OS notes.');
  await git(['fetch', 'origin', status.branch], repoRoot, 120000);
  const remoteAhead = Number(await git(['rev-list', '--count', 'HEAD..FETCH_HEAD'], repoRoot));
  const localAhead = Number(await git(['rev-list', '--count', 'FETCH_HEAD..HEAD'], repoRoot));
  if (remoteAhead || localAhead) throw new Error('The GitHub branch has unmerged or unpublished commits. Sync it in GitHub Desktop first; Agent OS will not force a push.');
  const safePaths = [...new Set(paths.map(value => path.resolve(value)).filter(value => inside(repoRoot, value) && fs.existsSync(value) && fs.statSync(value).isFile()))];
  for (const absolute of safePaths) await git(['add', '--', path.relative(repoRoot, absolute)], repoRoot);
  const staged = await git(['diff', '--cached', '--name-only'], repoRoot);
  if (!staged) return { ...status, published: 0, message: 'No new Agent OS notes to publish.' };
  await git(['commit', '-m', 'Agent OS: publish notes'], repoRoot, 120000);
  await git(['push', 'origin', `HEAD:${status.branch}`], repoRoot, 120000);
  return { ...await githubVaultStatus(repoRoot, repoId), published: staged.split(/\r?\n/).length, message: 'Agent OS notes published to GitHub.' };
}
