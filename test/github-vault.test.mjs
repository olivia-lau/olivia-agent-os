import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { githubRepoId, githubVaultStatus, prepareGithubVault, pullGithubVault, publishAgentNotes } from '../src/github-vault.mjs';

test('accepts GitHub HTTPS and SSH URLs without accepting embedded credentials', () => {
  assert.equal(githubRepoId('https://github.com/Partner/Notes.git'), 'partner/notes');
  assert.equal(githubRepoId('git@github.com:Partner/Notes.git'), 'partner/notes');
  assert.throws(() => githubRepoId('https://token@github.com/Partner/Notes.git'), /Do not include a token/);
  assert.throws(() => githubRepoId('https://github.com/Partner/Notes/tree/main'), /repository URL/);
});

test('links only a matching GitHub clone and refuses to pull over local changes', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-os-github-test-'));
  try {
    execFileSync('git', ['init', folder], { stdio: 'ignore' });
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/partner/notes.git'], { cwd: folder, stdio: 'ignore' });
    const linked = await prepareGithubVault({ repoUrl: 'https://github.com/partner/notes', existingFolder: folder, managedRoot: path.join(folder, 'unused') });
    assert.equal(linked.repoRoot, folder);
    assert.equal(linked.repoId, 'partner/notes');
    await assert.rejects(prepareGithubVault({ repoUrl: 'https://github.com/partner/other', existingFolder: folder, managedRoot: path.join(folder, 'unused') }), /different GitHub repository/);
    fs.writeFileSync(path.join(folder, 'note.md'), '# Not published\n');
    const status = await githubVaultStatus(folder, 'partner/notes');
    assert.equal(status.localChanges, 1);
    await assert.rejects(pullGithubVault(folder, 'partner/notes'), /will not overwrite/);
    assert.equal(fs.readFileSync(path.join(folder, 'note.md'), 'utf8'), '# Not published\n');
    execFileSync('git', ['add', 'note.md'], { cwd: folder, stdio: 'ignore' });
    await assert.rejects(publishAgentNotes(folder, 'partner/notes', [path.join(folder, 'note.md')]), /already staged/);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('manual publish sends only Agent OS notes and pull fast-forwards a clean clone', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-os-github-flow-'));
  const run = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const remote = path.join(folder, 'remote.git');
  const seed = path.join(folder, 'seed');
  const vault = path.join(folder, 'vault');
  try {
    run(['init', '--bare', '--initial-branch=main', remote], folder);
    run(['init', '--initial-branch=main', seed], folder);
    run(['config', 'user.name', 'Agent OS Test'], seed);
    run(['config', 'user.email', 'agent-os-test@example.invalid'], seed);
    fs.writeFileSync(path.join(seed, 'start.md'), '# Start\n');
    run(['add', 'start.md'], seed);
    run(['commit', '-m', 'Start'], seed);
    run(['remote', 'add', 'origin', remote], seed);
    run(['push', '-u', 'origin', 'main'], seed);
    run(['clone', remote, vault], folder);
    run(['config', 'user.name', 'Agent OS Test'], vault);
    run(['config', 'user.email', 'agent-os-test@example.invalid'], vault);
    run(['remote', 'set-url', 'origin', 'https://github.com/partner/notes.git'], vault);
    run(['config', `url.${pathToFileURL(remote).href}.insteadOf`, 'https://github.com/partner/notes.git'], vault);
    const note = path.join(vault, '90 Agent OS Inbox', 'run.md');
    fs.mkdirSync(path.dirname(note), { recursive: true });
    fs.writeFileSync(note, '# Agent record\n');
    const unrelated = path.join(vault, 'private.md');
    fs.writeFileSync(unrelated, '# Not for this publish\n');
    const result = await publishAgentNotes(vault, 'partner/notes', [note]);
    assert.equal(result.published, 1);
    assert.equal(run(['show', 'main:90 Agent OS Inbox/run.md'], remote), '# Agent record');
    assert.throws(() => run(['show', 'main:private.md'], remote));
    fs.unlinkSync(unrelated);
    const remoteEditor = path.join(folder, 'remote-editor');
    run(['clone', remote, remoteEditor], folder);
    run(['config', 'user.name', 'Agent OS Test'], remoteEditor);
    run(['config', 'user.email', 'agent-os-test@example.invalid'], remoteEditor);
    fs.writeFileSync(path.join(remoteEditor, 'new-from-remote.md'), '# New\n');
    run(['add', 'new-from-remote.md'], remoteEditor);
    run(['commit', '-m', 'Remote note'], remoteEditor);
    run(['push', 'origin', 'main'], remoteEditor);
    await pullGithubVault(vault, 'partner/notes');
    assert.equal(fs.readFileSync(path.join(vault, 'new-from-remote.md'), 'utf8').replaceAll('\r\n', '\n'), '# New\n');
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
