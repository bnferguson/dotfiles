# pi

Config and extensions for the [pi coding agent](https://github.com/earendil-works/pi-mono).

`pi/config/*.json` is symlinked file-by-file into `~/.pi/agent/` (not the whole
directory) so sessions, caches, and `pi install`ed packages survive. Extensions
under `pi/extensions/` are symlinked per-extension into `~/.pi/agent/extensions/`
for the same reason.

## Extensions

Both exist to answer one question: **does structural, code-aware navigation
actually beat grep during real work?** They put those tools in front of the
model rather than behind a skill's suggestion, so the difference is measurable.

### `code-intel`

Wraps the indexers from the `code-intel` topic — plus `ast-grep` — as native pi
tools. pi ships no MCP client by design, so codegraph's MCP server is
unreachable here; every verb has a CLI equivalent, and registering those
directly is actually better than MCP because they get `promptSnippet` and
`promptGuidelines` entries in the system prompt, right next to `grep`.

| tool | backed by | replaces |
|---|---|---|
| `cg_context` | `codegraph context` | hunting for where to start |
| `cg_query` | `codegraph query` | grepping for a declaration |
| `cg_callers` / `cg_callees` | `codegraph callers/callees` | grepping for call sites |
| `cg_impact` | `codegraph impact` | guessing at blast radius |
| `vera_search` | `vera search` | grep, when you can't name the thing |
| `ast_search` / `ast_rewrite` | `ast-grep run` | regex/sed refactors |
| `gf_query` / `gf_explain` / `gf_affected` / `gf_overview` | `graphify` | reading docs to reconstruct architecture |

Tools only register when their binary exists, and fail with "run `code-intel
init`" when the project has no index.

**Index freshness is handled automatically.** Every index-backed tool syncs
before it answers, because a stale index doesn't error — it lies. This matters
more in pi than in Claude Code: there, codegraph is kept current by the watcher
inside its MCP server, and pi has no MCP, so nothing would sync it at all.

Measured on a 6,000-file / 49k-chunk monorepo:

| operation | time |
|---|---|
| `git ls-files -m -o` (dirty check) | 0.10s |
| `codegraph sync`, no-op | 0.29s |
| `vera update`, one file changed | 0.47s |
| `vera update`, no-op | 0.96s |
| `graphify update`, 8MB graph | 2.2s |
| `graphify update`, 55MB graph | 41.6s |

The first three are cheap enough to run inline, which is why there's no watcher
process and no background daemon here.

graphify is the awkward one, because **it has no incremental path** — every run
re-extracts the whole corpus, so cost tracks repo size rather than the size of
the change. A no-op costs the same as a full rebuild. Measured at ~0.8 s/MB of
`graph.json`, consistently across a 12x size range.

So it auto-syncs *adaptively*: before a `gf_*` call the extension estimates the
rebuild cost from graph size (replacing the estimate with a real measurement
once it has one) and syncs silently only if it lands under 8s. Otherwise it
leaves the graph alone and reports the drift. On these repos that works out to:

| repo | graph | estimate | actual | behaviour |
|---|---|---|---|---|
| dotfiles | 8.2MB | 7.4s | 2.2s | auto-syncs |
| work monorepo | 55.1MB | 49.6s | 41.6s | manual, reports staleness |

### graphify freshness

graphify records `built_at_commit`, so its staleness is *exact* — commits behind
HEAD — rather than the mtime guesswork the others need. Every `gf_*` result
appends a note when the graph has drifted. A real example from a work monorepo,
where the graph was 18 days and **1,074 commits** old and had been answering
confidently the whole time:

> `[graph is 1074 commit(s) behind HEAD. … for anything added in those commits,
> prefer cg_* or lsp_*. Run /code-intel-sync to rebuild.]`

A CLI rebuild refreshes more than the docs imply. It re-extracts markdown
structure too — on these dotfiles it took the graph from 7,032 to 8,688 nodes
and 1,352 to 8,616 edges, and community labels survived intact (0 placeholders).
What it does *not* do is the LLM pass: semantic extraction of papers/images, and
naming new communities. That still needs `/graphify` in-agent with a model
backend.

Two traps worth remembering:

- Don't infer composition from a node's `_origin` field. It marks which
  extractor version wrote the node, not whether an LLM produced it — in one repo
  the untagged nodes were the documentation layer, in another they were local
  variables. Use `file_type`.
- `gf_overview` resolves each hub to its source file, because `god-nodes` prints
  labels only. On a docs-heavy repo that's the difference between three
  identical `Builtin Functions` rows and three distinguishable Zig reference
  versions. Expect doc headings (`Problem` appears 209 times here) to dominate
  hubs in repos that are mostly prose — it's most useful on code-heavy repos.

**The hazard is interruption, not cost.** A `vera update` killed partway leaves
its content-hash bookkeeping inconsistent, and the next update re-embeds
everything it lost track of — measured at 1,692 files, 19.5 minutes wall, 71
minutes CPU, from one `timeout` kill. So syncs never receive a tool's
`AbortSignal`, and `session_shutdown` waits for an in-flight sync instead of
killing it. If vera ever seems pathologically slow, suspect a previous
interrupted run rather than the tool.

**Modes** — `/code-intel`, `Ctrl+Alt+I`, or `--code-intel <mode>`:

- `off` — tools available, no routing pressure.
- `on` — each distinct text search is intercepted **once** with a pointer to the
  structural equivalent; repeat the identical call and it proceeds. Teaches
  routing without becoming a dead end when grep is genuinely right.
- `strict` — `grep`/`find` removed from the tool set *and* shell text search
  blocked. No textual fallback exists. This is the measurement mode.

Auto-enables `on` when a repo already has any of `.codegraph/`, `.vera/`, or
`graphify-out/`, and **says so** rather than changing tool behaviour silently —
an unannounced behaviour change is the same failure mode as a stale index
answering confidently. It also names what's *missing*, since the three are
complementary rather than alternatives and a project with one of them is
under-served:

```
code-intel: on — vera indexed here.
Not indexed: codegraph, graphify. They answer different questions;
`code-intel init` builds the full set.
Text searches get one redirect to a structural tool. /code-intel to change mode.
```

Interactive sessions only; `pi -p` stays quiet. `/code-intel status` reports the
same present/missing split on demand.

Mode survives `/resume` — it's persisted per session and restored (including
re-pruning the tool set in `strict`). Precedence is `--code-intel` flag, then the
resumed session's mode, then index auto-detection. Without this a long
strict-mode refactor would quietly stop being strict on resume, which is exactly
the kind of silent drift that ruins a comparison.

`/code-intel-init` builds whatever's missing, and is the one thing here that
always asks first. A cold index is nothing like the incremental syncs — minutes
of saturated CPU and hundreds of MB — so it is never automatic, and it runs
without an abort signal because interrupting a vera index costs far more than
letting it finish.

Two things learned by watching it run, both now fixed in the code and worth
remembering if this is ever rewritten:

1. Nudge state must be **session-scoped, never per-turn**. The model's retry
   necessarily lands in a new turn, so expiring per turn blocks the exact call
   the block message just promised would succeed.
2. Blocking the `grep` *tool* alone does nothing — the model immediately runs
   `grep -rn` through `bash` instead, which is the same search but invisible to
   the mode. Both paths have to be covered.

### `lsp`

A real LSP client (JSON-RPC over stdio via `vscode-jsonrpc`), because pi has no
MCP and every off-the-shelf LSP-for-agents bridge — serena included — is
MCP-only.

This is the **index-free** layer: vera/codegraph/graphify need a built index and
go stale between refreshes, while a language server reads what the compiler
reads, in any repo, at any time.

`lsp_definition`, `lsp_references`, `lsp_hover`, `lsp_rename` (preview by
default), `lsp_diagnostics`, `lsp_symbols`.

**Addressing is the whole design problem.** LSP is positional — `(file, line,
character)` — and a model has no idea what column a symbol sits in; it will
invent one. So every tool takes a *symbol name* plus a file and resolves the
position internally via `documentSymbol`, falling back to a word-boundary scan.
A positional API would be worse than grep in practice.

Other things that matter in headless use:

- Servers spawn lazily per (language, project root), stay warm for the session,
  and are killed on `session_shutdown` — otherwise `rust-analyzer` instances
  pile up in the background.
- `workspace/configuration` and friends must be answered or servers hang forever.
- rust-analyzer and gopls answer "no results" *confidently while still
  indexing*, which is the most misleading failure mode here. Requests retry
  while the server reports work in progress.
- **Once a document is `didOpen`'d, the server ignores the file on disk.** An
  agent that opens a file, edits it, then queries again gets answers about the
  pre-edit text, silently. Every tool re-reads open documents and pushes
  `didChange` when the bytes differ, so edits from pi's tools, `sed`, a
  formatter, or your editor are all picked up. This is what makes LSP the only
  layer here with no sync strategy at all — it's a read and a string compare.
- `typescript-language-server` won't start without a tsserver to drive, and many
  repos have no local typescript. It resolves the workspace copy first (a
  project pinned to an older TS must be analyzed by that TS), then follows `tsc`
  on PATH.

Servers are discovered on `PATH` and in nvim's mason bin dir, so anything
installed for the editor is reused. `/lsp` shows what's running and what's
missing.

## Why both

They answer different questions, and the overlap is smaller than it looks:

| | scope | needs index | sync cost | accuracy |
|---|---|---|---|---|
| `codegraph` | whole repo, cross-language | yes | 0.3s | approximate |
| `lsp` | one project, one language | no | free | exact, type-aware |
| `ast-grep` | syntax only | no | none | exact syntax, no semantics |
| `vera` | meaning | yes | 0.5s | fuzzy by design |

Rename is the clearest case: `lsp_rename` knows which occurrences are the same
symbol, `ast_rewrite` only knows which ones look alike.

## Install

`pi/install.sh` (run by `script/install` and `dots`) installs the extension's
npm deps and reports which language servers are visible. `node_modules/` here is
a per-machine artifact and is gitignored.
