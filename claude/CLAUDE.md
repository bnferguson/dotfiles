# Philosophy
When working in a language, please follow the style of the core team. Eg; if it's not up to the standard of the Rails core team when working in rails, it's not ready. If that's not possible or there's a good reason to deviate note why. 

If the instructions are unclear, ask for clarification. You're as much for helping me have clear vision for what we're doing as you are for producing high-quality code.

Don't over comment on obvious things. Comment on non-obvious things.

# Communication
When replying to PR comments, issues, or any GitHub interaction on my behalf, always preface with "🤖 Claude here —" so it's clear the response came from Claude.

# Source Control & Code Review
Use `jj` for all VCS operations — commits, branching, rebasing, push/pull. Only use raw `git` when `jj` can't reach (e.g., `gh` CLI needs a git remote, or a tool only speaks git). Repos should be jj-initialized (`jj git init` in existing git repos).

**Exception — git worktrees:** `jj` does not work inside git worktrees (e.g., those created by Conductor or Claude Code's `isolation: "worktree"` mode). When operating in a worktree, use `git` directly for all VCS operations instead of `jj`.

When reviewing PRs or working with branches, always check if the user is already on the relevant branch and read files locally instead of using GitHub API calls.

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
- Use `jj` for all bits of source control and commits (refer to JJ Quick Command List)
- I use `mise` to manage my shell environment for projects
- I use `brew` to install tools that aren't specified in `mise`
- When dealing with code structure use `ast-grep` an LSP for the given language when available 
- When dealing with terraform use the Terraform MCP
- When working with Rails use the `rails` command for migrations and generators

## Shell tools for data processing
  - JSON: use `jq`
  - YAML/XML: use `yq`
  
# Language Specific Claude Skills
- Ruby/Rails: use the `rails-backend-guidelines` skill and `dhh-code-reviewer` agent to ensure code quality and adherence to best practices.
- Go: use `effective-go` and `go-concurency-patterns` skills to ensure code quality and adherence to best practices.

# JJ Quick Command List

A minimal cheat‑sheet of the day‑to‑day **Jujutsu (`jj`)** commands you (or an agent) really need.
Keep this up to date: when a `jj` command fails unexpectedly or uses deprecated syntax, fix this cheat sheet with the correct usage.

| Purpose                       | Command                                    | What it does                                                    |
| ----------------------------- | ------------------------------------------ | --------------------------------------------------------------- |
| **See changes**               | `jj status`                                | Show working‑copy commit and modified files                     |
| **Browse history**            | `jj log`                                   | One‑line graph of commits; add `-r : --git` to include Git hashes |
| **Diff current work**         | `jj diff`                                  | Compare working‑copy commit to its parent                       |
| **Start a new change**        | `jj new`                                   | Fork a fresh change from `@` (no checkout dance)                |
| **Write/update message**      | `jj describe -m "msg"`                     | Sets commit message of the working change                       |
| **Split hunks interactively** | `jj split`                                 | Launches diff‑editor to carve current change into smaller ones  |
| **Undo last (or any) op**     | `jj undo`                                  | Reverts the specified operation in the op‑log                   |
| **List operations**           | `jj op log`                                | Shows numbered operation history for quick undo/restore         |
| **Push**                      | `jj git push --bookmark NAME`              | Push a specific bookmark to Git remote                          |
| **Push deleted bookmarks**    | `jj git push --deleted`                    | Push all locally-deleted bookmarks to remote (no argument)      |
| **Fetch / rebase**            | `jj git fetch --all-remotes`               | Fetch all remotes; jj auto‑rebases local changes                |
| **List bookmarks**            | `jj bookmark list`                         | Display bookmarks pointing at changes                           |
| **Create bookmark**           | `jj bookmark create feature`               | Label current change as *feature*                               |
| **Move bookmark**             | `jj bookmark set feature -r REV`           | Point bookmark *feature* at another revision                    |
| **Track remote bookmark**     | `jj bookmark track feature --remote=origin` | Start tracking a remote bookmark locally                        |
| **Delete bookmark**           | `jj bookmark delete feature`               | Remove bookmark label                                           |

### Safety net

* `jj op restore <op‑id>` — time‑travel repo back to any previous operation (and still `jj undo` later)
* Everything is undoable; when in doubt, run `jj op log` followed by `jj undo`.

### Automation tips

* Use `jj describe -m "msg"` to set a description without opening an editor. The `--no-editor` flag is deprecated.
* Prefer `--template '{id} {description|escape_json}\n'` for JSON‑friendly output.

### Using `gh` CLI in jj repos

jj keeps Git in a detached HEAD state, so `gh` can't auto-detect the current branch. Always pass `--head <bookmark>` and `--base main` explicitly when creating PRs:

```bash
gh pr create --draft --head my-bookmark --base main --title "..." --body "..."
```
