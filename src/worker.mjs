import { spawn } from 'node:child_process';
import { AGENT_MODE, AGENT_TIMEOUT_MS } from './config.mjs';
import { resolveCodexCommand } from './codex-command.mjs';

const role = process.argv[2] || 'worker';
const input = await new Promise((resolve, reject) => {
  const chunks = [];
  process.stdin.on('data', chunk => chunks.push(chunk));
  process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  process.stdin.on('error', reject);
});

function mockOutput() {
  const source = input.match(/SOURCE\s+(vault-\d+)/i)?.[1] || 'vault-1';
  if (role === 'reviewer') {
    return `# Review\n\n## Summary\nThe deliverable follows the requested structure.\n\n## Evidence\nThe recommendation is tied to supplied context.\n\n## Issues\nNone blocking in mock mode.\n\n## Verdict\nVERDICT: SHIP`;
  }
  if (role === 'researcher') return `# Research findings\n\n- Located relevant evidence in ${source}.\n- Distinguished known facts from open questions.\n- External research is intentionally simulated in mock mode.`;
  if (role === 'analyst') return `# Independent analysis\n\nThe primary trade-off is completeness versus complexity. Start with the smallest complete control loop, preserve boundaries, and measure where the system actually fails.`;
  return `# Summary\n\nThe evidence supports a bounded, reviewable next action that preserves the existing source of truth.\n\n# Evidence\n\nThe supplied vault context, including ${source}, was considered alongside the independent research and analysis outputs.\n\n# Analysis\n\nThe strongest approach is the one that completes the full workflow while keeping infrastructure replaceable. It should record provenance, expose uncertainty, and avoid silent writes.\n\n# Recommendation\n\nProceed with the proposed action as a reviewed change. Keep the initial execution local, measure task success, and expand providers only when the workflow demonstrates a need.\n\n# Risks\n\nThe main risks are weak source coverage, over-broad context, and mistaking successful execution for semantic correctness. Human approval remains required.\n\n# Sources\n\n- ${source}: supplied Obsidian context\n- Specialist research and analysis task outputs`;
}

if (AGENT_MODE === 'mock') {
  process.stdout.write(mockOutput());
  process.exit(0);
}

const args = [
  'exec',
  '--ephemeral',
  '--skip-git-repo-check',
  '--ignore-rules',
  '--sandbox', 'read-only',
  '--color', 'never',
  '-'
];

const child = spawn(resolveCodexCommand(), args, { cwd: process.cwd(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
const stdout = [];
const stderr = [];
const timer = setTimeout(() => child.kill(), AGENT_TIMEOUT_MS);
child.stdout.on('data', chunk => stdout.push(chunk));
child.stderr.on('data', chunk => stderr.push(chunk));
child.on('error', error => {
  clearTimeout(timer);
  process.stderr.write(error.message);
  process.exit(1);
});
child.on('close', code => {
  clearTimeout(timer);
  if (code === 0) {
    process.stdout.write(Buffer.concat(stdout));
    process.exit(0);
  }
  process.stderr.write(Buffer.concat(stderr));
  process.exit(code || 1);
});
child.stdin.end(input);
