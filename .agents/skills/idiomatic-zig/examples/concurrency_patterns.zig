// Concurrency patterns from Ghostty and TigerBeetle.
//
// Key principles:
// - Default to single-threaded. Add concurrency only when proven necessary.
// - Use dirty flags over locks for signaling state changes.
// - Use atomics for cross-thread shared state.
// - Use fixed-capacity blocking queues for thread communication.
//
// Zig 0.16 moved the blocking primitives from `std.Thread` to `std.Io`, so
// anything that can block now takes an `Io` and says so in its signature.
// Atomics and dirty flags did not move: they never block, so they never
// needed an `Io` in the first place. That is the cheapest way to tell the two
// categories apart.

const std = @import("std");
const assert = std.debug.assert;

// -- Dirty flags over locks --

/// Track what needs updating via a packed struct of booleans.
/// Avoids locking during every state change — the renderer checks
/// flags once per frame and processes only what changed.
pub const Dirty = packed struct {
    palette: bool = false,
    cursor_style: bool = false,
    screen_clear: bool = false,
    grid_size: bool = false,

    /// Mark everything as needing a full redraw.
    pub fn markAll(self: *Dirty) void {
        self.* = .{
            .palette = true,
            .cursor_style = true,
            .screen_clear = true,
            .grid_size = true,
        };
    }

    /// True if any flag is set.
    pub fn needsRedraw(self: Dirty) bool {
        return self.palette or self.cursor_style or
            self.screen_clear or self.grid_size;
    }

    /// Reset all flags after processing.
    pub fn clear(self: *Dirty) void {
        self.* = .{};
    }
};

// -- Atomic values for cross-thread state --

/// Use std.atomic.Value for state shared between threads.
/// Avoids locks for simple counters and flags.
pub const SharedState = struct {
    /// Modified by the terminal thread, read by the renderer.
    modified_count: std.atomic.Value(usize) = .init(0),
    /// Set by the terminal thread to signal the renderer.
    needs_redraw: std.atomic.Value(bool) = .init(false),

    pub fn signalModification(self: *SharedState) void {
        _ = self.modified_count.fetchAdd(1, .release);
        self.needs_redraw.store(true, .release);
    }

    pub fn acknowledgeRedraw(self: *SharedState) usize {
        self.needs_redraw.store(false, .release);
        return self.modified_count.load(.acquire);
    }
};

// -- Fixed-capacity blocking queue --

/// Producer-consumer communication between threads.
/// Fixed capacity bounds memory usage.
///
/// Pattern from TigerBeetle: `pub const Mailbox = BlockingQueue(Message, 64);`
///
/// Note that despite the name this variant never blocks: a full `push` returns
/// `error.QueueFull` and an empty `pop` returns `null`, so the caller decides
/// what to do. That is what keeps every critical section below O(1), and it is
/// why `lockUncancelable` is the right call. A version that genuinely blocked
/// would wait on a `std.Io.Condition`, and then `pop` would have to return
/// `Cancelable!?T` -- a waiter parked on an empty queue is exactly the
/// unbounded wait that cancellation exists for.
pub fn BlockingQueue(comptime T: type, comptime capacity: usize) type {
    return struct {
        const Self = @This();

        buffer: [capacity]T = undefined,
        head: usize = 0,
        tail: usize = 0,
        count: usize = 0,
        mutex: std.Io.Mutex = .init,

        // Every critical section below is O(1), holds no allocation and does no
        // I/O, so the longest a waiter can block is the few instructions the
        // holder needs to finish. Cancelling that wait would save nothing, so
        // these use `lockUncancelable` and keep their plain return types.
        // `pop` stays `?T` instead of becoming `Cancelable!?T`: reducing the
        // dimensionality of a return type is worth more than a cancellation
        // point nobody can use.

        pub fn push(self: *Self, io: std.Io, item: T) error{QueueFull}!void {
            self.mutex.lockUncancelable(io);
            defer self.mutex.unlock(io);

            assert(self.count <= capacity);
            assert(self.tail < capacity);
            if (self.count >= capacity) return error.QueueFull;

            self.buffer[self.tail] = item;
            self.tail = (self.tail + 1) % capacity;
            self.count += 1;
        }

        pub fn pop(self: *Self, io: std.Io) ?T {
            self.mutex.lockUncancelable(io);
            defer self.mutex.unlock(io);

            assert(self.count <= capacity);
            assert(self.head < capacity);
            if (self.count == 0) return null;

            const item = self.buffer[self.head];
            self.head = (self.head + 1) % capacity;
            self.count -= 1;
            return item;
        }

        pub fn len(self: *Self, io: std.Io) usize {
            self.mutex.lockUncancelable(io);
            defer self.mutex.unlock(io);
            return self.count;
        }
    };
}

// -- Example message types --

pub const RenderCommand = union(enum) {
    resize: struct { cols: u32, rows: u32 },
    scroll: i32,
    redraw,
    shutdown,
};

pub const Mailbox = BlockingQueue(RenderCommand, 64);

// -- Tests --

test "dirty flags track changes" {
    var dirty = Dirty{};
    try std.testing.expect(!dirty.needsRedraw());

    dirty.palette = true;
    try std.testing.expect(dirty.needsRedraw());

    dirty.clear();
    try std.testing.expect(!dirty.needsRedraw());
}

test "dirty markAll sets everything" {
    var dirty = Dirty{};
    dirty.markAll();
    try std.testing.expect(dirty.palette);
    try std.testing.expect(dirty.cursor_style);
    try std.testing.expect(dirty.screen_clear);
    try std.testing.expect(dirty.grid_size);
}

test "shared state atomic operations" {
    var state = SharedState{};

    state.signalModification();
    state.signalModification();

    try std.testing.expect(state.needs_redraw.load(.acquire));
    const count = state.acknowledgeRedraw();
    try std.testing.expectEqual(2, count);
    try std.testing.expect(!state.needs_redraw.load(.acquire));
}

test "blocking queue push and pop" {
    const io = std.testing.io;
    var queue = Mailbox{};

    try queue.push(io, .redraw);
    try queue.push(io, .{ .scroll = -5 });
    try queue.push(io, .shutdown);

    try std.testing.expectEqual(3, queue.len(io));

    const first = queue.pop(io).?;
    try std.testing.expectEqual(RenderCommand.redraw, first);

    const second = queue.pop(io).?;
    switch (second) {
        .scroll => |delta| try std.testing.expectEqual(-5, delta),
        else => return error.TestUnexpectedResult,
    }
}

test "blocking queue returns null when empty" {
    const io = std.testing.io;
    var queue = Mailbox{};
    try std.testing.expectEqual(null, queue.pop(io));
}

test "blocking queue rejects when full" {
    const io = std.testing.io;
    var queue = BlockingQueue(u8, 2){};
    try queue.push(io, 1);
    try queue.push(io, 2);
    try std.testing.expectError(error.QueueFull, queue.push(io, 3));
}

// Zig only analyses a function something references, so an untested method can
// keep calling a deleted stdlib API for releases without anyone noticing.
// `refAllDecls` is shallow and `@typeInfo().decls` lists only public
// declarations, so name the file-scope types too.
test "every declaration compiles" {
    std.testing.refAllDecls(@This());
    _ = Dirty;
    _ = SharedState;
    _ = RenderCommand;
}
