const std = @import("std");
const testing = std.testing;

// Memory management example demonstrating different allocator patterns in Zig

/// Example struct that requires dynamic allocation
const DynamicArray = struct {
    items: []i32,
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator, capacity: usize) !DynamicArray {
        const items = try allocator.alloc(i32, capacity);
        return .{ .items = items, .allocator = allocator };
    }

    pub fn deinit(self: *DynamicArray) void {
        self.allocator.free(self.items);
        // Poisoning turns a use-after-free into a loud failure in Debug rather
        // than a silent read of a dangling slice.
        self.* = undefined;
    }

    pub fn fill(self: *DynamicArray, value: i32) void {
        for (self.items) |*item| {
            item.* = value;
        }
    }
};

/// Demonstrates GeneralPurposeAllocator (GPA) - best for general use
fn demonstrateGPA() !void {
    std.debug.print("\n=== GeneralPurposeAllocator (GPA) ===\n", .{});
    std.debug.print("Use case: General-purpose allocations with safety checks\n\n", .{});

    var gpa = std.heap.DebugAllocator(.{}).init;
    defer {
        const leaked = gpa.deinit();
        if (leaked == .leak) {
            std.debug.print("WARNING: Memory leak detected!\n", .{});
        }
    }
    const allocator = gpa.allocator();

    // Simple allocation
    const array = try allocator.alloc(i32, 5);
    defer allocator.free(array);

    for (array, 0..) |*item, i| {
        item.* = @intCast(i * 10);
    }

    std.debug.print("GPA allocated array: ", .{});
    for (array) |item| {
        std.debug.print("{d} ", .{item});
    }
    std.debug.print("\n", .{});
}

/// Demonstrates ArenaAllocator - great for batch allocations
fn demonstrateArena() !void {
    std.debug.print("\n=== ArenaAllocator ===\n", .{});
    std.debug.print("Use case: Many allocations freed all at once\n\n", .{});

    var gpa = std.heap.DebugAllocator(.{}).init;
    defer _ = gpa.deinit();

    var arena = std.heap.ArenaAllocator.init(gpa.allocator());
    defer arena.deinit(); // Frees ALL arena allocations at once

    const allocator = arena.allocator();

    // Multiple allocations - no need to free individually
    const arrays = try allocator.alloc([]i32, 3);

    for (arrays, 0..) |*arr, i| {
        arr.* = try allocator.alloc(i32, 4);
        for (arr.*, 0..) |*item, j| {
            item.* = @intCast((i + 1) * 100 + j);
        }
    }

    std.debug.print("Arena allocated {d} arrays:\n", .{arrays.len});
    for (arrays, 0..) |arr, i| {
        std.debug.print("  Array {d}: ", .{i});
        for (arr) |item| {
            std.debug.print("{d} ", .{item});
        }
        std.debug.print("\n", .{});
    }

    // All memory freed automatically when arena.deinit() is called
}

/// Demonstrates FixedBufferAllocator - no heap allocation
fn demonstrateFixedBuffer() !void {
    std.debug.print("\n=== FixedBufferAllocator ===\n", .{});
    std.debug.print("Use case: Pre-allocated buffer, no heap allocations\n\n", .{});

    var buffer: [1024]u8 = undefined;
    var fba = std.heap.FixedBufferAllocator.init(&buffer);
    const allocator = fba.allocator();

    // Allocations come from the fixed buffer
    const array1 = try allocator.alloc(i32, 10);
    for (array1, 0..) |*item, i| {
        item.* = @intCast(i);
    }

    const array2 = try allocator.alloc(i32, 5);
    for (array2, 0..) |*item, i| {
        item.* = @intCast(i * 2);
    }

    std.debug.print("Fixed buffer allocated arrays:\n", .{});
    std.debug.print("  Array 1: ", .{});
    for (array1) |item| {
        std.debug.print("{d} ", .{item});
    }
    std.debug.print("\n  Array 2: ", .{});
    for (array2) |item| {
        std.debug.print("{d} ", .{item});
    }
    std.debug.print("\n", .{});
    std.debug.print("Total used: {d} bytes\n", .{fba.end_index});

    // Note: FixedBufferAllocator doesn't reclaim memory until reset
    fba.reset();
}

/// Demonstrates defer and errdefer for cleanup
fn demonstrateDefer() !void {
    std.debug.print("\n=== Defer and Errdefer ===\n", .{});
    std.debug.print("Use case: Automatic cleanup on scope exit\n\n", .{});

    var gpa = std.heap.DebugAllocator(.{}).init;
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    // defer: executes on scope exit (success or error)
    var array = try DynamicArray.init(allocator, 10);
    defer array.deinit(); // Always called, even if error occurs

    array.fill(42);

    std.debug.print("Array filled with value 42\n", .{});
    std.debug.print("First few items: {d} {d} {d}\n", .{ array.items[0], array.items[1], array.items[2] });
}

/// Demonstrates errdefer for error-only cleanup
fn demonstrateErrdefer() !void {
    std.debug.print("\n=== Errdefer Example ===\n", .{});
    std.debug.print("Use case: Cleanup only on error path\n\n", .{});

    var gpa = std.heap.DebugAllocator(.{}).init;
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    // `errdefer` is for the window where ownership is still in flight: the
    // callee has allocated, but the caller has nothing to clean up yet.
    // `makeRange` below is that window.
    const data = try makeRange(allocator, 100);
    // Here the scope owns the value, so `defer` is the whole cleanup story.
    // Registering `errdefer` as well would free it twice on an error path,
    // because both run, in reverse registration order.
    defer allocator.free(data);

    std.debug.print("Successfully allocated and filled {d} items\n", .{data.len});
}

/// Allocates and fills a slice, returning ownership to the caller.
fn makeRange(allocator: std.mem.Allocator, len: usize) ![]i32 {
    const data = try allocator.alloc(i32, len);
    // If anything below fails, the caller never receives `data`, so this scope
    // is the only one that can free it.
    errdefer allocator.free(data);

    for (data, 0..) |*item, i| {
        item.* = @intCast(i);
    }

    return data;
}

pub fn main() !void {
    std.debug.print("=== Zig Memory Management Examples ===\n", .{});

    try demonstrateGPA();
    try demonstrateArena();
    try demonstrateFixedBuffer();
    try demonstrateDefer();
    try demonstrateErrdefer();

    std.debug.print("\n=== Summary ===\n", .{});
    std.debug.print("- GPA: General purpose, safe, detects leaks\n", .{});
    std.debug.print("- Arena: Batch allocations, free all at once\n", .{});
    std.debug.print("- FixedBuffer: Pre-allocated, no heap\n", .{});
    std.debug.print("- defer: Always cleanup on scope exit\n", .{});
    std.debug.print("- errdefer: Cleanup only on error path\n", .{});
}

// Tests
test "DynamicArray with GPA" {
    const allocator = testing.allocator;

    var array = try DynamicArray.init(allocator, 5);
    defer array.deinit();

    array.fill(99);

    for (array.items) |item| {
        try testing.expectEqual(99, item);
    }
}

test "ArenaAllocator frees all" {
    var gpa = std.heap.DebugAllocator(.{}).init;
    defer _ = gpa.deinit();

    var arena = std.heap.ArenaAllocator.init(gpa.allocator());
    defer arena.deinit();

    const allocator = arena.allocator();

    // Multiple allocations
    _ = try allocator.alloc(i32, 100);
    _ = try allocator.alloc(u8, 50);
    _ = try allocator.alloc(f64, 25);

    // All freed by arena.deinit()
}

test "FixedBufferAllocator bounds" {
    var buffer: [100]u8 = undefined;
    var fba = std.heap.FixedBufferAllocator.init(&buffer);
    const allocator = fba.allocator();

    // Should succeed
    const array1 = try allocator.alloc(u8, 50);
    try testing.expectEqual(50, array1.len);

    // Should succeed
    const array2 = try allocator.alloc(u8, 50);
    try testing.expectEqual(50, array2.len);

    // Next allocation would fail (out of memory)
    const result = allocator.alloc(u8, 1);
    try testing.expectError(error.OutOfMemory, result);
}

test "defer and errdefer behavior" {
    const allocator = testing.allocator;

    var cleanup_count: u32 = 0;

    {
        // Normal defer
        defer cleanup_count += 1;

        // This block exits normally
    }

    try testing.expectEqual(1, cleanup_count);

    // errdefer only runs on error
    const result = blk: {
        const data = try allocator.alloc(i32, 10);
        defer allocator.free(data); // Always runs, error or not
        break :blk data.len;
    };

    try testing.expectEqual(10, result);
}
