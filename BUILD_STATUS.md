# Olivia's Agent Switch — Build Status

Last checked: 2026-09-26. The human-readable Obsidian handoff for other agents is `vault/00 System/Olivia Agent OS - Start Here.md`, with the detailed build reference linked there.

## Definition of done

The local Agent OS MVP is execution-first. Olivia can speak or type one command and observe this loop:

```text
Command
  → instant task classification and provider routing
  → direct execution in the selected workspace
  → checkpoint and cross-agent handoff if a limit is reached
  → verification and visible result
  → optional Obsidian memory proposal
  → replayable run journal, performance, and status
```

The Obsidian vault is one context source and one output destination inside this loop.

## System boundaries

| Layer | MVP responsibility | Planned implementation | Current state |
|---|---|---|---|
| Command intake | Type or dictate a natural-language command | Unified dashboard | Built |
| Fast execution | Use one best-fit agent by default | Codex/Claude/Perplexity router | Built; Codex ready now |
| Handoff | Continue from checkpoint when an agent reaches a context, usage, timeout, or provider limit | Durable checkpoint + alternate provider/fresh session | Built |
| Selective approval | Run ordinary work immediately; pause potentially consequential commands | Risk classifier + dashboard confirmation | Built |
| Orchestration | Plan a task graph, dispatch specialists, combine results | OMA | Built; explicit four-task DAG |
| Agent adapters | Codex, Claude Code, and Perplexity | Direct process/API adapters | Codex ready; Claude installed but signed out; Perplexity awaits credentials |
| Context broker | Assemble only relevant permitted context | Policy layer + Knowledge Adapter | Built; bounded, hashed, source-attributed packets |
| Knowledge | Read/search Obsidian and propose controlled writes | Current Knowledge Adapter | Built |
| Verification | Execute deterministic checks and independent review | Windows-native verifier; Ringer later | Built |
| Model gateway | Provider routing, fallback, budgets, and cost | LiteLLM | Deferred; not needed for the single-provider MVP |
| Approvals | Suspend consequential actions and resume after review | Selective execution confirmation; deep-run hash approvals | Built |
| Eventing | Record task/run/approval lifecycle events | Durable local JSONL; NATS later | Built |
| Observability | Task graph, status, evidence, journal, and performance | Unified Mission Control | Built |
| Remote infrastructure | Sync and operate while the primary PC is off | CouchDB/LiveSync, Caddy, containers | Deferred until local workflow is proven |

## First complete workflow

Input: “Research a topic, inspect the relevant local material, and write a cited decision memo.”

1. OMA accepts the goal and produces a task graph.
2. The context broker searches the vault and creates scoped packets.
3. A research worker gathers current external evidence.
4. A Codex worker inspects local files or technical implications.
5. A synthesis worker reconciles both outputs and names conflicts.
6. Verification checks citations, required sections, file shape, and any executable assertions.
7. The run suspends with the proposed decision memo and exact destination.
8. Olivia approves or rejects it in the dashboard.
9. Approval writes the memo and closes the run.
10. The run remains replayable with inputs, context provenance, outputs, checks, decisions, and cost.

## Deliberately deferred from the production plan

These are expansion layers, not missing pieces of the local MVP:

1. Ringer as an additional verifier after WSL and Python 3.12 are intentionally installed.
2. LiteLLM for request-level model and price routing after multiple API-key models are active.
3. Sign in to Claude Code and add a Perplexity credential to make those existing routes live.
4. Connect an image-generation API or host bridge so visual prompts can render images directly from the dashboard; the signed-in Codex CLI does not expose that renderer.
5. CouchDB/LiveSync, containers, Caddy, NATS, Postgres/pgvector, and remote monitoring when off-PC or multi-user operation becomes necessary.
6. Semantic search if lexical vault retrieval proves insufficient in normal use.

## Current machine constraints

- Node.js 24 and the Codex CLI are available.
- Docker is not installed.
- WSL is not installed.
- System Python is 3.11; Ringer currently requires Python 3.12 and Windows via WSL.
- No OpenAI, Anthropic, or Perplexity API-key environment variables are currently configured.

These constraints do not affect the completed local MVP. They prevent claiming that the later production container stack, Ringer, multi-provider routing, and off-PC operation are active today.

## Validation completed

- Router, handoff detection, knowledge policy, verification, vault safety, and the deep governed workflow have automated coverage.
- A live isolated worker returned the required response through the authenticated Codex CLI.
- The local dashboard indexed 1,654 existing vault notes without rewriting them.
- No live four-worker goal was launched automatically; Olivia retains the first plan approval and control over usage.

## Recent MVP additions and usage visibility

- Three individual agent prompt boxes, an optional multiagent accordion, connected-provider status, and a credential-safe **Agent connections** section are in the dashboard.
- Codex remaining usage comes from its authenticated local usage windows. Claude Code remaining usage is unavailable to this dashboard.
- Perplexity currently uses the Sonar API for research, not the Perplexity Computer app. Its API key can run research but does not expose remaining API credit balance here. The dashboard leaves the number unknown and links to the API console Billing page. The documented Enterprise Analytics API gives historical usage, not remaining balance.
- Completed direct runs are recorded to Obsidian by default, with a task-level opt-out. Human corrections create separate private vault notes and are retrieved selectively for future similar work.
- The dashboard indexed 1,659 notes on 2026-09-26 after the two new OS reference notes were added; this count will change as the vault grows.
