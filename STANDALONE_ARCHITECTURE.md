# Agent OS desktop edition — design and handoff

## Purpose

Give each person an independent, local desktop Agent OS with the same task dashboard, provider handoff, and Obsidian-backed knowledge. The dashboard's primary purpose remains executing tasks; Obsidian recording is a default follow-up. Olivia and her partner must not share credentials, private vault notes, or run history merely because they share the app installer.

## Current architecture

```text
Windows or macOS desktop app
  ├─ First-run setup: choose vault + workspace name
  ├─ Local dashboard window (Electron, no browser extension required)
  └─ Private local service (127.0.0.1, random port)
       ├─ Agent connectors: Codex CLI / Claude Code CLI / Perplexity API
       ├─ Router + checkpointed handoff
       ├─ Obsidian Markdown index and memory writer → selected vault
       └─ Run history + encrypted-key master → this person's local profile
```

The desktop shell starts the existing service inside the app process, then opens its loopback-only dashboard. The web dashboard remains available for Olivia's current setup. The desktop program does not require Codex's UI to be open, but executing through Codex or Claude Code does require their separately installed, signed-in local CLI tools. Perplexity requires the user's own API key. A login to the provider's website alone is not necessarily a usable API or CLI connection.

## Per-person isolation

- First launch asks for an existing Obsidian vault; the selection is stored in that operating-system user's Agent OS settings.
- Local runs, checkpoints, workspace files, and the decryption master key live in a profile directory derived from the selected vault path. Changing vaults changes profiles.
- Perplexity's encrypted key text is written only to the selected vault; its master key stays in the local profile. Neither appears in the shareable source archive or Windows build.
- Codex and Claude sessions remain in those providers' own OS-user accounts. The app never asks for their passwords.
- A Mac partner can choose his own vault and authenticate his own providers without importing Olivia's notes or accounts.

## GitHub-backed vault option (0.2.4)

A person may link a GitHub repository containing their Obsidian vault. Agent OS validates the exact GitHub remote and indexes a local clone, preserving the existing filesystem-based vault behavior. Private repositories can be cloned with GitHub Desktop and selected during setup; Git credentials are never stored by Agent OS. Manual pull requires a clean clone and fast-forward only. Manual publish stages only recorded Agent OS notes, corrections, approved proposals, and linked run images; it refuses to include pre-staged files, force-push, or bypass diverged branches. All other vault edits remain for GitHub Desktop to review and sync. Remote sync is not automatic, and the Mac path still requires an actual Mac acceptance test.

## Handoff visibility

Every task with a provider switch gets a persistent amber handoff callout showing source, destination, reason, and whether it was a simulation. The newest handoff also appears in a top banner with a direct link to the task. The banner can be dismissed; the task record remains.

## Safety and limitations

- The local service binds only to loopback and uses a random port for desktop runs. Mutating requests check the actual local port as their origin.
- Electron keeps Node integration off, context isolation on, sandboxing on, and the setup bridge limited to choosing a folder and saving setup. New windows and remote navigation are blocked; HTTPS links open in the system browser.
- Packaging explicitly includes source and public app files, not the vault, local data, run history, or secrets.
- A provider switch requires a usable alternate provider. Usage or context failures can interrupt work that cannot safely be resumed automatically; the dashboard must show the resulting failure, not claim success.
- The app reports only provider-exposed progress, not private hidden reasoning.
- This is a local, single-user desktop build, not a cloud sync or shared multi-user database. Vault selection is not a permission boundary against an agent explicitly granted file-system access by the user.

## Platform delivery

The Windows ZIP is built and tested on Windows. A Mac source ZIP is provided for building and testing the macOS app on a Mac. A signed/notarized Mac installer is not produced here; distributing one later requires a Mac build environment, Apple signing credentials, and release testing. No Olivia-specific vault or secret belongs in either artifact.

For macOS, the desktop process reads the user's interactive shell PATH before starting provider detection. The CLI login buttons open Terminal through AppleScript with properly quoted commands. Agent OS waits for the terminal launcher to report success or failure and shows launch errors in the dashboard. These paths are statically checked on Windows; a Mac-side acceptance run is still required to verify Finder launch, Terminal permissions, provider authentication, and Obsidian writes.

## Next release decisions

1. Whether the partner needs only local Mac use or a signed installer for effortless sharing.
2. Whether to add multiple named profiles within one OS login rather than one selected vault at a time.
3. Whether to migrate Olivia's existing browser-dashboard run history into the desktop profile, with explicit review before any copy.
4. Whether the two users will ever share selected knowledge. If yes, design a separate consented export/sync process; do not merge vaults implicitly.
