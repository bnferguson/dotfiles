# Philosophy
When working in a language, please follow the style of the core team. Eg; if it's not up to the standard of the Rails core team when working in rails, it's not ready. If that's not possible or there's a good reason to deviate note why.

If the instructions are unclear, ask for clarification. You're as much for helping me have clear vision for what we're doing as you are for producing high-quality code.

Don't over comment on obvious things. Comment on non-obvious things.

# Testing & Red-Green-Refactor
Follow the red-green-refactor cycle: write a failing test first, make it pass, then clean up. This applies to new features and refactors, but is **mandatory** for bug fixes — always write a failing test that reproduces the bug before writing the fix. If the test doesn't fail first, we haven't proven we're testing the right thing.

# Communication
When replying to PR comments, issues, or any GitHub interaction on behalf of the user, always preface with a note identifying yourself as an AI assistant (e.g., "🤖 Claude here —") so it's clear the response didn't come from a human.

# Source Control & Code Review
Use `git` for all VCS operations.

Before starting a code review, always pull from remote first (`git fetch --all`) to ensure you're working with the latest changes.

When reviewing PRs or working with branches, always check if the user is already on the relevant branch and read files locally instead of using GitHub API calls.

## jj as a safety net (checkpointing only)
Do NOT use `jj` for day-to-day VCS — use `git`. But in colocated repos (`jj git init --colocate`), jj automatically snapshots the working copy whenever any `jj` command runs. This provides a recovery path when work is lost to agent crashes, context compaction, or accidental reverts.

Hooks in `~/.claude/settings.json` run `jj status` at key moments (session start, pre-compact, stop) to trigger automatic snapshots. You don't need to run `jj` commands proactively — the hooks handle it.

**When to check snapshots:** If something feels off after context compaction — files look different than expected, work seems missing, or the user says "wait, that's gone" — proactively check `jj obslog --revision @ --patch --limit 5` before re-doing any work. It's cheaper to restore than to recreate.

**How to restore:**
- Single file: `jj restore --from <revision> -- path/to/file`
- Everything: `jj restore --from <revision>`
- Browse snapshots: `jj obslog --revision @ --patch` (each entry is a timestamped snapshot)

# Pull Requests
Prefer simple, direct changes. Pull requests should be small and focused on a single issue. You can make a note of potential features, but avoid making unrelated changes. If the instructions are unclear, ask for clarification.

The exception here is when you notice the code is getting messy or needs to be refactored (eg. code smells, adding something that two of already exist and there's a third maybe it's time to refactor). If this is the case, you can make a plan for it and ask the user about the change.

**ALWAYS use the `/pr` skill to create pull requests — never use `gh pr create` directly.** The skill handles the full process: research, drafting, interview, and creation. Follow the skill's process exactly — the interview and structured sections are mandatory, not suggestions. Prefer draft PRs — this gives the author a chance to add their own voice before it goes out for review.

# Tool Guidance
- When interacting with GitHub use `gh`
- Use `git` for source control
- I use `mise` to manage my shell environment for projects
- I use `brew` to install tools that aren't specified in `mise`
- When dealing with code structure use `ast-grep` and LSP for the given language when available
- **Prefer the LSP tool over grep/glob for code navigation.** When you need to understand how code connects — finding definitions, references, implementations, callers, or type info — use LSP first. It's faster and more accurate than text search for these tasks. Reserve grep/glob for text pattern matching, searching across files by content, or when LSP isn't available for the language. Specific guidance:
  - **Go to definition / type:** Use `LSP goToDefinition` instead of grepping for `func FooBar` or `class FooBar`
  - **Find all usages:** Use `LSP findReferences` instead of grepping for a symbol name
  - **Understand a symbol:** Use `LSP hover` to get type info and docs
  - **Map a file's structure:** Use `LSP documentSymbol` instead of grepping for `def ` or `func `
  - **Find implementations:** Use `LSP goToImplementation` for interfaces/abstract methods
  - **Trace call chains:** Use `LSP incomingCalls`/`outgoingCalls` to understand call graphs
- When dealing with terraform use the Terraform MCP
- When working with Rails use the `rails` command for migrations and generators

## Shell tools for data processing
  - JSON: use `jq`
  - YAML/XML: use `yq`

# Language Specific Claude Skills
- Ruby/Rails: always invoke the `rails-programmer` skill before writing Rails code, then run the `rails-core-code-reviewer` agent after to verify.
- Go: always invoke the `effective-go` and `go-concurrency-patterns` skills before writing Go code, then run the `go-core-code-reviewer` agent after to verify.
- Zig: always invoke the `idiomatic-zig` and `zig-programming` skills before writing Zig code, then run the `zig-core-code-reviewer` agent after to verify. Additionally, invoke `zig-interop` when working on C interop (e.g., libc bindings, `@cImport`, linking C libraries).

# Prose
- Follow [`style-guide.md`](style-guide.md) for voice and tone, and consult [`tropes.md`](tropes.md) for AI writing patterns to avoid
- **This applies to all prose output**, not just long-form writing. PR descriptions, PR review comments, issue comments, Slack messages, commit messages, and any other text written on Brandon's behalf should follow the style guide and avoid the tropes
- When drafting PR descriptions specifically: write in Brandon's voice, be direct and specific about what changed and why, skip the filler transitions and false profundity

## Code Search

Use Vera before opening many files or running broad text search when you need to find where logic lives or how a feature works.

- `vera search "query"` for semantic code search. Describe behavior: "JWT validation", not "auth".
- `vera grep "pattern"` for exact text or regex
- `vera references <symbol>` for callers and callees
- `vera overview` for a project summary (languages, entry points, hotspots)
- `vera search --deep "query"` for RAG-fusion query expansion + merged ranking
- Narrow results with `--lang`, `--path`, `--type`, or `--scope docs`
- `vera watch .` to auto-update the index, or `vera update .` after edits (`vera index .` if `.vera/` is missing)
- For detailed usage, query patterns, and troubleshooting, read the Vera skill file installed by `vera agent install`
