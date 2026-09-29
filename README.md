# Olivia Agent OS — Local MVP

The app now also has a standalone desktop edition. On Windows, use the shareable Windows ZIP in `dist/`; it opens without the Codex desktop app. For a partner on Mac, use the separate source bundle and [Mac setup instructions](MAC_SETUP.md). Each person chooses their own vault and uses their own agent accounts. See [desktop architecture](STANDALONE_ARCHITECTURE.md) for the isolation and current limits.

From version 0.2.4, first-run setup can link a GitHub repository containing an Obsidian vault. The app reads and writes a local clone; pull and publishing Agent OS notes are separate manual actions on the Knowledge page. This `olivia-agent-os` repository is the **app's code and releases**, not the partner's Obsidian backend. He should link his own vault repository. See [Mac setup](MAC_SETUP.md) for private-repository and safe-sync steps.

A local-first execution console for choosing an agent and giving it a natural-language task. Its primary job is to perform work in the selected workspace. Obsidian provides optional context and records completed work by default.

## Projects, conversations, attachments, and model settings (v0.2.18)

The left sidebar now groups separate conversations under each project. **New project** creates a project with its first conversation; **New conversation** starts a clean chat inside the selected project. Rename either independently. A conversation continues with up to four recent completed turns and a short digest of older turns; other conversations in the same project do not enter that context unless explicitly chosen as a read-only reference. Existing topics migrate into separate projects with their original chat IDs, attachments, and history preserved; a copy of the old thread index is kept as `threads.pre-projects.json` in the local Agent OS data profile. Imported chat archives remain available through Obsidian knowledge search. The **What the agent will receive** panel previews the scope. A follow-up waits until the prior task in that conversation finishes.

Each agent box has its own model and effort controls. Blank model or effort uses that CLI's default. Codex and Claude Code pass the selection to their CLIs for that task; the available values depend on the signed-in account. Perplexity offers an Agent API preset/depth plus optional model and reasoning effort; this uses API billing, not website subscription usage. An agent handoff uses the recipient agent's settings from the same task. These choices do not edit the provider's global configuration.

The Codex box also has a model picker populated from the Codex CLI installed on that computer. It shows Astra when that installation and account expose it, and adjusts the effort options for the chosen model. The Model ID field remains available as a manual fallback when an older CLI cannot return a catalog. If Astra says it requires a newer Codex version, update the CLI itself; updating Agent OS does not update Codex.

The Claude Code box has its own separate model dropdown for CLI default, Sonnet, Opus, or Haiku. Choose **Other model ID** for a custom or provider-specific model. Unlike Codex's live local catalog, these are Claude Code aliases, so availability is confirmed only when a task runs.

Use **Add files**, **Add folder**, or drag and drop. Uploaded files are stored in this machine's private Agent OS profile, not the Obsidian vault. Select which files to use in each prompt. Codex and Claude receive local paths and access to those files; the Perplexity API connection cannot read local attachments and will reject a request that selects them. A handoff keeps the same attachments. Limits are 25 MB per file, 100 MB and 100 files per conversation. **Save to vault** makes an explicit local Obsidian copy. For a GitHub-backed vault, that copy is not uploaded until **Publish Agent OS notes** is chosen. Deleting an unsaved local attachment removes its local copy. The separate Multiagent task flow remains run-based and does not yet use conversation attachments.

You can paste a screenshot or copied image directly into a Codex or Claude prompt, or click the **Reference files** box and paste there (Ctrl+V on Windows, Command+V on Mac). It becomes a selected local file chip in that conversation, ready for the next prompt. Pasting normal text into a prompt still inserts text. The Perplexity connection cannot consume local images, so image paste in its prompt shows a warning and does not create an attachment.

File actions now use two clicks instead of a system confirmation popup, so focus stays in the dashboard. After a task, select text in its Result and copy normally, or use **Copy selection or full result**. If a prompt cannot start, the error remains beneath that agent's box.

### Open the current source in Codex on this computer

If the live dashboard is already running, open `http://127.0.0.1:4311/` in a Codex browser tab; `npm run codex:live` will confirm that it is running rather than trying to start a duplicate. If it is not running, finish any desktop Agent OS tasks, close the standalone window, and run `npm run codex:live` from this project folder. This mode uses the same vault, projects, task history, and agent credentials as the standalone app, but must not run concurrently with it. The source server watches code changes, so future dashboard changes are available after a page refresh or automatic server restart without downloading another ZIP. Keep its terminal running while using the dashboard. The Mac partner continues using their own profile and vault.

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
