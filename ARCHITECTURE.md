# Olivia Agent OS — Local MVP Architecture

## Outcome

The MVP implements a fast execution loop and keeps the governed team loop for deeper work:

```text
Command → route to best ready agent → execute → checkpoint/handoff if needed → result → optional Obsidian memory
```

Obsidian Markdown remains the canonical record. The Agent OS does not move, delete, or silently overwrite existing notes.

## Components

| Component | Responsibility |
|---|---|
| Obsidian vault | Human-readable source of truth |
| Vault index | Reads Markdown and frontmatter into memory for fast local search |
| Mission Control | Goal intake, task graph, context, verification, approval gates, and run history |
| Fast router | Classifies work and selects Codex, Claude Code, or Perplexity by capability and readiness |
| Direct executor | Runs one provider immediately in the selected workspace for low latency |
| Handoff controller | Detects limits, reads the last checkpoint, and continues with an alternate provider or fresh session |
| OMA orchestrator | Executes an explicit dependency graph with bounded parallelism |
| Codex workers | Ephemeral researcher, analyst, synthesizer, and reviewer processes |
| Context broker | Selects relevant notes and applies category, privacy, size, provenance, and hash controls |
| Native verifier | Checks output structure, substance, provenance, and reviewer verdict |
| MCP server | Gives compatible agents read/search/propose and plan-preparation tools |
| Proposal store | Holds drafts outside the vault until Olivia reviews them |
| Agent OS Inbox | Receives approved proposals as new Markdown notes |
| Run store | Persists runs, append-only events, evidence, artifacts, and performance locally |

## Data flow

1. The router classifies the command as code, computer, writing, research, or general work.
2. It chooses the best ready provider and falls back when the ideal provider is unavailable.
3. Ordinary tasks execute immediately in a workspace-write sandbox; high-risk language pauses for confirmation.
4. Long tasks maintain `handoff.md`. Context limits open a fresh session; provider limits select another ready provider.
5. The result appears directly in Mission Control.
6. Obsidian context is retrieved only when requested or relevant. Memory writes remain collision-safe review proposals.
7. Deep mode retains the reviewed four-agent DAG for work that benefits from independent analysis and verification.
8. Runs, routes, handoffs, events, source provenance, artifacts, checks, and worker performance remain locally inspectable.

## Safety boundaries

- Server binds to `127.0.0.1`, so it is not exposed to the local network or internet.
- Vault paths are resolved and checked against the configured vault root.
- The MCP exposes no delete, move, or direct-write tool.
- The MCP cannot approve plans or outputs.
- Workers run as ephemeral read-only processes and cannot modify the vault.
- Plan and output approvals are bound to hashes; changed content must be reviewed again.
- Existing Markdown is read-only.
- Proposals are limited in size and require explicit approval.
- Approved filenames are collision-safe.

## MVP trade-offs

The index is in memory rather than Postgres/pgvector. With roughly 1,600 notes and 12 MB of Markdown, this removes infrastructure while keeping search fast enough. Search is lexical rather than semantic. Durable state is stored as local JSON/JSONL because the MVP is single-user and loopback-only. Codex is the only live worker provider until multi-provider routing is worth its complexity.

## Relationship to the larger build plan

This is the complete local MVP, not the final production system. The larger plan adds remote availability, container infrastructure, provider routing, event middleware, a database/vector layer, and optional Ringer verification after the core workflow proves useful.

## Revisit after the workflow is useful

1. Add semantic embeddings when lexical search misses meaning often enough to be annoying.
2. Add CouchDB/LiveSync when access is needed while the primary computer is off.
3. Add agent-specific permissions before exposing the service remotely.
4. Add a durable database/event bus when concurrent users or remote automation require it.
5. Add provider budgets and fallback routing when more than Codex is connected.
