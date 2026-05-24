---
name: code-intel
description: Router for the three code-intelligence tools — vera (semantic search), codegraph (structural graph/call graphs over MCP), and graphify (whole-project knowledge graph spanning code + docs + schemas). Use when finding where logic lives, tracing callers/callees/impact, or getting oriented in an unfamiliar codebase. Picks the right layer (comprehend / locate / traverse) and defers to each tool's own skill, MCP server, or CLI for detailed usage.
---

# Code Intelligence

Three tools, three zoom levels. They are complementary, not competing — pick the layer that matches the question.

| Layer | Tool | Answers | Mechanism |
|---|---|---|---|
| **Comprehend** | graphify | "What *is* this project, how do the big pieces (incl. docs/schema) connect?" | Multimodal knowledge graph, snapshot |
| **Locate** | vera | "Where's the code about X?" when you don't know the symbol name | Embedding semantic search |
| **Traverse** | codegraph | "Who calls this? What does it call? Blast radius of a change?" | Structural call graph, live over MCP |

## When to reach for this at all

The stack earns its keep on **large, unfamiliar, or long-lived** codebases. On small or familiar code, LSP + grep are faster — don't index a 20-file repo. Default order on a big new repo: **comprehend once → locate → traverse** as you work.

## Routing

| You need to… | Use | How |
|---|---|---|
| Orient in an unfamiliar repo; map architecture and how code + docs + schema connect | **graphify** | `graphify .` then read `graphify-out/GRAPH_REPORT.md`, or `graphify query "<question>"` |
| Find where behavior lives without knowing the name | **vera** | `vera search "validates JWT expiry"` |
| Exact string, regex, import, or TODO | **vera** (or `rg`) | `vera grep "pattern"` |
| Trace who calls a symbol / what it calls | **codegraph** | MCP `codegraph_callers` / `codegraph_callees` (CLI: `codegraph callers <sym>`) |
| Assess the blast radius before changing a symbol | **codegraph** | MCP `codegraph_impact` (CLI: `codegraph impact <sym>`) |
| Build task context (entry points + related symbols, few calls) | **codegraph** | MCP `codegraph_context "<task>"` |

When codegraph's MCP tools are available, prefer them over re-deriving structure with grep — answer directly rather than delegating to file-reading sub-agents (that erases the savings).

## Per-tool detail

- **vera** — see the `vera` skill for full `search` / `grep` / `references` / `overview` flags. Index with `vera index .`, refresh with `vera update .`, or `vera watch .` for a session.
- **codegraph** — MCP tools: `codegraph_context`, `codegraph_search`, `codegraph_callers`, `codegraph_callees`, `codegraph_impact`, `codegraph_node`, `codegraph_files`, `codegraph_status`. Same verbs exist as CLI subcommands. Index with `codegraph init` + `codegraph index`; the file watcher auto-syncs while `serve --mcp` runs. 19+ languages (no shell/zsh).
- **graphify** — `graphify .` builds `graphify-out/` (graph.html, GRAPH_REPORT.md, graph.json). Query with `graphify query "…"`, `graphify path "A" "B"`, `graphify explain "Symbol"`. Building the graph needs a model backend (the IDE session provides one; headless needs an API key). The `/graphify` slash command wraps the same thing.

## Overlap — which wins

- **Structural references:** codegraph beats `vera references` (true call edges vs. embedding-derived). Use codegraph to traverse.
- **Semantic search:** vera is the only one that finds code by *meaning*. That's its unique slice.
- **Non-code:** graphify is the only one that maps docs, schemas, and infra alongside code.

## Setup per project

Indexes are built on demand, not at install. The `code-intel` helper drives all three at once:

```sh
code-intel init       # build all three indexes (+ graphify commit hook)
code-intel refresh    # update them after edits
code-intel status     # show index state per tool
```

Or per tool: `vera index .` / `vera update .` (or `vera watch .` for live freshness); `codegraph init` + `codegraph index` / `codegraph sync` (auto-syncs while its MCP server runs); `graphify .` / `graphify . --update` (`graphify hook install` rebuilds on each commit).

`.vera/`, `.codegraph/`, and `graphify-out/` are gitignored globally. Install/upgrade the tools with the `code-intel` topic (`code-intel/install.sh`).
