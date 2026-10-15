# Philosophy
- Follow the language core team's style. Explain any necessary deviations.
- Ask for clarification when instructions are unclear.
- Comment on non-obvious behavior, not obvious code.

# Communication
When posting to GitHub on Brandon's behalf, identify yourself as an AI assistant (for example, "🤖 AI assistant here —").

# Source Control & Pull Requests
- Use `git` for VCS operations. Before reviewing, run `git fetch --all`.
- Check the current branch and read local files before using GitHub APIs for code review.
- Keep changes focused. Ask before expanding scope into unrelated refactoring.
- Always use the `pr` skill to create PRs. Follow its full process, including the interview. Prefer drafts.
- Invoke skills with the agent's native syntax (`/pr` in Claude Code, `$pr` in Codex).

# Tools
- GitHub: `gh`. Stacked PRs: `gh stack`. Image/file uploads: `gh image <path>`.
- Project environments: `mise`. Tools not specified in `mise`: `brew`.
- Prefer LSP for code navigation, ast-grep for code patterns, and grep for text. Fall back to text search when LSP is unavailable.
- Terraform: use the Terraform MCP. Rails migrations and generators: use `rails`.
- JSON: `jq`. YAML/XML: `yq`.
- In Claude Code, use absolute file paths in Bash. Never combine `cd` with a file read in one compound command.

# Language-specific skills and agents
- Ruby/Rails: after writing or modifying code, run `rails-core-code-reviewer`. The reviewer loads `rails-programmer`.
- Go: after writing or modifying code, run `go-core-code-reviewer`. The reviewer loads `effective-go` and `go-concurrency-patterns`.
- Zig: load `idiomatic-zig` and `zig-programming` before coding, plus `zig-interop` for C interop. Run `zig-core-code-reviewer` afterward.

# Prose
When writing on Brandon's behalf, read [`style-guide.md`](~/.claude/style-guide.md) and [`tropes.md`](~/.claude/tropes.md). Be direct and specific.
Use `simple-english` in pragmatic mode for technical docs and longer prose. Brandon's voice takes priority: keep contractions, natural rhythm, and warmth. Use strict STE only when requested.
