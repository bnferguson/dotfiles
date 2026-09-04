# Scripts

Two groups: the ones you run while *using* the skill, and the ones that exist to
keep the skill honest when a new Zig lands.

Every script takes `--help`.

## Using the skill

| Script | What it does |
| --- | --- |
| `get_references.py` | Detect the project's Zig version and print the reference directory to load. Run this first on any Zig task. |
| `detect_version.py` | Version detection on its own, with a confidence level. `get_references.py` calls it. |
| `query_recipes.py` | Search recipes by topic, tag, difficulty or keyword. |
| `code_generator.py` | Generate Zig from a JSON specification. Only when the user asks for it. |

## Keeping the skill honest

The skill's claim is that its code is current. These are what make that claim
checkable rather than aspirational — run them after a toolchain bump.

| Script | Covers |
| --- | --- |
| `verify_recipes.py` | The "Full Tested Code" block of every recipe: extracts it into a real project, resolves the sibling modules and fixtures, links the C libraries, compiles. |
| `check_files.sh` | `assets/templates/` and `examples/`, including a real `zig build run` for the multi-file project. |
| `lint_snippets.py` | The illustrative snippets, which no compiler ever sees. |

```bash
python scripts/verify_recipes.py --zig "mise x zig@0.16.0 -- zig"
ZIG="mise x zig@0.16.0 -- zig" ./scripts/check_files.sh
python scripts/lint_snippets.py
```

### What each one can and cannot catch

They divide the code up this way because no single check reaches all of it:

- **`verify_recipes.py` sees 218 blocks of roughly 3360.** One per recipe. The rest are
  fragments — a partial struct body, a `build.zig` excerpt, a before/after pair — that
  cannot compile standalone.
- **Compiling is weaker than checking.** Zig only analyses a function something
  references, so a recipe can compile while a method no test calls uses an API deleted two
  releases ago. That is exactly how a `std.crypto.random` call survived the 0.16 migration
  inside a *passing* block. `verify_recipes.py` appends a walker that touches every
  reachable public declaration; `--shallow` turns it off, and scores three recipes higher
  for the wrong reason.
- **`lint_snippets.py` is a token blacklist, not a compiler.** It reads a hit as "this
  names an API 0.16 removed", which is a strong hint and not a proof — `getWritten` is a
  removed stdlib method and also a fine name for a method on your own type. It skips
  comments, so a migration note may name the old API freely.

### Gotchas

- `verify_recipes.py --work` defaults to `/tmp`, which is a tmpfs on many Linux systems. A
  full run writes several gigabytes of build artifacts. Point `--work` at real disk if
  `/tmp` is small.
- Files using `@cImport` need `-lc`, and the self-hosted x86 backend miscompiles the
  resulting relocations, so they also need `-fllvm`. `check_files.sh` detects this.
- Recipes that are known not to compile are listed in `SKILL.md` with the reason. They fail
  on APIs 0.16 deleted outright (raw `std.posix` sockets and termios), on module content the
  markdown never included, or on a missing local ICU — not on the I/O change.

## Skill maintenance

`init_skill.py`, `package_skill.py`, `skill_generator.py`, `consolidator.py`,
`pattern_extractor.py` and `version_updater.py` build and package the skill itself. They are
not part of using it.
