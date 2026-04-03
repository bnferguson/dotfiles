# Memory Management Patterns

Deep dive into memory strategies from Ghostty and TigerBeetle.

## Direct OS Allocation (Ghostty)

Terminal pages bypass the Zig allocator entirely using `mmap`/`VirtualAlloc` for page-aligned,
zero-initialized memory. Both guarantee zeroed pages, which is a critical property — it means
"empty cell" is the zero value.

```zig
const AllocPosix = struct {
    pub fn alloc(n: usize) ![]align(std.heap.page_size_min) u8 {
        return try posix.mmap(
            null, n,
            posix.PROT.READ | posix.PROT.WRITE,
            .{ .TYPE = .PRIVATE, .ANONYMOUS = true },
            -1, 0,
        );
    }
};
```

**When to use:** Hot-path allocations where the Zig allocator's overhead (small but real) is
meaningful, and you need guaranteed zero-initialization and page alignment.

## Single Contiguous Allocation with Offset Addressing (Ghostty)

Each terminal `Page` is a single contiguous memory block. All sub-structures (rows, cells, styles,
graphemes, hyperlinks) live within it, addressed via typed offsets rather than pointers.

### The Offset Type

```zig
pub fn Offset(comptime T: type) type {
    return packed struct(OffsetInt) {
        offset: OffsetInt = 0,

        pub inline fn ptr(self: Self, base: anytype) [*]T {
            const addr = intFromBase(base) + self.offset;
            assert(addr % @alignOf(T) == 0);
            return @ptrFromInt(addr);
        }
    };
}
```

### Layout Computation at Comptime

The `Layout` struct computes exact byte offsets for each sub-structure:

```zig
pub inline fn layout(cap: Capacity) Layout {
    const rows_start = 0;
    const rows_end = rows_start + (rows_count * @sizeOf(Row));
    const cells_start = alignForward(usize, rows_end, @alignOf(Cell));
    const cells_end = cells_start + (cells_count * @sizeOf(Cell));
    // ... each section placed after the last with proper alignment ...
    const total_size = alignForward(usize, last_end, std.heap.page_size_min);
}
```

**Benefits:**
- Entire page can be memcpy'd, serialized, or moved without pointer fixup.
- No pointer chasing — all data is at known offsets from a base address.
- Cache-friendly — sequential access patterns work well.

**When to use:** Data structures that need to be copied, serialized, or have stable layout
requirements. Terminal emulator pages, network packet buffers, shared memory regions.

## Offset-Based String Storage (Ghostty)

Strings within pages use a `BitmapAllocator` for sub-page allocation:

```zig
pub fn BitmapAllocator(comptime chunk_size: comptime_int) type {
    return struct {
        bitmap: Offset(u64),       // 1 = free, 0 = used
        bitmap_count: usize,
        chunks: Offset(u8),
    };
}
```

Using 1 for free bits makes finding free chunks faster — `@ctz` on the bitmap word gives you the
first free chunk.

```zig
const page_uri: Offset(u8).Slice = uri: {
    const buf = self.string_alloc.alloc(u8, self.memory, link.uri.len) catch |err| switch (err) {
        error.OutOfMemory => return error.StringsOutOfMemory,
    };
    errdefer self.string_alloc.free(self.memory, buf);
    @memcpy(buf, link.uri);
    break :uri .{
        .offset = size.getOffset(u8, self.memory, &buf[0]),
        .len = link.uri.len,
    };
};
```

## Static Allocation After Init (Performance Optimization)

When memory usage is known or knowable at startup, allocating everything upfront eliminates
unpredictable latency and OOM in production. TigerBeetle's `StaticAllocator` enforces a
three-phase lifetime:

```zig
const State = enum {
    init,    // Allow alloc and resize.
    static,  // Don't allow any calls. Production state.
    deinit,  // Allow free but not alloc/resize.
};
```

After startup completes, `transition_from_init_to_static()` is called. Any subsequent allocation
attempt hits an assertion failure.

**Why:** Eliminates unpredictable latency from allocation and OOM in production. Forces all memory
usage patterns to be considered upfront as part of the design. This is a performance choice — use
it when your memory needs are knowable, not as a universal rule.

## Memory Pools

### Typed Pool with Bitset (TigerBeetle)

```zig
pub fn acquire(pool: *NodePool) Node {
    const node_index = pool.free.findFirstSet() orelse vsr.fatal(...);
    pool.free.unset(node_index);
    return @alignCast(pool.buffer[node_index * node_size ..][0..node_size]);
}
```

### std.heap.MemoryPool (Ghostty)

```zig
const NodePool = std.heap.MemoryPool(List.Node);
const PagePool = std.heap.MemoryPoolAligned(
    [std_size]u8,
    .fromByteUnits(std.heap.page_size_min),
);
```

Pools are preheated with a reasonable minimum to avoid early allocations.

### IOPSType — Fixed-Capacity Operation Pool (TigerBeetle)

```zig
pub fn IOPSType(comptime T: type, comptime size: u8) type {
    return struct {
        items: [size]T = undefined,
        busy: Map = .{},
        pub fn acquire(self: *IOPS) ?*T { ... }
        pub fn release(self: *IOPS, item: *T) void { ... }
    };
}
```

Used throughout for bounding concurrent I/O operations.

## Huge Page Allocator (TigerBeetle)

Wraps `page_allocator` and applies `MADV_HUGEPAGE` on Linux to reduce TLB pressure:

```zig
// src/stdx/huge_page_allocator.zig
```

**When to use:** Large allocations (megabytes+) on Linux where TLB miss reduction matters.

## In-Place Initialization

Prefer in-place initialization for any struct larger than a few cache lines:

```zig
// Prefer — no intermediate copy:
fn init(target: *LargeStruct) !void {
    target.* = .{
        .field_a = try compute_a(),
        .field_b = try compute_b(),
    };
}

fn main() !void {
    var target: LargeStruct = undefined;
    try target.init();
}
```

In-place init is viral — if any field needs it, the container should use it too. This enables
pointer stability and immovable types.

## Allocator Strategy by Layer (Summary)

```
Application startup
  └── GeneralPurposeAllocator (debug) / c_allocator (release)
       ├── StaticAllocator wrapper (when memory needs are known at startup)
       ├── MemoryPool for fixed-size objects
       ├── ArenaAllocator for temporary work
       └── Direct OS allocation for hot paths (Ghostty)
            ├── Offset-based sub-allocation
            └── BitmapAllocator for variable-size within page
```

## deinit Patterns

### Set to Undefined After Free

```zig
pub fn deinit(self: *Thing, alloc: Allocator) void {
    self.data.deinit(alloc);
    self.children.deinit(alloc);
    self.* = undefined;  // Catches use-after-free in debug.
}
```

### Group Allocation and Deallocation

Use newlines to visually pair allocation with its corresponding `defer`:

```zig
var data = try alloc.alloc(u8, size);
defer alloc.free(data);

var nodes = try NodeList.initCapacity(alloc, prealloc);
defer nodes.deinit(alloc);
```

### errdefer for Partial Init

```zig
pub fn init(alloc: Allocator) !Atlas {
    var result = Atlas{
        .data = try alloc.alloc(u8, size),
    };
    errdefer result.deinit(alloc);  // Clean up .data if below fails.

    result.nodes = try .initCapacity(alloc, node_prealloc);
    return result;
}
```
