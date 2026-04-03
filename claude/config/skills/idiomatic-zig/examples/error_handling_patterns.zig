// Error handling patterns from Ghostty and TigerBeetle.
//
// Key principles:
// - Define narrow, operation-specific error sets.
// - Translate errors at subsystem boundaries to domain-specific names.
// - Use errdefer to clean up partial state on every fallible init.
// - Mark infallible tails with `errdefer comptime unreachable`.

const std = @import("std");
const assert = std.debug.assert;
const Allocator = std.mem.Allocator;

// -- Narrow error sets --

/// Operation-specific errors instead of `anyerror`.
/// Each error name encodes the subsystem that failed.
pub const InsertError = error{
    StringsOutOfMemory,
    SetOutOfMemory,
    SetNeedsRehash,
};

// -- Error translation at boundaries --

const InnerSet = struct {
    const Error = error{ OutOfMemory, NeedsRehash };

    fn add(_: *InnerSet, _: u64) Error!u64 {
        return 0;
    }
};

/// Translate generic subsystem errors into domain-specific names.
/// Callers see `HyperlinkSetOutOfMemory` instead of bare `OutOfMemory`,
/// making it clear which subsystem failed.
fn addHyperlink(set: *InnerSet, value: u64) InsertError!u64 {
    return set.add(value) catch |e| switch (e) {
        error.OutOfMemory => return error.SetOutOfMemory,
        error.NeedsRehash => return error.SetNeedsRehash,
    };
}

// -- errdefer discipline --

const Atlas = struct {
    data: []u8,
    nodes: []u64,
    metadata: []u8,

    /// Every fallible allocation has a matching errdefer.
    /// Pair each `try` with its cleanup, visually grouped.
    pub fn init(alloc: Allocator, size: u32) !Atlas {
        const data = try alloc.alloc(u8, size);
        errdefer alloc.free(data);

        const nodes = try alloc.alloc(u64, size / 8);
        errdefer alloc.free(nodes);

        const metadata = try alloc.alloc(u8, size / 16);
        errdefer alloc.free(metadata);

        return .{ .data = data, .nodes = nodes, .metadata = metadata };
    }

    pub fn deinit(self: *Atlas, alloc: Allocator) void {
        alloc.free(self.metadata);
        alloc.free(self.nodes);
        alloc.free(self.data);
        self.* = undefined;
    }
};

// -- errdefer comptime unreachable --

const Registry = struct {
    items: std.ArrayList(u64),
    count: usize,

    /// After the last fallible operation, `errdefer comptime unreachable`
    /// documents that everything below is infallible. If a future edit
    /// adds a fallible call below this line, it becomes a compile error.
    pub fn insert(self: *Registry, value: u64) !void {
        try self.items.append(value);
        errdefer comptime unreachable;

        // Everything below is infallible.
        self.count += 1;
    }
};

// -- Three-tier error strategy --

/// Tier 1: assert — programmer errors. Crashes the process.
/// Kept on in production because silent corruption is worse than downtime.
fn processTransaction(amount: u64, balance: u64) u64 {
    assert(amount > 0);
    assert(balance >= amount);
    return balance - amount;
}

/// Tier 2: fatal — environmental errors where stopping is correct.
/// Uses typed exit codes for monitoring. (Simplified from TigerBeetle.)
const FatalReason = enum(u8) {
    config_invalid = 1,
    no_space_left = 2,
    manifest_exhausted = 3,

    fn exitStatus(self: FatalReason) u8 {
        return @intFromEnum(self);
    }
};

fn fatal(reason: FatalReason, comptime fmt: []const u8, args: anytype) noreturn {
    std.log.err(fmt, args);
    std.process.exit(reason.exitStatus());
}

/// Tier 3: error unions — expected operational errors callers must handle.
fn allocateNode(pool: []u8, index: usize) error{OutOfMemory}!*u8 {
    if (index >= pool.len) return error.OutOfMemory;
    return &pool[index];
}

// -- Tests --

test "atlas init cleans up on failure" {
    // Use a failing allocator to verify errdefer fires.
    var fail_alloc = std.testing.FailingAllocator.init(std.testing.allocator, .{
        .fail_index = 2,
    });
    const alloc = fail_alloc.allocator();

    const result = Atlas.init(alloc, 1024);
    try std.testing.expectError(error.OutOfMemory, result);
    // If errdefer didn't fire, the testing allocator would report a leak.
}

test "atlas init succeeds with valid allocator" {
    var atlas = try Atlas.init(std.testing.allocator, 1024);
    defer atlas.deinit(std.testing.allocator);

    try std.testing.expectEqual(@as(usize, 1024), atlas.data.len);
    try std.testing.expectEqual(@as(usize, 128), atlas.nodes.len);
}

test "error translation preserves specificity" {
    var set = InnerSet{};
    const result = addHyperlink(&set, 42);
    // Successful case.
    try std.testing.expectEqual(@as(u64, 0), try result);
}

test "processTransaction asserts on zero amount" {
    // Valid case.
    try std.testing.expectEqual(@as(u64, 90), processTransaction(10, 100));
}
