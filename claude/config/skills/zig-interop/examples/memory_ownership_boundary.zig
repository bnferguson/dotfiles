//! Memory ownership at FFI boundaries, from Bun, Ghostty, and Lightpanda.
//!
//! 1. Tagged string (Bun's ZigString / Ghostty's ghostty_string_s).
//! 2. Custom allocator hooks (Bun's BoringSSL mimalloc routing).
//! 3. Callback-driven ownership (Lightpanda's Rust pattern: no shared heap).
//! 4. leakRef ownership transfer (Bun's ExternTraits).
//! 5. errdefer chains at FFI boundaries.

const std = @import("std");

// --- Pattern 1: Tagged string (ZigString / ghostty_string_s) ----------------

// Tag backing type must be extern-compatible (min 8-bit); u2 is not.
pub const StringTag = enum(u8) { borrowed = 0, owned = 1, static_str = 2 };

pub const TaggedString = extern struct {
    _unsafe_ptr_do_not_use: [*]const u8,
    len: usize,
    // Bun packs the tag into high bits of the pointer; we use a field for clarity.
    tag: StringTag,

    pub fn borrowed(s: []const u8) TaggedString {
        return .{ ._unsafe_ptr_do_not_use = s.ptr, .len = s.len, .tag = .borrowed };
    }
    pub fn owned(s: []const u8) TaggedString {
        return .{ ._unsafe_ptr_do_not_use = s.ptr, .len = s.len, .tag = .owned };
    }
    pub fn slice(self: TaggedString) []const u8 {
        return self._unsafe_ptr_do_not_use[0..self.len];
    }
    pub fn deinit(self: TaggedString, allocator: std.mem.Allocator) void {
        if (self.tag == .owned) allocator.free(self._unsafe_ptr_do_not_use[0..self.len]);
    }
};

// --- Pattern 2: Custom allocator hooks (BoringSSL mimalloc routing) ---------

var ffi_allocator: std.mem.Allocator = std.heap.c_allocator;

pub fn setGlobalAllocator(a: std.mem.Allocator) void { ffi_allocator = a; }

// In real code these are `export fn` so the C library resolves them.
fn cryptoMalloc(size: usize) callconv(.c) ?*anyopaque {
    // In 0.15+, alignment is ?std.mem.Alignment (a log2 enum), not a raw integer.
    const buf = ffi_allocator.alignedAlloc(u8, .@"4", size) catch return null; // .@"4" = 2^4 = 16
    return @ptrCast(buf.ptr);
}

fn cryptoFree(ptr: ?*anyopaque, size: usize) callconv(.c) void {
    if (ptr) |p| {
        const aligned: [*]align(16) u8 = @ptrCast(@alignCast(p));
        ffi_allocator.free(aligned[0..size]);
    }
}

// --- Pattern 3: Callback-driven ownership (Lightpanda's Rust pattern) -------

pub const RemoteAllocator = struct {
    alloc_fn: *const fn (usize) callconv(.c) ?[*]u8,
    free_fn: *const fn ([*]u8, usize) callconv(.c) void,

    pub fn alloc(self: RemoteAllocator, size: usize) ![]u8 {
        const ptr = self.alloc_fn(size) orelse return error.OutOfMemory;
        return ptr[0..size];
    }
    pub fn free(self: RemoteAllocator, buf: []u8) void {
        self.free_fn(buf.ptr, buf.len);
    }
};

// --- Pattern 4: leakRef ownership transfer (Bun's ExternTraits) -------------

pub fn RefCounted(comptime T: type) type {
    return struct {
        value: T,
        allocator: std.mem.Allocator,
        const Self = @This();

        pub fn create(allocator: std.mem.Allocator, value: T) !*Self {
            const self = try allocator.create(Self);
            self.* = .{ .value = value, .allocator = allocator };
            return self;
        }
        /// Transfer ownership to foreign code.
        pub fn leakRef(self: *Self) *anyopaque { return @ptrCast(self); }
        /// Reclaim a pointer previously handed out via leakRef.
        pub fn releaseRef(raw: *anyopaque) void {
            const self: *Self = @ptrCast(@alignCast(raw));
            self.allocator.destroy(self);
        }
    };
}

// --- Pattern 5: errdefer chains at FFI boundaries ---------------------------

pub fn initPipeline(allocator: std.mem.Allocator, remote: RemoteAllocator) !struct { local: []u8, remote_buf: []u8 } {
    const local = try allocator.alloc(u8, 256);
    errdefer allocator.free(local);
    const remote_buf = try remote.alloc(128);
    errdefer remote.free(remote_buf);
    return .{ .local = local, .remote_buf = remote_buf };
}

// --- Tests ------------------------------------------------------------------

test "TaggedString borrowed does not free" {
    const s = TaggedString.borrowed("hello");
    try std.testing.expectEqualStrings("hello", s.slice());
    s.deinit(std.testing.allocator); // no-op
}

test "TaggedString owned frees on deinit" {
    const buf = try std.testing.allocator.dupe(u8, "owned");
    TaggedString.owned(buf).deinit(std.testing.allocator);
}

test "custom allocator hooks round-trip" {
    const ptr = cryptoMalloc(64) orelse return error.TestFailed;
    const bytes: [*]u8 = @ptrCast(ptr);
    bytes[0] = 0xAB;
    try std.testing.expectEqual(@as(u8, 0xAB), bytes[0]);
    cryptoFree(ptr, 64);
}

test "leakRef and releaseRef ownership transfer" {
    const Ref = RefCounted(u64);
    const obj = try Ref.create(std.testing.allocator, 42);
    try std.testing.expectEqual(@as(u64, 42), obj.value);
    Ref.releaseRef(obj.leakRef());
}
