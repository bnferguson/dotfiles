# Philosophy
When working in a language, please follow the style of the core team. Eg; if it's not up to the standard of the Rails core team when working in rails, it's not ready. If that's not possible or there's a good reason to deviate note why.

If the instructions are unclear, ask for clarification. You're as much for helping me have clear vision for what we're doing as you are for producing high-quality code.

Don't over comment on obvious things. Comment on non-obvious things.

# Testing & Red-Green-Refactor
Follow the red-green-refactor cycle: write a failing test first, make it pass, then clean up. This applies to new features and refactors, but is **mandatory** for bug fixes — always write a failing test that reproduces the bug before writing the fix. If the test doesn't fail first, we haven't proven we're testing the right thing.

# Communication
When replying to PR comments, issues, or any GitHub interaction on my behalf, always preface with "🤖 Claude here —" so it's clear the response came from Claude.

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

The exception here is when you notice the code is getting messy or needs to be refactored (eg. code smells, adding something that two of already exist and there's a third maybe it's time to refactor). If this is the case, you can make a plan for it and ask me about the change.

Prefer to open as a draft PR. This let's me add my comments to the PR description. I prefer a human touch in describing the changes.

The pull request description should follow a template:

- Background - explain what the current situation is and why it needs to change. Basically anything someone who knows nothing about this needs to know to get up to speed quickly. Cross references to other PRs, Issues, Linear, Slack convos are welcome here.
- Solution - Explain the change we made, why it addresses the above.
- Reviewer notes - Are there specific areas we want feedback on? Areas that we are proud of and want to highlight? Where should I focus my attention as a reviewer?
- Testing Plan - How the fuck do I test what we made? How did you test it? (Later, how will we test and observe it in prod)
- [Optional] Please post a gif on how this PR makes you feel. (Keep it PG)

Before creating a PR, always research the git history and related PRs to build the "Background" section. Use `git log -S`, `gh pr list --search`, and commit archaeology to trace how the current code got to this state — which PRs introduced the pattern we're changing, which PRs fixed symptoms of the same issue, and any related Linear issues or Notion docs referenced in those PRs. This context tells the story of *why* the code is the way it is and makes the case for the change.

For all of these we can work together on it. You can interview me and then put your thoughts after mine noting what's me and what is you.

# Tool Guidance
- When interacting with GitHub use `gh`
- Use `git` for source control
- I use `mise` to manage my shell environment for projects
- I use `brew` to install tools that aren't specified in `mise`
- When dealing with code structure use `ast-grep` an LSP for the given language when available
- When dealing with terraform use the Terraform MCP
- When working with Rails use the `rails` command for migrations and generators

## Shell tools for data processing
  - JSON: use `jq`
  - YAML/XML: use `yq`

# Language Specific Claude Skills
- Ruby/Rails: always invoke the `rails-backend-guidelines` skill before writing Rails code, then run the `rails-core-code-reviewer` agent after to verify.
- Go: always invoke the `effective-go` and `go-concurrency-patterns` skills before writing Go code, then run the `go-core-code-reviewer` agent after to verify.

# Prose
- When writing prose, follow [`style-guide.md`](style-guide.md) for voice and tone
- Consult [`tropes.md`](tropes.md) for AI writing patterns to avoid
