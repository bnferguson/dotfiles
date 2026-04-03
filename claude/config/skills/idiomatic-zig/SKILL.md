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

This skill distills patterns from two flagship Zig projects into actionable guidance:

- **Ghostty** — A GPU-accelerated terminal emulator by Mitchell Hashimoto. Demonstrates SIMD optimization, cache-friendly packed structs, offset-based memory addressing, and cross-platform abstraction (Metal/OpenGL/WebGL, GTK/macOS/browser).
- **TigerBeetle** — A distributed financial database. Demonstrates static allocation discipline, assertion-driven safety, deterministic simulation testing, and io_uring integration. Their [TIGER_STYLE.md](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md) is one of the best coding style guides ever written.

## Table of Contents

- [Design Philosophy](#design-philosophy)
- [Memory Management](#memory-management)
- [Safety & Assertions](#safety--assertions)
- [Performance](#performance)
- [Error Handling](#error-handling)
- [Comptime Patterns](#comptime-patterns)
- [Code Organization](#code-organization)
- [Naming & Style](#naming--style)
- [API Design](#api-design)
- [Testing](#testing)
- [Concurrency](#concurrency)

**Deep dives** (load when working on a specific area):
- `references/memory-patterns.md` — Allocator strategies, pools, offset addressing, in-place init
- `references/performance-patterns.md` — SIMD, cache lines, branch hints, hot loop extraction
- `references/safety-and-assertions.md` — Assertion discipline, NASA Power of Ten, pair assertions
- `references/testing-strategies.md` — VOPR, fuzz testing, tripwire error injection, coverage marks
- `references/api-design-patterns.md` — Options structs, tagged unions, generic type functions
- `references/tiger-style-principles.md` — Core philosophy adapted from TigerBeetle's style guide

## Design Philosophy

**Safety, performance, developer experience — in that order.** All three matter, but when they conflict, this is the priority. Good style advances all three simultaneously.

**Simplicity is the hardest revision, not the first attempt.** Spend mental energy upfront in design. An hour of design is worth weeks in production. The "super idea" that solves multiple axes simultaneously is what you're looking for.

**Zero technical debt.** Do it right the first time. The second time may not come. What you ship must be solid — you may lack features, but what you have meets your design goals.

**Be explicit.** Zig's core promise is no hidden control flow, no hidden allocations, no hidden async. Honor this in your code. Minimize dependence on the compiler to do the right thing for you. Pass options explicitly. Show your intent.

**Put a limit on everything.** All loops, queues, and buffers must have a fixed upper bound. This follows the fail-fast principle — violations are detected sooner rather than later.

## Memory Management

> See `references/memory-patterns.md` for complete examples.

### Choose the Right Allocator for Each Layer

Production Zig codebases use different allocators at different layers:

| Layer | Strategy | Example |
|-------|----------|---------|
| Global state | `GeneralPurposeAllocator` (debug) / `c_allocator` (release) | Ghostty top-level |
| Hot-path pages | Direct OS allocation (`mmap`/`VirtualAlloc`) | Ghostty terminal pages |
| Sub-page structures | Bitmap allocators with offset addressing | Ghostty grapheme storage |
| Fixed-size objects | `MemoryPool` / custom pool with bitset | Both: node pools |
| Temporary work | `ArenaAllocator` | Integrity checks, temp buffers |
| Known-size infrastructure | Static allocation at startup | TigerBeetle (all of it) |

### Static Allocation After Init (Performance Optimization)

When your memory usage is known or knowable at startup, allocating everything upfront and forbidding further allocation eliminates unpredictable latency and OOM in production. This is a performance choice, not a universal rule — use it when it fits your domain:

```zig
const State = enum { init, static, deinit };

// After startup:
allocator.transition_from_init_to_static();
// Any subsequent alloc() hits an assertion failure.
```

### In-Place Initialization for Large Structs

Avoid copying large structs off the stack. Initialize in-place via out pointers:

```zig
// Prefer:
fn init(target: *LargeStruct) !void {
    target.* = .{ /* fields */ };
}

// Over:
fn init() !LargeStruct {
    return LargeStruct{ /* fields */ };  // Copies on return.
}
```

In-place initialization is viral — if any field needs it, the whole container should use it.

### Offset-Based Addressing (Ghostty Pattern)

For data structures that need to be memcpy'd, serialized, or moved without pointer fixup, use typed offsets instead of pointers:

```zig
pub fn Offset(comptime T: type) type {
    return packed struct(OffsetInt) {
        offset: OffsetInt = 0,

        pub inline fn ptr(self: Self, base: anytype) [*]T {
            const addr = intFromBase(base) + self.offset;
            return @ptrFromInt(addr);
        }
    };
}
```

### deinit Sets Undefined

After freeing, set the struct to `undefined` to catch use-after-free in safety-checked builds:

```zig
pub fn deinit(self: *Thing, alloc: Allocator) void {
    self.data.deinit(alloc);
    self.* = undefined;
}
```

### errdefer Discipline

Every fallible init must use `errdefer` to clean up partial state:

```zig
pub fn init(alloc: Allocator) !Thing {
    var data = try alloc.alloc(u8, size);
    errdefer alloc.free(data);

    var nodes = try NodeList.initCapacity(alloc, prealloc);
    errdefer nodes.deinit(alloc);

    return .{ .data = data, .nodes = nodes };
}
```

## Safety & Assertions

> See `references/safety-and-assertions.md` for the full discipline.

### Assertion Density

Target a minimum of **two assertions per function**. Assertions are a force multiplier for fuzzing — they turn silent corruption into immediate crashes.

### Pair Assertions

For every property you enforce, find at least two code paths to assert it. Assert validity before writing to disk AND after reading from disk. This catches corruption at both boundaries.

### Assert Positive AND Negative Space

```zig
// Positive: what we expect.
assert(index < length);

// Negative: what we don't expect.
assert(value != sentinel);
```

Bugs live at the boundary between valid and invalid data.

### Split Compound Assertions

```zig
// Prefer:
assert(a);
assert(b);

// Over:
assert(a and b);
```

The former gives precise diagnostics on failure.

### Compile-Time Assertions

Assert relationships between constants. This checks design integrity before execution:

```zig
comptime {
    assert(@sizeOf(Cell) == 8);
    assert(stdx.no_padding(Cell));
    assert(checkpoint_ops >= pipeline_max);
    assert(checkpoint_ops % compaction_ops == 0);
}
```

### Three-Tier Error Strategy (TigerBeetle)

1. **`assert`** — Programmer errors. Invariant violations. Crashes the process. Kept on in production.
2. **`fatal`** — Environmental errors where stopping is correct (disk full, config invalid). Uses typed exit codes.
3. **Error unions** — Expected operational errors that callers must handle.

### Implication Assertions

Use single-line `if` to assert an implication (a => b):

```zig
if (has_grapheme) assert(grapheme_data != null);
```

## Performance

> See `references/performance-patterns.md` for SIMD examples and cache optimization.

### Think Performance at Design Time

The best time to solve performance — the 1000x wins — is in the design phase. Back-of-the-envelope sketches across the four resources (network, disk, memory, CPU) and their two characteristics (bandwidth, latency) are cheap and get you within 90% of the global maximum.

### Optimize for the Slowest Resource First

Network > disk > memory > CPU, adjusted for frequency. A memory cache miss happening millions of times can cost more than a single disk fsync.

### Packed Structs for Cache-Friendly Layout

Design hot data structures to fit in cache lines. Ghostty's `Cell` is exactly 64 bits:

```zig
pub const Cell = packed struct(u64) {
    content_tag: ContentTag,       // 2 bits
    content: packed union { codepoint: u21, ... },
    style_id: StyleId,             // 16 bits
    wide: Wide,                    // 2 bits
    protected: bool,
    hyperlink: bool,
    // ...
};
```

Zero-initialization means "empty cell" by design.

### Row Flags for Fast-Path Skipping

Avoid per-element checks by tracking metadata at the container level:

```zig
pub const Row = packed struct(u64) {
    styled: bool = false,
    grapheme: bool = false,
    hyperlink: bool = false,
    // ...
};

// Fast path: skip expensive work when row has no managed memory.
if (!row.styled and !row.hyperlink and !row.grapheme) {
    fastmem.copy(Cell, dst, src);  // Bulk copy, done.
} else {
    // Slow path: per-cell processing.
}
```

### @branchHint for Hot/Cold Paths

Mark unlikely branches so the compiler can optimize the common path:

```zig
if (self.status_display != .main) {
    @branchHint(.cold);
    return;
}

// For binary search midpoints where both branches are equally likely:
if (take_upper_half) {
    @branchHint(.unpredictable);
    offset = mid;
}
```

### Extract Hot Loops into Standalone Functions

Remove `self` from inner-loop functions so the compiler doesn't need to prove field caching is safe:

```zig
// Instead of a method on Compaction:
fn innerLoop(keys: [*]const Key, values: [*]const Value, count: u32) void {
    // Compiler can freely register-allocate these primitives.
}
```

### Show Division Intent

```zig
// Use the specific division that matches your intent:
@divExact(total, chunk_size)   // Must divide evenly.
@divFloor(total, chunk_size)   // Round toward zero.
stdx.div_ceil(total, chunk_size) // Round up.
```

### Explicit @prefetch with Full Options

```zig
// Always specify all options — don't rely on defaults:
@prefetch(ptr, .{ .cache = .data, .rw = .read, .locality = 0 });
```

### Use u64 for Bulk Zeroing

```zig
// Empirically faster than byte-level zeroing:
@memset(@as([*]u64, @ptrCast(memory))[0 .. memory.len / 8], 0);
```

## Error Handling

### Narrow Error Sets

Define operation-specific error sets rather than using `anyerror`:

```zig
pub const InsertError = error{
    StringsOutOfMemory,
    SetOutOfMemory,
    SetNeedsRehash,
};
```

### Error Translation at Boundaries

When calling subsystems, translate errors to domain-specific names:

```zig
const id = set.add(value) catch |e| switch (e) {
    error.OutOfMemory => return error.HyperlinkSetOutOfMemory,
    error.NeedsRehash => return error.HyperlinkSetNeedsRehash,
};
```

### errdefer comptime unreachable

After a point where no more errors can occur, document it:

```zig
try self.nodes.insert(alloc, idx, value);
errdefer comptime unreachable;
// Everything below is infallible.
```

## Comptime Patterns

### Generic Data Structures via Type Functions

The dominant pattern for reusable data structures:

```zig
pub fn TreeType(comptime Table: type, comptime Storage: type) type {
    return struct {
        const Tree = @This();
        pub const TableType = Table;
        // ... methods that use Table and Storage ...
    };
}
```

### Type Generation from Data Tables

Define data as a table, generate multiple types at comptime:

```zig
const entries = [_]ModeEntry{
    .{ .name = "cursor_visible", .default = true, .ansi = 25 },
    .{ .name = "auto_wrap", .default = true, .ansi = 7 },
    // ...
};

// Generate packed struct of booleans:
pub const ModePacked = packed_struct: {
    var fields: [entries.len]StructField = undefined;
    for (entries, 0..) |entry, i| {
        fields[i] = .{ .name = entry.name, .type = bool, .default_value_ptr = &entry.default };
    }
    break :packed_struct @Type(.{ .@"struct" = .{ .layout = .@"packed", .fields = &fields } });
};
```

### inline else for Comptime Dispatch

Turn runtime enum values into comptime-known values for specialization:

```zig
pub fn set(self: *ModeState, mode: Mode, value: bool) void {
    switch (mode) {
        inline else => |mode_comptime| {
            const entry = comptime entryForMode(mode_comptime);
            @field(self.values, entry.name) = value;
        },
    }
}
```

### Platform Selection at Comptime

```zig
pub const Io = switch (builtin.target.os.tag) {
    .linux => IoLinux,
    .macos, .ios => IoDarwin,
    .windows => IoWindows,
    else => @compileError("unsupported platform"),
};
```

### Compile-Time Layout Verification

```zig
comptime {
    assert(@sizeOf(TransferPending) == 16);
    assert(stdx.no_padding(TransferPending));  // No implicit padding bytes.
}
```

## Code Organization

### File-as-Struct (Ghostty)

Major types get their own PascalCase file. The struct is `@This()`:

```zig
// src/terminal/Terminal.zig
const Terminal = @This();
```

Lowercase files (`page.zig`, `style.zig`) are modules exporting multiple related types.

### Flat Namespacing (TigerBeetle)

Prefer `stdx.PRNG` over `stdx.random.PRNG`. Directness over scalability.

### Root Re-Export Module

A `main.zig` or package root re-exports public types:

```zig
pub const BlockingQueue = @import("blocking_queue.zig").BlockingQueue;
pub const CircBuf = @import("circ_buf.zig").CircBuf;
```

### Config / Constants Split (TigerBeetle)

Raw configuration in `config.zig`. Derived compile-time constants in `constants.zig`. Code imports `constants`, never `config` directly. This creates a single place to verify all derived relationships.

### Struct Field Order

Fields first, then types, then methods. Important things near the top. `main` goes first in files:

```zig
const Tracer = struct {
    // Fields first.
    time: Time,
    process_id: ProcessID,

    // Types next.
    const ProcessID = struct { cluster: u128, replica: u8 };

    // Methods last.
    pub fn init(gpa: Allocator, time: Time) !Tracer { ... }
};
```

### Scoped Logging

Every module creates a scoped logger:

```zig
const log = std.log.scoped(.terminal);
```

### Modular Build System (Ghostty)

Keep `build.zig` thin. Delegate to file-structs in `src/build/`:

```zig
// src/build/GhosttyExe.zig, SharedDeps.zig, etc.
// Each artifact knows how to configure and install itself.
```

## Naming & Style

Follow the [Zig style guide](https://ziglang.org/documentation/master/#Style-Guide). Where Ghostty
and TigerBeetle disagree, the Zig stdlib is the tiebreaker.

### Naming Rules (from Zig Style Guide)

- **Types**: `TitleCase` — `ArrayList`, `Allocator`, `SemanticVersion`
- **Functions/methods**: `camelCase` — `insertSlice`, `appendAssumeCapacity`
- **Functions returning `type`**: `TitleCase` — `fn ArrayList(comptime T: type) type`
- **Variables and constants**: `snake_case` — `max_connections`, `default_timeout_ms`
- **File names**: `TitleCase.zig` for file-as-struct (files with top-level fields), `snake_case.zig` for namespace modules

```
TitleCase files:   Thread.zig, Allocator.zig, Terminal.zig  (struct with fields)
snake_case files:  hash_map.zig, mem.zig, config.zig        (namespace, no fields)
```

### Acronyms Are Regular Words

The Zig style guide is explicit: acronyms follow the same casing rules as any other word. Even
two-letter acronyms:

```zig
// Correct (stdlib convention):
const XmlParser = struct { ... };
const TcpServer = struct { ... };
const Io = @import("Io.zig");
fn readU32Be() u32 {}

// Wrong:
const XMLParser = struct { ... };  // Acronym not title-cased.
const TCPServer = struct { ... };  // Same.
const IO = @import("IO.zig");     // Same.
```

> Note: TigerBeetle uses `VSRState` and Ghostty uses `IO` — both deviate from the stdlib here.
> The stdlib uses `Io`, `Uri`, `Tcp`, `Tls`. Follow the stdlib.

### Units and Qualifiers Last, by Descending Significance

```zig
latency_ms_max    // Not max_latency_ms.
latency_ms_min    // Lines up with latency_ms_max.
```

### Same-Length Related Names

Choose names with equal character counts so related variables align:

```zig
source_offset  // Not src_offset.
target_offset  // Lines up with source_offset.
```

### No Abbreviations

Use full words. `source` and `target`, not `src` and `dest`. Exception: primitive loop variables in sort/matrix code.

### Nouns Over Adjectives

`replica.pipeline` over `replica.preparing`. Nouns compose better for derived identifiers (`pipeline_max`) and work directly in documentation.

### Infuse Names with Meaning

`gpa: Allocator` and `arena: Allocator` are better than `allocator: Allocator` — they tell you whether `deinit` should be called explicitly.

### Comments Are Sentences

Capital letter, full stop, space after `//`. End-of-line comments can be phrases without punctuation. Always say **why**, not just what.

### Formatting

- Run `zig fmt`.
- 4-space indentation.
- Hard 100-column line limit.
- Braces on `if` unless it fits on one line.
- 70-line function limit (TigerBeetle). Art is born of constraints.

## API Design

> See `references/api-design-patterns.md` for full examples.

### Options Structs for Named Arguments

When arguments can be mixed up (especially multiple integers), use an options struct:

```zig
pub const Options = struct {
    cols: CellCountInt,
    rows: CellCountInt,
    max_scrollback: usize = 10_000,
    colors: Colors = .default,
};

pub fn init(alloc: Allocator, opts: Options) !Terminal { ... }
```

Dependencies (allocator, tracer) stay positional. Configuration goes in the struct.

### Tagged Unions for State Machines

Express multi-state logic as tagged unions, not boolean flags:

```zig
pub const CommitStage = union(enum) {
    idle,
    prefetch,
    execute,
    checkpoint_data: CheckpointProgress,
    compact,
};
```

### Return Struct for Multiple Values

```zig
pub fn getRowAndCell(self: *const Page, x: usize, y: usize) struct { row: *Row, cell: *Cell } {
    // ...
    return .{ .row = row, .cell = cell };
}
```

### Generic Renderer Pattern (Ghostty)

Use comptime generics to create implementations from any backend:

```zig
pub fn Renderer(comptime GraphicsAPI: type) type {
    return struct {
        const Self = @This();
        pub const API = GraphicsAPI;
        // Methods use GraphicsAPI.Target, GraphicsAPI.Buffer, etc.
    };
}
```

### Callbacks Go Last

Mirror control flow — callbacks are invoked last, so they appear last in parameter lists. Name them with the calling function as prefix: `readSector()` and `readSectorCallback()`.

## Testing

> See `references/testing-strategies.md` for VOPR, fuzz, and tripwire details.

### Inline Tests

Tests live alongside the code they test, not in separate files.

### Size Assertions in Tests

Guard against accidental layout changes:

```zig
test {
    try std.testing.expectEqual(8, @sizeOf(ModePacked));
    try std.testing.expectEqual(8, @sizeOf(Cell));
}
```

### Tripwire Error Injection (Ghostty)

Inject errors at specific points to test errdefer cleanup paths:

```zig
const init_tw = tripwire.module(enum { alloc_data, alloc_nodes }, init);

test "init fails on alloc_data" {
    init_tw.errorAlways(.alloc_data, error.OutOfMemory);
    try std.testing.expectError(error.OutOfMemory, init(...));
}
```

Zero-cost in production — completely optimized away.

### Deterministic Simulation Testing (TigerBeetle VOPR)

Stub all non-determinism (clock, network, disk). A seed + git commit produces perfectly reproducible results. One minute of VOPR time equals days of real-world testing.

### Coverage Marks (TigerBeetle)

Trace from test to production code, proving your test actually exercises the path you think it does:

```zig
// In production:
log.mark.info("x is even (x={})", .{x});

// In test:
const mark = marks.check("x is even");
production_function(92);
try mark.expect_hit();
```

### Fuzz Every Data Structure

Every major data structure should have a dedicated fuzzer. Use swarm testing to randomly disable enum variants and skew probabilities for better coverage.

### Integrity Verification

Complex data structures should have a `verifyIntegrity()` function that checks all invariants. Call it via an `assertIntegrity()` that is a no-op in release builds:

```zig
pub inline fn assertIntegrity(self: *const Page) void {
    if (comptime build_options.slow_runtime_safety) {
        self.verifyIntegrity() catch |e| @panic(@errorName(e));
    }
}
```

### refAllDecls for Compilation Coverage

Ensure all declarations at least compile:

```zig
test {
    std.testing.refAllDecls(@This());
}
```

## Concurrency

### Default to Single-Threaded

TigerBeetle is explicitly single-threaded: "The overhead of synchronization tends to dominate useful work." Design for single-threaded first, add concurrency only when proven necessary.

### Run at Your Own Pace

Don't react directly to external events. Run your own event loop, batch incoming work, and process it on your schedule. This keeps control flow under your control and enables batching.

### io_uring on Linux

For I/O-heavy workloads, io_uring eliminates syscall overhead. Submit batches of I/O operations, process completions in a loop, and flush any SQEs queued during callbacks within the same tick.

### Dirty Flags Over Locks

When possible, use dirty flags to signal what needs updating rather than locking during every state change:

```zig
pub const Dirty = packed struct {
    palette: bool = false,
    clear: bool = false,
};
```

### Atomic Values for Cross-Thread State

```zig
modified: std.atomic.Value(usize) = .{ .raw = 0 },
```

### Blocking Queue for Thread Communication

Fixed-capacity blocking queues for producer-consumer between threads:

```zig
pub const Mailbox = BlockingQueue(Message, 64);
```

## Zero Dependencies (TigerBeetle)

TigerBeetle has a zero-dependencies policy. Dependencies lead to supply chain attacks, safety risk, and slow installs. For foundational infrastructure, the cost of any dependency is amplified throughout the stack.

When you need a tool, write it in Zig. `scripts/*.zig` instead of `scripts/*.sh`. This gives you type safety, cross-platform portability, and a single toolchain.

## Sources

- [Ghostty](https://github.com/ghostty-org/ghostty) — Mitchell Hashimoto
- [TigerBeetle](https://github.com/tigerbeetle/tigerbeetle) — TigerBeetle team
- [TIGER_STYLE.md](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md) — TigerBeetle's coding style guide
