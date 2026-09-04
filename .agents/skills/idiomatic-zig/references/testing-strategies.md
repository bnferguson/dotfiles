# Testing Strategies

Testing patterns from Ghostty and TigerBeetle — two codebases with exceptional test discipline.

## Inline Tests

Place tests alongside the code they test:

```zig
pub const Cell = packed struct(u64) {
    // ... fields ...
};

test {
    try std.testing.expectEqual(8, @sizeOf(Cell));
}

test "cell zero is empty" {
    const cell: Cell = @bitCast(@as(u64, 0));
    try std.testing.expectEqual(.narrow, cell.wide);
    try std.testing.expectEqual(false, cell.protected);
}
```

## Size Assertions

Guard against accidental layout changes with compile-time and runtime size checks:

```zig
comptime {
    assert(@sizeOf(Cell) == 8);
    assert(@sizeOf(Row) == 8);
    assert(stdx.no_padding(TransferPending));
}

test {
    try std.testing.expectEqual(8, @sizeOf(ModePacked));
}
```

## refAllDecls for Compilation Coverage

Use `refAllDecls` to ensure all declarations at least compile, even if not directly tested:

```zig
test {
    std.testing.refAllDecls(@This());
    _ = @import("comparison.zig");  // Also pull in related modules.
}
```

`refAllDecls` is shallow: it references the container's own declarations, so a *method* on a
nested struct is not analysed by it. Zig only analyses functions that are actually reached,
which means an untested method can reference a deleted stdlib API and still "compile" for
years. Name such functions explicitly:

```zig
test "every declaration compiles" {
    std.testing.refAllDecls(@This());
    // `listen` has no unit test -- it needs a real network. Taking its address
    // still forces the compiler through its body.
    _ = &Server.listen;
}
```

This is worth doing for anything I/O-shaped, which by definition resists unit testing and is
therefore exactly what silently rots across a release.

## Tripwire Error Injection (Ghostty)

Inject errors at specific allocation points to verify errdefer cleanup paths:

```zig
const init_tw = tripwire.module(enum { alloc_data, alloc_nodes }, init);

pub fn init(alloc: Allocator, size: u32, format: Format) Allocator.Error!Atlas {
    const tw = init_tw;
    try tw.check(.alloc_data);
    var result = Atlas{ .data = try alloc.alloc(u8, size) };
    errdefer result.deinit(alloc);
    try tw.check(.alloc_nodes);
    result.nodes = try .initCapacity(alloc, node_prealloc);
    return result;
}
```

In tests:

```zig
test "init fails on alloc_data" {
    init_tw.errorAlways(.alloc_data, error.OutOfMemory);
    try std.testing.expectError(error.OutOfMemory, init(...));
    try init_tw.end(.reset);
}

test "init fails on alloc_nodes — data is freed via errdefer" {
    init_tw.errorAlways(.alloc_nodes, error.OutOfMemory);
    try std.testing.expectError(error.OutOfMemory, init(...));
    // If errdefer didn't fire, we'd have a memory leak detectable by
    // the testing allocator.
    try init_tw.end(.reset);
}
```

**Key:** Tripwires are zero-cost in production — completely optimized away outside test builds.

## Deterministic Simulation Testing — VOPR (TigerBeetle)

VOPR (Viewstamped Operation Replicator) is TigerBeetle's deterministic simulation framework.

### Core Idea

Stub all sources of non-determinism:
- **Clock** — deterministic time source
- **Network** — simulated with configurable delays, drops, reordering
- **Disk** — simulated with configurable failures, latency

A **seed + git commit** produces perfectly reproducible results.

### Impact

> "One minute of VOPR time is equivalent to days of real-world testing."

Keep assertions on in production — VOPR exercises paths that would take years of real-world
operation to hit.

### Seed from Git Commit

Pass the current commit hash as the fuzzer seed. Any failure can be reproduced exactly from
the commit alone.

### What Zig 0.16 Changes

`std.Io` standardises the seam this technique depends on. Clock, network, disk and task
scheduling now reach the program through one interface value rather than through ambient
`std.fs` / `std.time` / `std.Thread` calls, so "stub all sources of non-determinism" no
longer means auditing every call site for hidden I/O — a function without an `Io` parameter
cannot have any.

Do not mistake the seam for the simulator. `Io.VTable` is roughly 116 function pointers, and
the shipped implementations (`Threaded`, and `Evented` over io_uring / kqueue / Dispatch) are
all real I/O. A deterministic implementation is still yours to write. 0.16 gives you a
defined interface to write it against and a compiler-checked guarantee that nothing bypasses
it.

For ordinary tests, use `std.testing.io` — a `Threaded` instance the test runner sets up:

```zig
test "blocking queue rejects when full" {
    const io = std.testing.io;
    var queue: BlockingQueue(u8, 2) = .{};
    try queue.push(io, 1);
    try queue.push(io, 2);
    try std.testing.expectError(error.QueueFull, queue.push(io, 3));
}
```

## Fuzz Every Data Structure (TigerBeetle)

Give every major data structure a dedicated fuzzer:

```zig
const Fuzzers = .{
    .ewah = @import("./ewah_fuzz.zig"),
    .lsm_cache_map = @import("./lsm/cache_map_fuzz.zig"),
    .lsm_forest = @import("./lsm/forest_fuzz.zig"),
    .lsm_tree = @import("./lsm/tree_fuzz.zig"),
    .vsr_superblock = @import("./vsr/superblock_fuzz.zig"),
    .state_machine = @import("./state_machine_fuzz.zig"),
    // ...
};
```

Test the data structure against a simple reference implementation. If the optimized
implementation diverges from the reference, the fuzzer catches it.

## Swarm Testing (TigerBeetle)

Randomly disable enum variants and skew probabilities for better coverage:

```zig
pub fn random_enum_weights(prng: *stdx.PRNG, comptime Enum: type) ... {
    var combination = stdx.PRNG.Combination.init(.{
        .total = fields.len,
        .sample = prng.range_inclusive(u32, 1, fields.len),
    });
    // Each variant gets either 0 weight (disabled) or random 1-100.
}
```

This explores the state space more effectively than uniform random testing.

## Coverage Marks (TigerBeetle)

Trace from test to production code, proving the test exercises the expected path:

```zig
// In production code:
const log = marks.wrap_log(std.log.scoped(.my_module));

fn process(x: u32) void {
    if (x % 2 == 0) {
        log.mark.info("x is even (x={})", .{x});
        // ... handle even case ...
    }
}

// In test code:
test "process handles even numbers" {
    const mark = marks.check("x is even");
    process(92);
    try mark.expect_hit();
}
```

**Why this matters:** Traditional tests only verify output. Coverage marks verify that the test
actually exercised the specific code path intended. Without marks, a test might pass
via an unintended path.

## Integrity Verification (Ghostty)

Give complex data structures a comprehensive `verifyIntegrity()` function:

```zig
pub const IntegrityError = error{
    ZeroRowCount,
    ZeroColCount,
    UnmarkedGraphemeRow,
    MissingGraphemeData,
    InvalidGraphemeCount,
    // ... 12+ specific violations ...
};

pub fn verifyIntegrity(self: *const Page) IntegrityError!void {
    if (self.capacity.rows == 0) return error.ZeroRowCount;
    if (self.capacity.cols == 0) return error.ZeroColCount;

    for (self.rows()) |row| {
        if (row.grapheme) {
            // Verify every grapheme cell has valid data.
            for (self.cellsForRow(row)) |cell| {
                if (cell.hasGrapheme()) {
                    if (self.lookupGrapheme(cell) == null)
                        return error.MissingGraphemeData;
                }
            }
        }
    }
    // ... more invariant checks ...
}
```

Call via `assertIntegrity()` which is a no-op in release:

```zig
pub inline fn assertIntegrity(self: *const Page) void {
    if (comptime build_options.slow_runtime_safety) {
        self.verifyIntegrity() catch |e| @panic(@errorName(e));
    }
}
```

## Custom Linting (TigerBeetle)

`src/tidy.zig` — a custom Zig-based linter checking non-functional properties. Run as
`zig build test -- tidy`. Checks things that `zig fmt` doesn't: naming conventions, import
ordering, file organization.

**Pattern:** Write the linter in Zig. It runs with the build, has type safety, and is
cross-platform. No shell scripts or external tools needed.

## Continuous Fuzzing

Run fuzzers continuously (TigerBeetle uses a dedicated cluster — CFO, Continuous Fuzzing
Orchestrator — running 24/7). Capture the seed on failure for reproduction.

## Test Description Pattern

Write a description at the top of complex tests explaining goal and methodology:

```zig
test "page compaction preserves grapheme integrity under concurrent modification" {
    // Goal: Verify that compacting a page while new graphemes are being written
    // doesn't corrupt the grapheme bitmap or orphan grapheme data.
    //
    // Method: Pre-populate a page with 100 grapheme cells, start a compaction,
    // write 50 new graphemes during compaction, verify integrity after.
    //
    // This catches the bug where compaction's bulk memcpy overwrites the bitmap
    // without updating grapheme reference counts.

    // ... test body ...
}
```

## Exhaustive Testing

Test exhaustively — not only valid data but also invalid data, and the transition from valid
to invalid:

```zig
test "reject invalid codepoints" {
    // Valid range.
    for (0..0x110000) |cp| {
        if (isValidCodepoint(@intCast(cp))) {
            try expectNoError(process(@intCast(cp)));
        }
    }

    // Just beyond valid range.
    try std.testing.expectError(error.InvalidCodepoint, process(0x110000));
    try std.testing.expectError(error.InvalidCodepoint, process(0xFFFFFF));
}
```
