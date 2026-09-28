# Build Agent OS for a Mac

This source bundle is the shareable app code only. It does not include Olivia's vault, conversations, run history, or API keys.

For the Endura Mac, Codex runs as the **Codex CLI through VS Code**, not the Codex desktop app. Agent OS uses that same local CLI login; installing the Codex desktop app is not required.

1. On the Mac, install current Node.js (version 22 or newer) and npm.
2. Unzip this bundle to a normal folder, open Terminal there, and run `npm ci`.
3. Run `npm run desktop` to launch and test the app.
4. On first launch, enter a workspace name and choose **your own Obsidian vault**. Choose **Local Obsidian vault** for a folder on the Mac, or **GitHub repository** for a GitHub-backed vault. No vault is copied from Olivia.
5. Install and sign in to the Codex and/or Claude Code CLIs on that Mac if you want those agents to execute tasks. If Agent connections says a CLI is missing, choose its **Open install guide** link, complete the official installation in Terminal, then return and select **Refresh status**. The guide link does not automatically install software. "Signed in" means a stored CLI credential exists, not that a prompt has been tested. The **Sign out** controls sign out the machine-wide CLI too; use them only if you need to change accounts. Enter your own Perplexity API key if you use Perplexity.
6. To build a macOS app ZIP on that Mac, run `npm run build:mac`. The output appears in `dist/`.

## Mac acceptance check

Before sharing the Mac app as ready, run `npm run check` and then `npm run desktop` on the Mac. Choose the partner's vault. Confirm the Knowledge page indexes its Markdown notes. In Agent connections, confirm each installed CLI is detected; start Codex and Claude sign-in from the app if needed, follow the Terminal window, and refresh status. Run one small task with a signed-in agent and confirm its result and Obsidian record. Test **Add files**, **Add folder**, **New topic**, and reopening a conversation from the sidebar; verify that an unsaved upload is absent from the vault and that **Save to vault** copies only the chosen file. Then run `npm run build:mac`, open the app from the resulting ZIP, and repeat the connection and small-task checks in the packaged app.

The desktop app checks the same interactive-shell PATH that Terminal uses, before its own inherited app PATH. macOS may ask permission the first time Agent OS opens Terminal for sign-in; allow it for that flow. If Terminal shows `Logged in using ChatGPT` from `codex login status` but the dashboard does not show Codex as signed in, fully quit and reopen Agent OS, then choose **Refresh status**. The Codex card now shows the exact CLI path and status response that the dashboard checked; share those two lines when reporting a mismatch. You do not need to reinstall Codex or sign in again when Terminal already reports a login.

If Codex reports that its configured model is not supported with the Mac's ChatGPT account, open Codex in Terminal and use `/model` to see models offered to that account. Enter one of those exact model names in **Agent connections → Codex → Model override**, then retry the task. The override is stored in this Mac's Agent OS profile; it does not edit the global Codex configuration. Alternatively, change the model directly in Codex's `/model` menu and leave the override blank. If a task reports an expired `openseo-selfhost` or other MCP connector, reauthorize that connector from `/mcp` inside the native agent CLI. Agent sign-in and connector sign-in are separate.

By default, each prompt uses the selected Obsidian vault as its first knowledge source. With a GitHub-backed vault, this means the local clone, so choose **Pull from GitHub** on the Knowledge page if you need newer remote changes before asking. Agent OS grants Codex and Claude Code access to the vault for unrestricted knowledge searches; if you disable private notes or select specific categories, the app passes only scoped excerpts instead. If a requested article is not in the selected vault, the agent should say so rather than silently search Google Drive.

## Use a GitHub repository as the Obsidian backend

Version 0.2.9 lets a person enter a GitHub repository URL during first-run setup or through **Agent OS → Change vault or GitHub repo…**. The repository root must contain the Obsidian Markdown notes. Agent OS uses a local clone for fast, offline reads and writes; the GitHub repository is its remote copy.

For a private repository, the reliable route is to sign in to GitHub Desktop on the Mac, clone **your own** vault repository there, then enter its URL and choose that local clone in Agent OS. A public repository, or a private repository already authenticated for Git on the Mac, can also be cloned by Agent OS from the URL. Do not put a personal access token in the repository URL.

In setup, choose **Verify GitHub access** before opening the app. Agent OS confirms both that the chosen clone points to the named repository and that command-line Git can read its live remote. This is a read-only check; it does not upload or pull vault notes. You can repeat it later from **Knowledge → Verify access**. If GitHub Desktop itself can access a private repository but verification still fails, the Mac's command-line Git may need its own credential helper or SSH authentication. Agent OS does not perform GitHub OAuth inside its window or store a GitHub token. The final **Open Agent OS** action repeats the access check, so a failed or stale connection is not saved as linked.

The Mac must also have the `git` command available. Check with `git --version` in Terminal; if it is missing, install Apple's Command Line Tools or another trusted Git distribution before linking the repository.

On the Knowledge page, **Pull from GitHub** updates the clone only when it has no local changes. **Publish Agent OS notes** commits and pushes only notes and linked images created by Agent OS, after checking that the branch has no unseen remote or local commits. These actions are manual; the app never force-pushes, silently overwrites local files, or automatically uploads the rest of the vault. Use GitHub Desktop to review and resolve ordinary Obsidian edits or Git conflicts. If a push fails after a commit, the local commit remains; resolve it in GitHub Desktop before retrying.

For the Mac acceptance check, first confirm the repository appears on Knowledge, search for a note from it, run a small task, then use **Publish Agent OS notes** and verify that new note appears in the intended GitHub repository. Make a harmless remote test note, pull it into the clean local clone, and confirm it appears in Knowledge. Do not test with sensitive personal notes.

The macOS build must be tested on the Mac. This project does not produce a signed or notarized installer, so macOS may ask you to approve opening a locally built app. Never copy Olivia's `vault`, `data`, or operating-system Agent OS profile into the Mac build.
