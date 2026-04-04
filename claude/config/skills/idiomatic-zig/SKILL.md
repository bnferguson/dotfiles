---
name: idiomatic-zig
description: >
  Production patterns for writing idiomatic, high-performance Zig. Derived from Ghostty
  (terminal emulator) and TigerBeetle (distributed database) — two of the most serious Zig
  codebases in production. Use this skill when writing Zig code that needs to be fast, safe,
  and maintainable. Complements the zig-programming skill (which covers language syntax and API
  reference) with battle-tested idioms for real-world systems.
---

# Idiomatic Zig: Production Patterns from Ghostty & TigerBeetle

Patterns distilled from two flagship Zig projects:

- **Ghostty** — GPU-accelerated terminal emulator. SIMD optimization, cache-friendly packed structs, offset-based memory addressing, cross-platform abstraction.
- **TigerBeetle** — Distributed financial database. Static allocation discipline, assertion-driven safety, deterministic simulation testing, io_uring integration. Their [TIGER_STYLE.md](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md) is one of the best coding style guides ever written.

**Target version:** Zig 0.15+. When using the `zig-programming` skill alongside this one, defer to its version detection for API specifics. Some builtins referenced here (e.g., `@branchHint`) are recent additions.

## How to Use This Skill

Load this skill alongside `zig-programming` for production Zig work. This skill provides *idioms and design philosophy*; `zig-programming` provides *syntax, stdlib reference, and version detection*.

**Writing a new module:** Start with [Design Philosophy](#design-philosophy) and [Naming & Style](#naming--style), then load the relevant reference for your domain.

**Optimizing hot paths:** Load `references/performance-patterns.md`.

**Reviewing existing code:** Check assertion density (2+ per function), naming conventions, struct field order, and error handling patterns.

### Reference Files (load as needed)

- `references/memory-patterns.md` — Allocator strategies, pools, offset addressing, in-place init
  (grep: `StaticAllocator`, `BitmapAllocator`, `Offset`, `mmap`, `MemoryPool`, `errdefer`, `deinit`)
- `references/performance-patterns.md` — SIMD, cache lines, branch hints, hot loop extraction
  (grep: `@branchHint`, `@prefetch`, `packed struct`, `fastmem`, `@divExact`, `cache_line`)
- `references/safety-and-assertions.md` — Assertion discipline, NASA Power of Ten, pair assertions
  (grep: `assert`, `fatal`, `maybe`, `comptime unreachable`, `slow_runtime_safety`, `verify`)
- `references/testing-strategies.md` — VOPR, fuzz testing, tripwire error injection, coverage marks
  (grep: `tripwire`, `VOPR`, `fuzz`, `coverage`, `refAllDecls`, `verifyIntegrity`, `swarm`)
- `references/api-design-patterns.md` — Options structs, tagged unions, generic type functions
  (grep: `Options`, `union(enum)`, `TreeType`, `Renderer`, `callback`, `inline else`)
- `references/tiger-style-principles.md` — Core philosophy from TigerBeetle's style guide
  (grep: `Power of Ten`, `zero technical debt`, `70-line`, `control plane`, `data plane`)

### Example Files

- `examples/assertion_patterns.zig` — Comptime assertions, pair assertions, positive/negative space
- `examples/comptime_type_generation.zig` — Data table to packed struct + enum + dispatch
- `examples/generic_type_function.zig` — `FooType()` pattern with comptime callbacks
- `examples/options_struct.zig` — Named arguments via config struct
- `examples/packed_struct.zig` — Cache-friendly Cell/Row layout with fast-path skipping
- `examples/static_allocator.zig` — Three-phase allocator lifecycle
- `examples/error_handling_patterns.zig` — Narrow error sets, translation, errdefer discipline
- `examples/concurrency_patterns.zig` — Dirty flags, atomics, blocking queues

## Design Philosophy

> Full treatment in `references/tiger-style-principles.md`.

**Safety, performance, developer experience — in that order.** When they conflict, this is the priority. Good style advances all three simultaneously.

**Simplicity is the hardest revision, not the first attempt.** Spend mental energy upfront in design. The "super idea" that solves multiple axes simultaneously is what to look for.

**Zero technical debt.** Do it right the first time. What ships must be solid — lacking features is acceptable, lacking quality is not.

**Be explicit.** No hidden control flow, no hidden allocations, no hidden async. Pass options explicitly. Show intent. Minimize dependence on the compiler to do the right thing.

**Put a limit on everything.** All loops, queues, and buffers must have a fixed upper bound.

## Memory Management

> Full treatment and code examples in `references/memory-patterns.md`.

Key patterns:

- **Choose the right allocator per layer** — GPA at top level, `ArenaAllocator` for temp work, `MemoryPool` for fixed-size objects, direct OS allocation for hot paths.
- **Static allocation after init** — When memory needs are known at startup, allocate everything upfront, then forbid further allocation. A performance choice, not a universal rule.
- **In-place initialization** — Initialize large structs via out pointers to avoid stack copies. Viral — if any field needs it, the container should too.
- **deinit sets undefined** — Set `self.* = undefined` after freeing to catch use-after-free in debug builds.
- **errdefer discipline** — Every fallible init must use `errdefer` to clean up partial state.

## Safety & Assertions

> Full treatment in `references/safety-and-assertions.md`.

Key rules:

- **Two assertions per function minimum.** Assertions are a force multiplier for fuzzing.
- **Pair assertions** — Assert the same property in two different code paths (e.g., before write AND after read).
- **Assert positive AND negative space** — `assert(index < length)` AND `assert(value != sentinel)`.
- **Split compound assertions** — `assert(a); assert(b);` over `assert(a and b)` for precise diagnostics.
- **Comptime assertions** — Assert relationships between constants before execution.
- **Three-tier error strategy** — `assert` (programmer errors), `fatal` (environmental errors), error unions (operational errors).

## Performance

> Full treatment with SIMD examples in `references/performance-patterns.md`.

Key patterns:

- **Think performance at design time** — The 1000x wins come from design, not profiling. Back-of-the-envelope across network/disk/memory/CPU.
- **Packed structs for cache-friendly layout** — Design hot data to fit in cache lines. Make the zero value meaningful.
- **Row flags for fast-path skipping** — Track metadata at the container level to skip expensive per-element work.
- **`@branchHint`** — Mark cold/unlikely/unpredictable branches explicitly.
- **Extract hot loops** — Remove `self` from inner-loop functions so the compiler can freely register-allocate.
- **Show division intent** — `@divExact`, `@divFloor`, `div_ceil` instead of generic `/`.

## Error Handling

- **Narrow error sets** — Define operation-specific error sets, not `anyerror`.
- **Error translation at boundaries** — Translate subsystem errors to domain-specific names.
- **`errdefer comptime unreachable`** — After a point where no more errors can occur, document it explicitly.

See `examples/error_handling_patterns.zig` for complete examples.

## Comptime Patterns

> Detailed examples in `references/api-design-patterns.md` and `examples/comptime_type_generation.zig`.

- **Generic data structures via type functions** — `pub fn FooType(comptime T: type) type { return struct { ... }; }`.
- **Type generation from data tables** — Define data as a table, generate packed structs and enums at comptime.
- **`inline else` for comptime dispatch** — Turn runtime enum values into comptime-known values.
- **Platform selection at comptime** — `pub const Io = switch (builtin.target.os.tag) { ... }`.
- **Compile-time layout verification** — `comptime { assert(@sizeOf(Cell) == 8); }`.

## Code Organization

- **File-as-struct** — Major types get their own `TitleCase.zig` file; the struct is `@This()`. Lowercase files are namespace modules.
- **Flat namespacing** — Prefer `stdx.PRNG` over `stdx.random.PRNG`.
- **Root re-export module** — Package root re-exports public types.
- **Config/constants split** — Raw config in `config.zig`, derived constants in `constants.zig`. Code imports `constants`, never `config` directly.
- **Struct field order** — Fields first, types next, methods last. Important things near the top.
- **Scoped logging** — Every module: `const log = std.log.scoped(.module_name);`.
- **Modular build system** — Keep `build.zig` thin; delegate to file-structs in `src/build/`.

## Naming & Style

Follow the [Zig style guide](https://ziglang.org/documentation/master/#Style-Guide). Where Ghostty and TigerBeetle disagree, the Zig stdlib is the tiebreaker.

### Naming Rules

- **Types**: `TitleCase` — `ArrayList`, `Allocator`
- **Functions/methods**: `camelCase` — `insertSlice`, `appendAssumeCapacity`
- **Functions returning `type`**: `TitleCase` — `fn ArrayList(comptime T: type) type`
- **Variables and constants**: `snake_case` — `max_connections`, `default_timeout_ms`
- **File names**: `TitleCase.zig` for file-as-struct, `snake_case.zig` for namespace modules

### Acronyms Are Regular Words

Acronyms follow the same casing rules as any other word, even two-letter ones:

```zig
// Correct (stdlib convention):
const XmlParser = struct { ... };
const TcpServer = struct { ... };
const Io = @import("Io.zig");

// Wrong:
const XMLParser = struct { ... };
const IO = @import("IO.zig");
```

> TigerBeetle uses `VSRState` and Ghostty uses `IO` — both deviate from the stdlib. Follow the stdlib (`Io`, `Uri`, `Tcp`, `Tls`).

### Name Quality

- **Units/qualifiers last**, by descending significance: `latency_ms_max`, not `max_latency_ms`.
- **Same-length related names**: `source_offset` / `target_offset`, not `src_offset` / `dest_offset`.
- **No abbreviations** — `source` and `target`, not `src` and `dest`. Exception: primitive loop variables.
- **Nouns over adjectives** — `replica.pipeline` over `replica.preparing`.
- **Infuse meaning** — `gpa: Allocator` and `arena: Allocator` over `allocator: Allocator`.

### Formatting

- Run `zig fmt`. 4-space indentation. Hard 100-column limit.
- Braces on `if` unless it fits on one line.
- 70-line function limit. Art is born of constraints.
- Comments are sentences — capital letter, full stop, space after `//`. Always say **why**.

## API Design

> Full examples in `references/api-design-patterns.md`.

- **Options structs** — When arguments can be mixed up (especially multiple integers), use a config struct. Dependencies stay positional, configuration goes in the struct.
- **Tagged unions for state machines** — Express multi-state logic as `union(enum)`, not boolean flags.
- **Return struct for multiple values** — `struct { row: *Row, cell: *Cell }`.
- **Callbacks go last** — Mirror control flow. Name with calling function as prefix: `readSector()` / `readSectorCallback()`.
- **Simpler return types** — Reduce dimensionality: `void` > `bool` > `u64` > `?u64` > `!u64`.

## Testing

> Full treatment in `references/testing-strategies.md`.

- **Inline tests** — Place tests alongside the code they test, not in separate files.
- **Size assertions** — Guard against accidental layout changes with `expectEqual(@sizeOf(T), N)`.
- **Tripwire error injection** — Inject errors at specific allocation points to test `errdefer` cleanup. Zero-cost in production.
- **Deterministic simulation** — Stub all non-determinism (clock, network, disk). Seed + commit = reproducible results.
- **Coverage marks** — Trace from test to production code, proving the test exercises the intended path.
- **Fuzz every data structure** — Dedicated fuzzer per major data structure. Use swarm testing for better coverage.
- **Integrity verification** — `verifyIntegrity()` checks all invariants; `assertIntegrity()` is a no-op in release.
- **`refAllDecls`** — Ensure all declarations at least compile.

## Concurrency

- **Default to single-threaded** — Design for single-threaded first. Add concurrency only when proven necessary.
- **Run at your own pace** — Own the event loop. Batch incoming work, process on your schedule.
- **Dirty flags over locks** — Signal what needs updating via `packed struct` flags rather than locking.
- **Atomic values for cross-thread state** — `std.atomic.Value(usize)`.
- **Blocking queues** — Fixed-capacity `BlockingQueue` for producer-consumer between threads.
- **io_uring on Linux** — Submit batched I/O operations, process completions in a loop.

## Sources

- [Ghostty](https://github.com/ghostty-org/ghostty) — Mitchell Hashimoto
- [TigerBeetle](https://github.com/tigerbeetle/tigerbeetle) — TigerBeetle team
- [TIGER_STYLE.md](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md) — TigerBeetle's coding style guide
