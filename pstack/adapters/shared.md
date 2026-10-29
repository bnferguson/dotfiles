# pstack across agents

Read this adapter before following a bundled skill, including a skill reached through another skill.
This adapter applies to the entire bundled workflow, its playbooks, and its delegates.
Session instructions, repository rules, and the user's authorization take precedence over upstream pstack instructions.
In particular, pstack does not grant permission to post messages, publish changes, merge, or deploy.
Use the repository's PR workflow when one exists.

## Skills and paths

This folder holds `skills/`, `agents/`, and `docs/` from one pinned upstream version.
Installed skill names have a `pstack-` prefix to avoid collisions with local skills.
Resolve an upstream skill name such as `how` to `skills/pstack-how/SKILL.md` in this folder.
Read that file directly when a workflow invokes another bundled skill.
Resolve dynamic paths such as `../<name>/SKILL.md` with the same prefix.
Use the actual file path after resolving discovery symlinks for relative references.
Give delegates the absolute paths of this adapter and `skills/pstack-poteto-mode/SKILL.md`.
Read bundled files locally rather than fetching the version on GitHub `main`.

For the user, invoke `/pstack-poteto-mode` in Claude Code, `/skill:pstack-poteto-mode` in Pi,
and `$pstack-poteto-mode` in Codex.
These are standalone skills, so Claude's plugin command prefix `/pstack:` does not apply.

## Tool and model capabilities

Use the tools and fields exposed by the current session's schemas.
Cursor's `Task` means the available delegation tool, `AskQuestion` means the available question tool,
and its todolist means the available task-list tool or a short progress list in the conversation.
Read files, search, edit, and run commands through the host's native tools.

When the host lacks a named pstack agent type, use an available general agent.
Include the corresponding bundled `agents/<name>.md` instructions and this adapter in its brief.
Keep ownership, read-only constraints, and checkout instructions explicit in the brief.
Do not pass Cursor-only fields such as `cloud_base_branch` to another host's tools.
Create a worktree only when the task needs isolation and the host supports it.

Only select models and effort values supported and authorized in this session.
Otherwise inherit the session model and report the substitution once.
Never claim model diversity when workers use the same model.
If delegation is unavailable, do the steps sequentially and report that independent review remains unavailable.

## Host differences

- Claude Code uses its `Agent` tool when available. Read upstream's
  [Claude adapter](docs/harness/claude-code.md) for additional tool mappings.
  This standalone installation's names and paths above override its plugin-specific mappings.
- Codex uses its available agent tools. Resolve bundled agents through their briefs rather than assuming registered agent types.
- Pi uses the delegation tools provided by its installed extensions. Resolve bundled agents through their briefs.
  If an extension exposes different fields, use its schema.
- Cursor can use its native tools. This adapter does not install or update Cursor's marketplace plugin.

## Personal model preferences

Outside Cursor, read `~/.config/pstack/models.md` when a workflow needs model roles.
For `setup-pstack`, use that file instead of `~/.cursor/rules/pstack-models.mdc`.
Write plain Markdown without Cursor rule frontmatter.
Discover available models from the session rather than copying upstream defaults into the file.
Keep this personal configuration outside the pinned source and generated files.

## Missing capabilities

Cursor Automations and cloud-agent infrastructure require Cursor.
Report an unavailable step and its consequence, then continue independent steps.
Stop dependent work when the missing result is required to establish correctness.
Bugbot comments already on a PR can be read through GitHub, even outside Cursor.
Use `gh` and the repository's workflow for PR operations.
External skills such as `deslop`, `control-cli`, and `control-ui` are separate dependencies.
Use an installed equivalent only when it provides the required capability, and report the substitution.
Do not claim a skipped verification step passed.
