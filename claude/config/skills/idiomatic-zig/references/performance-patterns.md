# Performance Patterns

Deep dive into performance optimization from Ghostty and TigerBeetle.

## Design-Time Performance

> "The lack of back-of-the-envelope performance sketches is the root of all evil."

The 1000x wins come from the design phase — before you can measure or profile. Perform
back-of-the-envelope sketches for the four resources and their two characteristics:

| Resource | Bandwidth | Latency |
|----------|-----------|---------|
| Network  | ~10 Gbps  | ~1ms    |
| Disk     | ~1 GBps SSD | ~100μs SSD |
| Memory   | ~50 GBps  | ~100ns  |
| CPU      | ~GHz      | ~1ns    |

Optimize for the slowest resources first, adjusted for frequency. A memory cache miss happening
millions of times costs more than a single disk fsync.

## Packed Structs for Cache-Friendly Layout (Ghostty)

Ghostty's `Cell` is exactly 64 bits — one machine word:

```zig
pub const Cell = packed struct(u64) {
    content_tag: ContentTag,       // 2 bits
    content: packed union {
        codepoint: u21,
        // ...
    } = .{ .codepoint = 0 },
    style_id: StyleId,             // 16 bits
    wide: Wide,                    // 2 bits
    protected: bool,
    hyperlink: bool,
    semantic_content: SemanticContent, // 2 bits
    _padding: u16 = 0,
};
```

`Row` is also `packed struct(u64)`. Zero-initialization equals "empty" by design — no constructor
needed, `@memset` to zero clears a row.

**Design principle:** Make your zero value meaningful. If zero = empty/default, initialization and
clearing become trivial `@memset` operations.

## Row Flags for Fast-Path Skipping (Ghostty)

Track metadata at the container level to skip expensive per-element work:

```zig
pub const Row = packed struct(u64) {
    styled: bool = false,
    grapheme: bool = false,
    hyperlink: bool = false,
    // ...

    pub inline fn managedMemory(self: Row) bool {
        return self.styled or self.hyperlink or self.grapheme;
    }
};
```

Operations check this first:

```zig
if (!src_row.managedMemory()) {
    // Fast path: bulk copy, no per-cell processing.
    fastmem.copy(Cell, dst_cells, src_cells);
} else {
    // Slow path: handle graphemes, hyperlinks, styles per-cell.
    for (src_cells, dst_cells) |*src, *dst| {
        // ...
    }
}
```

## SIMD with Scalar Fallback (Ghostty)

SIMD routines live in dedicated files. C++ implementations access platform intrinsics; Zig provides
scalar fallbacks:

```zig
pub fn indexOf(input: []const u8, needle: u8) ?usize {
    if (comptime options.simd) {
        const result = ghostty_simd_index_of(needle, input.ptr, input.len);
        return if (result == input.len) null else result;
    }
    return indexOfScalar(input, needle);
}
```

UTF-8 decoding also has a SIMD fast path that decodes into `u32` codepoint arrays for bulk
processing.

**Pattern:** Define the interface in Zig, implement hot paths in C/C++ for SIMD intrinsics, provide
a Zig scalar fallback, and select at comptime via build options.

## @branchHint (Both)

### Cold Paths

```zig
if (self.status_display != .main) {
    @branchHint(.cold);
    return;
}
```

### Unlikely Branches

```zig
if (c > 255 and self.modes.get(.grapheme_cluster)) grapheme: {
    @branchHint(.unlikely);
    // Expensive grapheme clustering path.
}
```

### Unpredictable Branches (Binary Search)

```zig
if (take_upper_half) {
    @branchHint(.unpredictable);
    offset = mid;
}
```

This tells the CPU's branch predictor not to speculate — both paths are equally likely.

## Prefetching in Binary Search (TigerBeetle)

Prefetch the next two midpoints while processing the current comparison:

```zig
const one_quarter = values.ptr + offset + half / 2;
const three_quarters = one_quarter + half;

inline for (0..cache_lines_per_value) |i| {
    @prefetch(@as(CacheLineBytes, @ptrCast(@alignCast(one_quarter))) + i, .{
        .rw = .read, .locality = 0, .cache = .data,
    });
    @prefetch(@as(CacheLineBytes, @ptrCast(@alignCast(three_quarters))) + i, .{
        .rw = .read, .locality = 0, .cache = .data,
    });
}
```

**Always specify all options to `@prefetch`.** Don't rely on defaults.

## Cache-Line-Aligned Data Structures (TigerBeetle)

The set-associative cache is designed around cache line sizes:

```zig
pub const Layout = struct {
    ways: u64 = 16,
    tag_bits: u64 = 8,
    clock_bits: u64 = 2,
    cache_line_size: u64 = 64,
};
```

Tournament tree arrays are aligned to cache lines:

```zig
loser_keys: [node_count_max]Key align(64),
loser_ids: [node_count_max]u32 align(64),
```

## Extract Hot Loops (TigerBeetle)

Remove `self` from inner-loop functions. The compiler doesn't need to prove field caching is safe
when arguments are primitives:

```zig
// Instead of:
fn process(self: *Compaction) void {
    for (self.items) |item| {
        // Compiler must prove self.field doesn't alias item.
    }
}

// Do:
fn processInner(items: [*]const Item, keys: [*]const Key, count: u32) void {
    // Compiler can freely register-allocate these primitives.
}
```

## Fast Memory Operations (Ghostty)

### libc memcpy/memmove When Available

```zig
pub inline fn move(comptime T: type, dest: []T, source: []const T) void {
    if (builtin.link_libc) {
        _ = memmove(dest.ptr, source.ptr, source.len * @sizeOf(T));
    } else {
        @memmove(dest, source);
    }
}
```

### u64 Zeroing

```zig
// Empirically faster than byte-level:
@memset(@as([*]u64, @ptrCast(self.memory))[0 .. self.memory.len / 8], 0);
```

## Custom Inline Assert (Ghostty)

`std.debug.assert` wasn't always optimized away in ReleaseFast. Ghostty created a custom version
that guarantees inlining:

```zig
pub const inlineAssert = switch (builtin.mode) {
    .Debug => std.debug.assert,
    .ReleaseSmall, .ReleaseSafe, .ReleaseFast => (struct {
        inline fn assert(ok: bool) void {
            if (!ok) unreachable;
        }
    }).assert,
};
```

15-20% overhead was observed without this in hot paths.

## Batching (TigerBeetle)

Amortize costs by batching accesses to network, disk, memory, and CPU. Distinguish control plane
(infrequent, can be expensive) from data plane (frequent, must be fast).

```
Control plane: configuration, replica management, schema changes
Data plane: transaction processing, reads, writes
```

Keep heavy assertions and validation on the control plane. Keep the data plane lean.

## Be Explicit About Compiler Optimization

Don't depend on the compiler doing the right thing. Explicitly:
- Use `@call(.always_inline, fn, args)` for critical inner-loop functions.
- Use `@setRuntimeSafety(constants.verify)` to disable bounds checks in hot paths during release.
- Show division intent with `@divExact`, `@divFloor`, `div_ceil`.
- Pass full options to builtins like `@prefetch`.

## Explicitly-Sized Types

Use `u32`/`u64` for wire formats, on-disk structures, and data that must be identical across
architectures. TigerBeetle avoids `usize` entirely for cross-architecture determinism.

For general Zig code, `usize` is the stdlib convention for sizes, lengths, and indices — it's the
type of slice `.len` and what allocator APIs accept. Use it unless you have a specific reason for
a fixed-width type.
