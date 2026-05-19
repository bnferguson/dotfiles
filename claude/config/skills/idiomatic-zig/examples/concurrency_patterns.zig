// Concurrency patterns from Ghostty and TigerBeetle.
//
// Key principles:
// - Default to single-threaded. Add concurrency only when proven necessary.
// - Use dirty flags over locks for signaling state changes.
// - Use atomics for cross-thread shared state.
// - Use fixed-capacity blocking queues for thread communication.

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
    modified_count: std.atomic.Value(usize) = .{ .raw = 0 },
    /// Set by the terminal thread to signal the renderer.
    needs_redraw: std.atomic.Value(bool) = .{ .raw = false },

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
/// Fixed capacity bounds memory usage and provides backpressure.
///
/// Pattern from TigerBeetle: `pub const Mailbox = BlockingQueue(Message, 64);`
pub fn BlockingQueue(comptime T: type, comptime capacity: usize) type {
    return struct {
        const Self = @This();

        buffer: [capacity]T = undefined,
        head: usize = 0,
        tail: usize = 0,
        count: usize = 0,
        mutex: std.Thread.Mutex = .{},

        pub fn push(self: *Self, item: T) error{QueueFull}!void {
            self.mutex.lock();
            defer self.mutex.unlock();

            if (self.count >= capacity) return error.QueueFull;

            self.buffer[self.tail] = item;
            self.tail = (self.tail + 1) % capacity;
            self.count += 1;
        }

        pub fn pop(self: *Self) ?T {
            self.mutex.lock();
            defer self.mutex.unlock();

            if (self.count == 0) return null;

            const item = self.buffer[self.head];
            self.head = (self.head + 1) % capacity;
            self.count -= 1;
            return item;
        }

        pub fn len(self: *Self) usize {
            self.mutex.lock();
            defer self.mutex.unlock();
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
    try std.testing.expectEqual(@as(usize, 2), count);
    try std.testing.expect(!state.needs_redraw.load(.acquire));
}

test "blocking queue push and pop" {
    var queue = Mailbox{};

    try queue.push(.redraw);
    try queue.push(.{ .scroll = -5 });
    try queue.push(.shutdown);

    try std.testing.expectEqual(@as(usize, 3), queue.len());

    const first = queue.pop().?;
    try std.testing.expectEqual(RenderCommand.redraw, first);

    const second = queue.pop().?;
    switch (second) {
        .scroll => |delta| try std.testing.expectEqual(@as(i32, -5), delta),
        else => return error.TestUnexpectedResult,
    }
}

test "blocking queue returns null when empty" {
    var queue = Mailbox{};
    try std.testing.expectEqual(@as(?RenderCommand, null), queue.pop());
}

test "blocking queue rejects when full" {
    var queue = BlockingQueue(u8, 2){};
    try queue.push(1);
    try queue.push(2);
    try std.testing.expectError(error.QueueFull, queue.push(3));
}
