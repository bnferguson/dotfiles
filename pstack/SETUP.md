# pstack

`dots` installs the pinned pstack skills, then checks upstream for changes.
An available update appears in the terminal and the normal dots log.
The check doesn't change tracked files or advance the pin.
A network error fails the check, but the pinned installation still runs first.

```sh
pstack-sync check
pstack-sync update
pstack-sync verify
pstack-sync install
```

`update` fetches upstream `main`, validates the package, records its commit and tree IDs,
and installs the generated skills. Review the resulting Git changes before committing them.
`verify` checks the source tree and the generated output against the lock.
`install` works offline and restores generated files from the pinned source.
Bootstrap and `script/install` run this installation through `pstack/install.sh`.

## Installed skills

Skills use a `pstack-` prefix, so existing skills keep their names.
For example, invoke `$pstack-poteto-mode` in Codex, `/pstack-poteto-mode` in Claude Code,
or `/skill:pstack-poteto-mode` in Pi.
The installation creates links in `.agents/skills` and `claude/config/skills`.
Codex reads the shared directory. Pi's existing configuration reads Claude's skills.
This doesn't change Cursor's marketplace installation.

The generated package preserves references, scripts, executable modes, docs, and the license.
Each skill points to the [shared adapter](adapters/shared.md).
The adapter handles tool differences, bundled agent briefs, missing capabilities, and model preferences.
Personal model preferences live in `~/.config/pstack/models.md` outside Cursor.
Repository instructions and session permissions take precedence over pstack's defaults.

## Files and updates

- `upstream/` contains an untouched copy of the pinned `pstack/` directory.
- `lock.json` records the source repository, branch, commit, tree ID, version, and generated hash.
- `adapters/shared.md` contains our maintained changes to upstream behavior.
- `generated/` is an ignored local output directory. Don't edit it directly.

The upstream check compares the `pstack/` tree ID, so unrelated changes elsewhere in `cursor/plugins` don't trigger notices.
Only an explicit `update` changes the pin. Unmanaged skill destinations and local source edits block replacement.
Updates remove obsolete managed links and preserve unrelated skills.

After changing an adapter, run `pstack-sync update` to validate and record the new output hash.
This also checks the latest upstream source. Keep adapter changes focused so the resulting diff remains reviewable.
To roll back, restore the previous source, adapter, and lock with Git, then run `pstack-sync install`.

## Validation

```sh
python3 script/test-pstack-sync.py
python3 script/test-dots.py
bin/pstack-sync verify
```

CI runs these checks without contacting upstream.
They cover pin integrity, reproducible output, skill references, installation, and updates against a disposable Git remote.
They don't prove that an agent follows a workflow correctly.
After changing an adapter, run a representative task in each host before relying on the changed behavior.
Multi-model review, cloud tasks, and UI verification depend on the host's available tools.
