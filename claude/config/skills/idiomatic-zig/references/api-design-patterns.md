# API Design Patterns

Patterns for designing Zig APIs from Ghostty and TigerBeetle.

## Options Structs for Named Arguments

When arguments can be mixed up — especially multiple integers — use an options struct:

```zig
pub const Options = struct {
    cols: CellCountInt,
    rows: CellCountInt,
    max_scrollback: usize = 10_000,
    colors: Colors = .default,
    default_modes: ModePacked = .{},
};

pub fn init(alloc: Allocator, opts: Options) !Terminal { ... }
```

### What Goes Positional vs. Struct

Dependencies (allocator, tracer, io) stay positional — they're singletons with unique types,
threaded through constructors from most general to most specific:

```zig
pub fn init(gpa: Allocator, io: *IO, opts: Options) !Server { ... }
```

Configuration goes in the options struct.

### When to Use

From TigerBeetle's style guide: *"A function taking two `u64` must use an options struct."*

If an argument can be `null`, name it so the meaning of `null` at the call site is clear.

## Generic Data Structures via Type Functions

The dominant pattern for reusable data structures:

```zig
pub fn TreeType(comptime Table: type, comptime Storage: type) type {
    return struct {
        const Tree = @This();
        pub const TableType = Table;

        storage: *Storage,
        table: Table,

        pub fn init(storage: *Storage) Tree {
            return .{ .storage = storage, .table = Table.init() };
        }

        pub fn get(self: *Tree, key: Table.Key) ?*const Table.Value {
            return self.table.get(key);
        }
    };
}
```

**Convention:** The type function is named `FooType` (e.g., `TreeType`, `ReplicaType`,
`CompactionType`). Inside, `const Foo = @This();` aliases the returned struct.

### Comptime Callbacks

For performance-critical generic code, use `callconv(.@"inline")` function pointers:

```zig
pub fn SortedArrayType(
    comptime Value: type,
    comptime key_from_value: fn (*const Value) callconv(.@"inline") Key,
    comptime compare: fn (Key, Key) callconv(.@"inline") std.math.Order,
) type {
    return struct { ... };
}
```

## Tagged Unions for State Machines

Express multi-state logic as tagged unions, not boolean flags:

```zig
pub const CommitStage = union(enum) {
    idle,
    start,
    prefetch,
    stall,
    execute,
    checkpoint_data: CheckpointProgress,
    checkpoint_superblock,
    compact,
};

fn step(self: *Replica) void {
    switch (self.commit_stage) {
        .idle => {},
        .prefetch => self.prefetchStep(),
        .execute => self.executeStep(),
        .checkpoint_data => |*progress| self.checkpointDataStep(progress),
        // ...
    }
}
```

**Why over booleans:** Impossible states become unrepresentable. The compiler enforces exhaustive
handling. Payload data is attached to the relevant state.

## Tagged Unions for Multi-Form Data

```zig
pub const Color = union(Tag) {
    none: void,
    palette: u8,
    rgb: color.RGB,

    const Tag = enum(u8) { none, palette, rgb };
};
```

## Return Struct for Multiple Values

When a function returns multiple related values, use an anonymous struct:

```zig
pub inline fn getRowAndCell(self: *const Page, x: usize, y: usize) struct {
    row: *Row,
    cell: *Cell,
} {
    const row = &self.rows()[y];
    const cell = &self.cells(row)[x];
    return .{ .row = row, .cell = cell };
}
```

Callers can destructure naturally:

```zig
const rc = page.getRowAndCell(x, y);
rc.row.styled = true;
rc.cell.style_id = new_id;
```

## Generic Renderer Pattern (Ghostty)

Use comptime generics to create a renderer parameterized by a graphics API:

```zig
pub fn Renderer(comptime GraphicsAPI: type) type {
    return struct {
        const Self = @This();
        pub const API = GraphicsAPI;
        const Target = GraphicsAPI.Target;
        const Buffer = GraphicsAPI.Buffer;

        pub fn drawFrame(self: *Self, target: *Target) !void {
            // Uses GraphicsAPI methods.
        }
    };
}

// Instantiation:
const MetalRenderer = Renderer(MetalAPI);
const OpenGLRenderer = Renderer(OpenGLAPI);
```

Each backend provides the required types and methods at comptime.

## Platform Selection at Comptime

```zig
pub const IO = switch (builtin.target.os.tag) {
    .linux => IO_Linux,
    .macos, .ios => IO_Darwin,
    .windows => IO_Windows,
    else => @compileError("unsupported platform"),
};

pub const Face = switch (options.backend) {
    .freetype, .fontconfig_freetype => freetype.Face,
    .coretext, .coretext_harfbuzz => coretext.Face,
    .web_canvas => web_canvas.Face,
};
```

## Callback Patterns

### Naming

Prefix callbacks with the calling function name:

```zig
fn read_sector(self: *Storage, offset: u64) void { ... }
fn read_sector_callback(self: *Storage) void { ... }
```

### Position

Callbacks go last in parameter lists — mirrors control flow (invoked last):

```zig
pub fn read(self: *Storage, buffer: []u8, offset: u64, callback: *const fn (*Read) void) void {
    // ...
}
```

### Callback Structs (TigerBeetle)

For complex async operations, bundle callback + state:

```zig
pub const Read = struct {
    completion: IO.Completion,
    callback: *const fn (read: *Storage.Read) void,
    buffer: []u8,
    offset: u64,
};
```

## Default Constants as pub const

```zig
pub const default: Colors = .{
    .background = .unset,
    .foreground = .unset,
    .cursor = .unset,
    .palette = .default,
};
```

## Simpler Return Types

Reduce dimensionality at the call site. Simpler return types reduce the number of branches callers
must handle:

- `void` trumps `bool`
- `bool` trumps `u64`
- `u64` trumps `?u64`
- `?u64` trumps `!u64`

This dimensionality is viral — it propagates through the call chain.

## Struct Field Order

Fields first, then types, then methods. Important things near the top:

```zig
const Tracer = struct {
    // Fields.
    time: Time,
    process_id: ProcessID,

    // Nested types.
    const ProcessID = struct { cluster: u128, replica: u8 };

    // Methods.
    pub fn init(gpa: Allocator, time: Time) !Tracer { ... }
    pub fn deinit(self: *Tracer) void { ... }
};
```

If a nested type is complex, promote it to a top-level struct.
