//! Exporting Zig as a C-consumable library, inspired by libxev and Ghostty.
//!
//! 1. Fixed-size byte array opaque handles (libxev) with size validation test.
//! 2. CAPI struct containing all exports (Ghostty).
//! 3. Callback with userdata (?*anyopaque) + callconv(.c) (Ghostty).
//! 4. String type with ownership tracking (ghostty_string_s).
//! 5. Error code translation via @intFromError (libxev).

const std = @import("std");

// --- The Zig implementation -------------------------------------------------

pub const EventLoop = struct {
    running: bool,
    fd_count: u32,
    tick: u64,
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) EventLoop {
        return .{ .running = false, .fd_count = 0, .tick = 0, .allocator = allocator };
    }

    pub fn addFd(self: *EventLoop) !void {
        if (self.fd_count >= 1024) return error.TooManyFds;
        self.fd_count += 1;
    }

    pub fn run(self: *EventLoop, cb: *const fn (?*anyopaque) callconv(.c) void, ud: ?*anyopaque) void {
        self.running = true;
        self.tick += 1;
        cb(ud);
        self.running = false;
    }
};

// --- Pattern 1: Fixed-size byte array opaque handle (libxev) ----------------
// C header: typedef struct { _Alignas(8) uint8_t data[XEV_LOOP_SIZE]; } xev_loop;

const ALIGN = @alignOf(EventLoop);
const HANDLE_SIZE = @sizeOf(EventLoop) + (ALIGN - @sizeOf(EventLoop) % ALIGN) % ALIGN;

pub const LoopHandle = extern struct {
    _pad: [ALIGN]u8 align(ALIGN),
    data: [HANDLE_SIZE - ALIGN]u8,

    fn fromZig(loop: *EventLoop) *LoopHandle { return @ptrCast(@alignCast(loop)); }
    fn toZig(self: *LoopHandle) *EventLoop { return @ptrCast(@alignCast(self)); }
};

// --- Pattern 4: String with ownership tracking (ghostty_string_s) -----------

pub const XString = extern struct {
    ptr: ?[*]const u8,
    len: usize,
    owned: bool,

    pub fn fromSlice(s: []const u8) XString { return .{ .ptr = s.ptr, .len = s.len, .owned = false }; }
    pub fn fromOwned(s: []const u8) XString { return .{ .ptr = s.ptr, .len = s.len, .owned = true }; }
    pub fn slice(self: XString) []const u8 {
        const p = self.ptr orelse return &.{};
        return p[0..self.len];
    }
};

// --- Pattern 5: Error code via @intFromError --------------------------------

fn errorToInt(err: anyerror) c_int {
    return -@as(c_int, @intCast(@intFromError(err)));
}

// --- Pattern 2: CAPI struct (Ghostty) — all exports in one place -----------

pub const CAPI = struct {
    pub export fn xev_loop_init(h: *LoopHandle) c_int {
        h.toZig().* = EventLoop.init(std.heap.c_allocator);
        return 0;
    }

    pub export fn xev_loop_add_fd(h: *LoopHandle) c_int {
        h.toZig().addFd() catch |err| return errorToInt(err);
        return 0;
    }

    pub export fn xev_loop_run(h: *LoopHandle, cb: *const fn (?*anyopaque) callconv(.c) void, ud: ?*anyopaque) void {
        h.toZig().run(cb, ud);
    }

    pub export fn xev_string_free(s: *XString) void {
        if (!s.owned) return;
        if (s.ptr) |p| std.heap.c_allocator.free(p[0..s.len]);
        s.* = .{ .ptr = null, .len = 0, .owned = false };
    }
};

// --- Tests ------------------------------------------------------------------

test "LoopHandle size fits EventLoop" {
    try std.testing.expect(@sizeOf(LoopHandle) >= @sizeOf(EventLoop));
    try std.testing.expect(@alignOf(LoopHandle) >= @alignOf(EventLoop));
}

test "LoopHandle round-trip preserves state" {
    var loop = EventLoop.init(std.testing.allocator);
    loop.tick = 99;
    try std.testing.expectEqual(@as(u64, 99), LoopHandle.fromZig(&loop).toZig().tick);
}

test "error code translation" {
    try std.testing.expect(errorToInt(error.TooManyFds) < 0);
}

test "XString ownership tracking" {
    const s = XString.fromSlice("hello");
    try std.testing.expect(!s.owned);
    try std.testing.expectEqualStrings("hello", s.slice());
    try std.testing.expect(XString.fromOwned("x").owned);
}

test "CAPI init and add_fd" {
    var h: LoopHandle = undefined;
    try std.testing.expectEqual(@as(c_int, 0), CAPI.xev_loop_init(&h));
    try std.testing.expectEqual(@as(c_int, 0), CAPI.xev_loop_add_fd(&h));
}

test "CAPI callback with userdata round-trip" {
    var h: LoopHandle = undefined;
    _ = CAPI.xev_loop_init(&h);
    var called: bool = false;
    CAPI.xev_loop_run(&h, &struct {
        fn f(ctx: ?*anyopaque) callconv(.c) void {
            const flag: *bool = @ptrCast(@alignCast(ctx));
            flag.* = true;
        }
    }.f, @ptrCast(&called));
    try std.testing.expect(called);
}
