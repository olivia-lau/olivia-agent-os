# Olivia Agent OS — Local MVP

The app now also has a standalone desktop edition. On Windows, use the shareable Windows ZIP in `dist/`; it opens without the Codex desktop app. For a partner on Mac, use the separate source bundle and [Mac setup instructions](MAC_SETUP.md). Each person chooses their own vault and uses their own agent accounts. See [desktop architecture](STANDALONE_ARCHITECTURE.md) for the isolation and current limits.

From version 0.2.4, first-run setup can link a GitHub repository containing an Obsidian vault. The app reads and writes a local clone; pull and publishing Agent OS notes are separate manual actions on the Knowledge page. This `olivia-agent-os` repository is the **app's code and releases**, not the partner's Obsidian backend. He should link his own vault repository. See [Mac setup](MAC_SETUP.md) for private-repository and safe-sync steps.

A local-first execution console for choosing an agent and giving it a natural-language task. Its primary job is to perform work in the selected workspace. Obsidian provides optional context and records completed work by default.

The complete MVP also requires goal intake, multi-agent orchestration, scoped context assembly, model/worker routing, executable verification, durable approvals, run journaling, and a unified run dashboard. See `BUILD_STATUS.md` for the corrected scope.

## Start it

Double-click `start.cmd`. The first launch installs the small set of required components, then opens:

`http://127.0.0.1:4310`

Keep the command window open while using the dashboard. Closing it stops the local app; it does not affect Obsidian or the vault.

## Use it like an agent box

1. Open **Tasks**.
2. Type a prompt in the Codex, Claude Code, or Perplexity box.
3. Press its arrow button or Ctrl+Enter.
4. The selected agent starts directly. Choose **Multiagent task** to prepare a coordinated team run.
5. Codex and Claude Code can execute in the workspace; Perplexity provides current-information research when an API key is configured. Results and exposed progress appear in the dashboard.
6. If the command looks consequential, it pauses for confirmation. Ordinary work begins immediately.
7. Successful direct runs create an Obsidian record by default, including the prompt, response, agent, and linked images. Multiagent research runs create a review-labeled record; promotion into curated knowledge still requires approval. **Workspace and memory settings** can turn recording off for a task.
8. If a result is wrong, choose **Correct output · teach future agents** on that task. Explain the error, the behavior you want next time, and when it applies. The correction is saved as a new Obsidian note and brought into future matching runs.

Each agent box has a usage meter. Codex shows the most constrained account window reported by its local app-server and refreshes about once a minute. Claude Code and Perplexity show an unknown state when this app cannot read an authenticated account-usage feed; an empty bar is not a claim that their allowance is exhausted. The Perplexity box links to its API console Billing page, where an admin can see remaining API credit balance. A Perplexity API key does not provide that balance to this dashboard; its separate Enterprise Analytics API reports historical usage, not remaining credit balance. Perplexity website subscription limits and API credits are different things.

Open **Agent connections** below the three prompt boxes to check or refresh sign-in status. If Codex or Claude Code is already signed in, the button says **Already connected**; no login page is necessary. Otherwise its sign-in button opens a visible terminal window so you can follow the browser link or on-screen instructions, then press **Refresh status**. The dashboard never asks for those passwords. Perplexity uses an API key rather than the Perplexity website login. A key entered here is saved as AES-256-GCM encrypted text in the selected vault's `00 System/Connections/Perplexity API Key.encrypted.txt` and restored on dashboard restart on this computer. The decryption key remains outside the vault: in `agent-os/data/secrets` for the browser edition, or in the selected vault's local desktop profile for the desktop edition. A vault copy alone cannot reveal the API key. The API key is not stored in plaintext or in run records. The adjacent Obsidian note explains the connection. **Forget saved key** removes the encrypted copy. A key is marked as set, not verified, until the first Perplexity request succeeds.

The **Multiagent task** accordion runs a research/analysis/synthesis/review workflow. It requires plan review and is not yet a multiagent computer-action executor.

## What works

- Execute natural-language commands immediately through the selected ready provider.
- Route code and computer work to Codex, writing to Claude Code, and current research to Perplexity when each is connected.
- Save checkpoints and hand off on recognized context, usage, timeout, or provider-limit failures when another connected provider is ready. A handoff cannot continue if no suitable provider remains.
- Show live provider-exposed progress, tool actions, and response text. Hidden internal reasoning is not available through provider CLIs/APIs.
- Store user corrections as separate, reviewable Obsidian notes and supply relevant lessons to future agents without changing model weights or overwriting earlier notes.
- Require confirmation only for commands that may delete, send, publish, install, purchase, deploy, or otherwise have consequential side effects.
- Keep Obsidian knowledge optional and record execution history by default without making vault updates the execution goal.
- Create deep multi-agent goals with category and privacy scope when explicitly selected.
- Review a four-step OMA task graph before agents start.
- Assemble bounded vault context with source IDs, provenance, and a content hash.
- Run research and analysis in parallel, then synthesize and independently review.
- Verify required structure, substance, source references, and reviewer verdict.
- Require hash-bound approval before the multiagent research run and before promoting its output to curated knowledge; its review-labeled run record is saved automatically.
- Inspect task status, included sources, recent events, verification, and worker performance.
- Retain run records, append-only events, evidence, final output, and reviews locally.
- Use a Codex-style workspace with three agent boxes, a separate multiagent accordion, linked run files, and a right-side tabbed preview for images, PDFs, Markdown, code, and text.
- Search all Markdown notes across categories and projects.
- Filter by the current top-level vault categories.
- Preview the original Markdown without changing it.
- Review agent proposals and approve or reject them.
- Save approved proposals as new notes under `90 Agent OS Inbox`.
- Connect compatible local agents through a read/search/propose MCP server.

## Agent tools

Run the MCP server with:

```text
npm run mcp
```

It exposes:

- `search_vault`
- `read_note`
- `read_os_build_reference`
- `list_categories`
- `list_recent_notes`
- `refresh_vault_index`
- `propose_note`
- `list_proposals`
- `create_goal_run`
- `list_goal_runs`
- `get_goal_run`
- `execute_command`
- `list_execution_providers`

The server intentionally has no delete, move, direct-write, or approval tool. Agent clients can prepare a run, but only Olivia can approve its plan and output in Mission Control.

## MCP configuration

Use Node as the command and the absolute path to `src/mcp.mjs` as its argument. Set `OLIVIA_VAULT_PATH` only if the vault moves away from its current sibling folder.

## Checks

```text
npm run check
```

See `ARCHITECTURE.md` for system boundaries and `BUILD_STATUS.md` for what is complete versus deliberately deferred from the later production build.
See `DESIGN_SYSTEM.md` for the interface tokens and reusable shell, composer, run, file-link, and preview patterns.
