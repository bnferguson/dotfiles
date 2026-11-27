# pi

Config and extensions for the [pi coding agent](https://github.com/earendil-works/pi-mono).

`pi/config/settings.json` holds shared preferences. `script/sync-agent-settings`
applies them to a real `~/.pi/agent/settings.json`, preserving local package additions,
device identity, and changelog state. Bootstrap and `dots` run this sync before agent updates.
Edit the tracked file to share a preference; changes made through Pi stay local.

The other config files are linked individually into `~/.pi/agent/`, so sessions,
caches, and installed packages survive. Extensions under `pi/config/extensions/`
are linked per extension into `~/.pi/agent/extensions/` for the same reason.

## MCP servers

Pi's native MCP client reads `~/.pi/agent/mcp.json`, linked from
`pi/config/mcp.json` by bootstrap. Existing Linear, Notion, and REA entries
remain configured. OAuth tokens stay in Pi's untracked `mcp-auth.json`.

The `terraform` server runs the official HashiCorp image pinned to `1.3.0`.
Docker must be running and available on `PATH`. Only the public Registry
toolset is enabled; it needs no AWS credentials, HCP token, or host mounts.
It searches provider and module documentation. It cannot run local Terraform
`plan` or `apply` commands.

Run `pi mcp list` to check connections. Use `/reload` in an existing Pi session
after changing the file, then inspect the server with `/mcp`. Terraform tools
use Pi's default `codemode` exposure.

## Extensions

### `lsp`

The extension connects to language servers over stdio using `vscode-jsonrpc`.

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
- Servers answer **immediately and incompletely** while still loading a
  project, with nothing to distinguish the wrong answer from the right one.
  Measured on a 635-file Next.js app: `lsp_references` for a symbol with 16 real
  references returned **1 at 0.3s and 16 from 3.4s onwards**. `$/progress` is no
  help — typescript-language-server never emits it — so definition and reference
  queries poll until two consecutive identical results, once per session. Costs
  ~2s on the first query per project, nothing after.
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

Servers are discovered on `PATH` and in nvim's Mason bin dir. The shared
baseline is installed by the `mise` topic (`typescript-language-server`,
TypeScript, `gopls`, and `pyright`); Rust comes from rustup's `rust-analyzer`
component. Mason supplies the editor-oriented Lua, Ruby, Terraform, and Zig
servers. `/lsp` shows what's running and what's missing.

### `telemetry`

Records what a session actually did, so changes to tooling can be evaluated
instead of guessed at. Deliberately generic — it hooks pi's own tool and turn
events, so it sees built-in tools, every extension's tools, and anything added
later, with no knowledge of any of them.

One JSONL file per session in `~/.pi/agent/telemetry/` (never in the project):
session metadata (cwd, branch, commit, model, active tool set), per-tool-call
timing/errors/output size, and per-turn token and cost breakdown.

It records names and sizes, **not** tool inputs or outputs — those are your
source, prompts, and occasionally secrets, and this writes plaintext to disk.
`PI_TELEMETRY_VERBOSE=1` opts into capturing arguments.

`/stats` summarizes the live session. `bin/pi-telemetry` reads the logs:

```sh
pi-telemetry list --repo soffi-main --days 7
pi-telemetry show <fragment>
pi-telemetry compare --group-by tool:lsp_references
```

`compare` is observational, not randomized — sessions differ in task as well as
tooling — so it prints n and says so. It's a prompt to investigate, not a
result.

One thing worth knowing: `usage.input` alone is misleading under prompt caching.
A turn reading 15k tokens of context can report `input: 2` because the rest was
a cache read. The full breakdown and `cost` are recorded for that reason.

## Install

`pi/install.sh` (run by `script/install` and `dots`) installs Pi with its
managed installer. This installation supports `pi update`. Pi must not be a
mise-managed tool.

During `dots`, the script runs `pi update --all --no-approve` from `/`.
This updates Pi and its global packages without loading project settings.
Pinned package versions stay unchanged. Initial Pi setup still requires an
interactive run of `pi/install.sh`.

The script also installs the extension npm dependency and reports visible
language servers. During `dots`, `npm update` advances local extension
dependencies within their declared version ranges. Both npm commands disable
lifecycle scripts. Pi's SDK and the runtime dependency support script-free
installation. The script checks their imports after installation.

Errors reach the `dots` log and produce a nonzero exit status. The `mise` topic
installs the shared headless language-server baseline. The `rust` topic installs `rust-analyzer`. `node_modules/` is a
per-machine artifact and is gitignored.
