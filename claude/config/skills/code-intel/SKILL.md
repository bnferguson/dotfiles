---
name: code-intel
description: Router for the three code-intelligence tools — vera (semantic search), codegraph (structural graph/call graphs over MCP), and graphify (whole-project knowledge graph spanning code + docs + schemas). Use when finding where logic lives, tracing callers/callees/impact, or navigating a large or polyglot codebase — whether unfamiliar or one worked in daily. Picks the right layer (comprehend / locate / traverse) and defers to each tool's own skill, MCP server, or CLI for detailed usage.
---

# Code Intelligence

Three tools, three zoom levels. They are complementary, not competing — pick the layer that matches the question.

| Layer | Tool | Answers | Mechanism |
|---|---|---|---|
| **Comprehend** | graphify | "What *is* this project, how do the big pieces (incl. docs/schema) connect?" | Multimodal knowledge graph, snapshot |
| **Locate** | vera | "Where's the code about X?" when you don't know the symbol name | Embedding semantic search |
| **Traverse** | codegraph | "Who calls this? What does it call? Blast radius of a change?" | Structural call graph, live over MCP |

## When to reach for this

The disqualifier is **size, not familiarity**: if the repo is small enough to just read the relevant files, skip the indexes — LSP + grep are faster. Otherwise it pays off, and a repo *you* know cold still qualifies, because I start every session cold even when you don't.

Index when a repo is **large, polyglot, long-lived, or already has a `.codegraph/` or `.vera/` index**. Skip a 20-file utility.

**Default to the index when one exists** — don't wait to be asked. If the repo has a `.codegraph/`, reach for codegraph's MCP tools over grep/Read for navigation; if it has a `.vera/`, prefer `vera search` over broad text search.

### Two modes

- **Exploring an unfamiliar repo** — work the layers in order: `graphify` to comprehend, `vera` to locate, `codegraph` to traverse.
- **Daily work in a repo you own** — codegraph runs ambiently (its watcher keeps the graph fresh while the session is open); lead with it for navigation and impact checks. Reach for `vera` when you cross into code you didn't write, and `graphify` only for architecture questions or a refactor. This is the default when the index is present — no special prompt needed.

## Routing

| You need to… | Use | How |
|---|---|---|
| Orient in an unfamiliar repo; map architecture and how code + docs + schema connect | **graphify** | `/graphify .` (in-agent) then read `graphify-out/GRAPH_REPORT.md`, or `graphify query "<question>"` |
| Find where behavior lives without knowing the name | **vera** | `vera search "validates JWT expiry"` |
| Exact string, regex, import, or TODO | **vera** (or `rg`) | `vera grep "pattern"` |
| Trace who calls a symbol / what it calls | **codegraph** | MCP `codegraph_callers` / `codegraph_callees` (CLI: `codegraph callers <sym>`) |
| Assess the blast radius before changing a symbol | **codegraph** | MCP `codegraph_impact` (CLI: `codegraph impact <sym>`) |
| Build task context (entry points + related symbols, few calls) | **codegraph** | MCP `codegraph_context "<task>"` |

When codegraph's MCP tools are available, prefer them over re-deriving structure with grep — answer directly rather than delegating to file-reading sub-agents (that erases the savings).

## Per-tool detail

- **vera** — see the `vera` skill for full `search` / `grep` / `references` / `overview` flags. Index with `vera index .`, refresh with `vera update .`, or `vera watch .` for a session.
- **codegraph** — MCP tools: `codegraph_context`, `codegraph_search`, `codegraph_callers`, `codegraph_callees`, `codegraph_impact`, `codegraph_node`, `codegraph_files`, `codegraph_status`. Same verbs exist as CLI subcommands. Index with `codegraph init` + `codegraph index`; the file watcher auto-syncs while `serve --mcp` runs. 19+ languages (no shell/zsh).
- **graphify** — the full graph is built **in-agent** with `/graphify .` (the session supplies the LLM for semantic extraction); the CLI's `graphify update .` does a code-only AST graph with **no LLM**. Both write `graphify-out/` (graph.json, GRAPH_REPORT.md; HTML viz only under ~5k nodes). Query with `graphify query "…"`, `graphify path "A" "B"`, `graphify explain "Symbol"`.

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

Or per tool: `vera index .` / `vera update .` (or `vera watch .` for live freshness); `codegraph init` + `codegraph index` / `codegraph sync` (auto-syncs while its MCP server runs); `/graphify .` in-agent for the full graph or `graphify update .` for a code-only CLI build (`graphify hook install` rebuilds on each commit).

`.vera/`, `.codegraph/`, and `graphify-out/` are gitignored globally. Install/upgrade the tools with the `code-intel` topic (`code-intel/install.sh`).
