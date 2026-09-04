---
name: zig-programming
description: "Comprehensive Zig language expertise covering syntax, stdlib, build system, and error handling. Use when working with Zig code, debugging compilation errors, or building Zig applications."
---

# Zig Programming Language Skill

This skill provides expertise in Zig, a general-purpose programming language focused on robustness, optimality, and maintainability. The skill includes version-specific documentation (0.2.0 through master), automatic version detection, code templates, and reference materials organized for progressive disclosure.

## Table of Contents

- [Bundled Resources](#bundled-resources)
  - [References](#references-progressive-loading-guide) - Progressive disclosure documentation
  - [Recipes](#recipes-cookbook) - 223 tested recipes organized by topic
  - [Templates](#templates) - Starting points for common tasks
  - [Examples](#examples) - Practical code samples
  - [Scripts](#scripts) - Automation tools
- [Workflows](#workflows)
- [Version Awareness](#version-awareness)
- [Best Practices](#best-practices)

## Bundled Resources

### References - Progressive Loading Guide

**Important:** References are version-specific. Use `scripts/get_references.py` to get the correct reference path for the detected Zig version, or load from `references/latest/` (current stable: 0.16.0).

Load documentation progressively based on task complexity. Use this decision tree:

**New to Zig?** Start with fundamentals in order:
1. `references/latest/core-language.md` → Basic syntax, types, operators
2. `references/latest/control-flow.md` → If, while, for, switch
3. `references/latest/functions-errors.md` → Functions and error handling
4. `references/latest/quick-reference.md` → Syntax quick lookup

**Solving specific problems?** Jump directly to:
- **Error handling** → `latest/functions-errors.md` + `latest/patterns-error-testing.md`
- **Memory/allocators** → `latest/memory-management.md` + `latest/patterns-memory-comptime.md`
- **Data structures** → `latest/arrays-slices.md`, `latest/structs-methods.md`, `latest/enums-unions.md`, `latest/pointers-references.md`
- **Struct/array/enum patterns** → `latest/patterns-data-structures.md`
- **Stdlib lookup** → grep `latest/stdlib-builtins.md` (large file, 68KB)
- **C interop** → `latest/c-interop.md` + `latest/patterns-integration.md`
- **Build system** → `latest/build-system.md` + `latest/patterns-integration.md`
- **Zig 0.16 I/O, tasks, files, time, entropy, or process state** → `latest/io.md`

**Advanced topics** (after mastering fundamentals):
- `references/latest/comptime.md` - Compile-time execution and generics
- `references/latest/patterns-memory-comptime.md` - Advanced memory and comptime patterns
- `references/latest/testing-quality.md` - Testing framework and best practices

**Version migration** → `references/version-differences.md` (shared across versions, comprehensive migration guides)

**Using version-specific references:**
```bash
# Get reference path for detected version
python scripts/get_references.py
# Output: references/v0.16.0

# With specific version
python scripts/get_references.py --version 0.13.0
# Output: references/v0.15.2 (with fallback warning)

# JSON output for programmatic use
python scripts/get_references.py --json
```

### Recipes - Cookbook

The skill includes **223 recipes** from the Zig BBQ Cookbook, organized by topic. They target Zig 0.16.0.

**Verification:** 207 of the 218 recipes that ship a full-code block compile against Zig 0.16.0. Re-check them at any time:

```bash
python scripts/verify_recipes.py                       # uses `zig` from PATH
python scripts/verify_recipes.py --filter files-io -v  # one topic, with errors
```

Read that number precisely, because compiling is weaker than checking in two ways:

- **It covers the full-code blocks, not the snippets.** Those 218 blocks are about 218 of
  the ~3360 Zig blocks in `recipes/`. The rest are fragments that cannot compile standalone.
  `python scripts/lint_snippets.py` scans those for APIs 0.16 removed instead -- a token
  blacklist, not a compiler, so treat a hit as a strong hint rather than a proof.
- **Zig only analyses code something references.** A recipe can compile while a method no
  test calls uses an API deleted two releases ago. `verify_recipes.py` therefore appends a
  walker that touches every reachable public declaration. `--shallow` turns it off. Without
  it the same recipe set scores 210 instead of 207, and the extra three are false passes.

Eleven recipes do not yet compile, and each recipe file says so in its header. None of them
are blocked on the I/O change:

- `build-system` 10.3-10.6 reference module files the markdown never included.
- `files-io` 5.16/5.18 and `networking` 20.1/20.2/20.5/20.6 are built on the raw `std.posix`
  socket, `poll`, termios and file-descriptor calls that 0.16 removed in favour of
  `std.Io.net`. They need rewriting, not translating.
- `strings-text` 2.14 links ICU and needs a matching local ICU version.

**Finding recipes by topic:**
- `recipes/fundamentals.md` - Philosophy, basics (19 recipes)
- `recipes/data-structures.md` - Arrays, hashmaps, sets (20 recipes)
- `recipes/strings-text.md` - String processing (14 recipes)
- `recipes/memory-allocators.md` - Allocator patterns (6 recipes)
- `recipes/comptime-metaprogramming.md` - Compile-time (24 recipes)
- `recipes/structs-objects.md` - Structs, unions (22 recipes)
- `recipes/functions.md` - Function patterns (11 recipes)
- `recipes/files-io.md` - File operations (19 recipes)
- `recipes/networking.md` - HTTP, sockets (18 recipes)
- `recipes/concurrency.md` - Threading, atomics (8 recipes)
- `recipes/build-system.md` - Build.zig, modules (18 recipes)
- `recipes/testing-debugging.md` - Testing (14 recipes)
- `recipes/c-interop.md` - C FFI (7 recipes)
- `recipes/data-encoding.md` - JSON, CSV, XML (9 recipes)
- `recipes/iterators.md` - Iterator patterns (8 recipes)
- `recipes/webassembly.md` - WASM targets (6 recipes)

**Querying recipes programmatically:**
```bash
# List all topics with counts
python scripts/query_recipes.py --list-topics

# Find recipes by topic
python scripts/query_recipes.py --topic memory-allocators

# Find recipes by tag
python scripts/query_recipes.py --tag hashmap

# Search by keyword
python scripts/query_recipes.py --search "error handling"

# Get specific recipe details
python scripts/query_recipes.py --recipe 1.1

# Filter by difficulty
python scripts/query_recipes.py --difficulty beginner

# JSON output for programmatic use
python scripts/query_recipes.py --topic data-structures --json
```

**Recipe format:** Each recipe includes Problem, Solution, Discussion sections plus full tested code.

**Recipes are 0.16 code.** They pass `io` explicitly, take `std.process.Init` in `main`, and use `std.Io.Dir` / `std.Io.File` rather than `std.fs`. See `references/latest/io.md` for the model behind that.

**When to use recipes vs references:**
- **Recipes**: "How do I..." questions, practical tasks, working code examples
- **References**: "What is..." questions, API lookup, comprehensive documentation

### Templates

All templates and examples compile against Zig 0.16.0 and their tests pass. The
two build scripts were checked with a real `zig build run`. Re-check with
`./scripts/check_files.sh`.

Copy and customize these starting points:
- `assets/templates/basic-program.zig` - Basic program with allocator
- `assets/templates/build.zig` - Build configuration
- `assets/templates/test.zig` - Test file structure
- `assets/templates/cli-application.zig` - CLI app with arg parsing
- `assets/templates/library-module.zig` - Library/module structure
- `assets/templates/c-interop-module.zig` - C interop module

### Examples

Complete, runnable code demonstrating patterns:
- `examples/string_manipulation.zig` - String processing
- `examples/memory_management.zig` - Allocator patterns
- `examples/error_handling.zig` - Error handling
- `examples/c_interop.zig` - C FFI
- `examples/comptime_example.zig` - Compile-time programming
- `examples/build_example/` - Multi-file project (`zig build test` passes on 0.16.0)

### Scripts

Use these Python automation tools for version management, recipe queries, and code generation:

**Version Detection & Reference Loading:**
- `scripts/get_references.py` - Detect user's Zig version and return correct reference path (use this first)
- `scripts/detect_version.py` - Standalone version detection with confidence levels

**Recipe Queries:**
- `scripts/query_recipes.py` - Search and filter recipes by topic, tag, difficulty, or keyword

**Verification:**
- `scripts/verify_recipes.py` - Compile every recipe against a real Zig toolchain and report what fails
- `scripts/lint_snippets.py` - Scan the illustrative snippets (which no compiler sees) for APIs 0.16 removed
- `scripts/check_files.sh` - Compile and test every template and example

**Code Generation:**
- `scripts/code_generator.py` - Generate Zig code from JSON specifications

**When to execute vs reference:**
- **Execute** `get_references.py` at the start of any Zig task to determine the correct reference path
- **Execute** `query_recipes.py` when searching for practical code examples or solutions
- **Reference** other scripts only when the user explicitly requests code generation or version management tasks
- Most scripts are for skill maintenance, not routine usage

See `scripts/README.md` for complete script documentation.

## Workflows

### Writing New Code

1. **Start from template** - Copy appropriate template from `assets/templates/`
2. **Check version** - Default to Zig 0.16.0 unless specified
3. **Handle errors explicitly** - Use `try`, `catch`, or `errdefer`
4. **Pass allocators** - Never use global state, pass allocators as parameters
5. **Add tests immediately** - Write `test` blocks alongside implementation
6. **Document public APIs** - Use `///` doc comments for exported functions

### Debugging Compilation Errors

**Zig-specific gotchas:**
- **Comptime type resolution** → Use `@TypeOf()` inspection or add explicit casts
- **Allocator lifetime issues** → Verify `defer` cleanup order and `errdefer` on error paths
- **Optional unwrapping** → Use `.?` only when certain; prefer `orelse` or `if` unwrap for safety

**Debug tools:** `std.debug.print()` for inspection, `-Doptimize=Debug` for stack traces, `zig test` to isolate issues

### Explaining Concepts

To teach Zig concepts effectively:
1. **Load relevant reference** - Start with the appropriate reference file for the topic
2. **Show runnable code** - Use complete examples from `examples/` directory
3. **Highlight uniqueness** - Emphasize Zig's distinguishing features (explicit allocators, comptime, no hidden control flow)
4. **Reference stdlib** - Point to specific standard library functions when applicable

## Version Awareness

**Default to Zig 0.16.0** unless user specifies otherwise or detection determines a different version.

### Version Detection Workflow

At the start of any Zig task, determine the user's version using this workflow:

**1. Check for explicit specification:**
- User stated version in current conversation ("I'm using Zig 0.13")
- CLAUDE.md project file contains Zig version specification
- `build.zig.zon` has `minimum_zig_version` field

**2. Automated detection (recommended):**
```bash
# Run get_references.py to detect version and get correct reference path
python scripts/get_references.py --json
```
This script:
- Runs `scripts/detect_version.py` to analyze the project
- Attempts `zig version` command (most reliable)
- Scans `build.zig` and `.zig` files for version markers
- Returns reference path and version info with confidence level
- Handles fallbacks automatically (e.g., 0.14.1 → use 0.15.2 refs)

**3. Manual detection (if automated fails):**
- Scan `build.zig` for API patterns:
  - `b.path(...)` → 0.11+
  - `std.Build` → 0.11+
  - `b.addExecutable(.{...})` → 0.11+
  - `b.addExecutable("name", "file")` → pre-0.11
- Check `.zig` files for syntax markers:
  - `for (items, 0..) |item, i|` → 0.13+
  - `async`/`await` keywords → 0.9-0.10 (removed in 0.11)
- Load `references/version-differences.md` for full detection markers

**4. Ask user if ambiguous:**
- "I detected you might be using Zig 0.13+ based on your build.zig. Can you confirm your version?"
- Offer common versions: 0.16.0 (stable), 0.15.2, 0.14.1, master (development)

**5. Default to 0.16.0:**
- Use current stable if no detection succeeds
- Inform user: "Assuming Zig 0.16.0. Let me know if you're using a different version."

### Loading Version-Specific References

**After detecting version:**
1. Use `scripts/get_references.py` to determine correct reference path
2. Load references from that version directory (e.g., `references/v0.16.0/`)
3. Always load `references/version-differences.md` (shared file) for migration guidance

**Example workflow:**
```bash
# Detect version and get reference path
REF_PATH=$(python scripts/get_references.py)
# REF_PATH is now "references/v0.16.0" or "references/latest"

# Load version-specific documentation
cat $REF_PATH/core-language.md
cat $REF_PATH/build-system.md

# Version differences is shared across all versions
cat references/version-differences.md
```

**Handling fallbacks:**
- If exact version not available (e.g., 0.14.1), script returns closest match (0.15.2) with warning
- Warnings indicate major differences (e.g., "for loop syntax differs from 0.13+")
- Always check fallback warnings to understand version compatibility

### Critical Breaking Changes

Be aware of these major version differences when writing code:

- **0.16+**: Pass `std.Io` to I/O operations; use `std.process.Init` for application-owned I/O, arguments, and environment data
- **0.11+**: Async/await removed, new build.zig API (`std.Build`, `b.path()`)
- **0.13+**: Modern for loop syntax (`for (items, 0..) |item, i|`)
- **0.12-**: Different for loop syntax (manual index variables)
- **Pre-0.11**: Legacy build API (`std.build.Builder`), different error sets

**See `references/version-differences.md` for:**
- Detailed migration guides (0.10→0.11, 0.12→0.13, 0.13→0.15, 0.15→0.16)
- Error message translations
- Before/after code examples
- Breaking changes catalog

### Handling Different Versions

**When user specifies or detection determines a different version:**
1. Run `scripts/get_references.py --version <VERSION>` to get correct reference path
2. Load `references/version-differences.md` for migration details
3. Use version-specific references from the returned path
4. Adapt code patterns to the user's version
5. Flag deprecated features if using older version
6. Recommend modern alternatives when possible

**Best practice for cross-version code:**
- Prefer feature detection over version checks: `@hasDecl(std, "Build")` instead of `if (version >= 0.11)`
- See `references/latest/patterns-integration.md` for `@hasDecl`/`@hasField` examples
- Document target version in code comments: `// Target Zig Version: 0.16.0`
- For cross-version templates, see `assets/templates/cross-version/`

## Best Practices

Core Zig idioms:

1. **Explicit error handling** - Use `try`, `catch`, or error unions; never ignore errors
2. **Defer cleanup** - Use `defer` for cleanup, `errdefer` for error-path cleanup
3. **Pass allocators** - Never use global state; pass allocators explicitly as parameters
4. **Leverage comptime** - Use compile-time execution for generic programming
5. **Write tests inline** - Use `test "description" {}` blocks alongside implementation
6. **Document public APIs** - Add `///` doc comments for exported functions
7. **Handle optionals explicitly** - Use `orelse`, `.?`, or `if` unwrapping
8. **No hidden control flow** - Zig has no hidden allocations, exceptions, or async
