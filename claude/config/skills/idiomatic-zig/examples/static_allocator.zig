// Static allocation after init — TigerBeetle pattern.
//
// All memory is allocated at startup. After initialization completes,
// the allocator transitions to "static" mode where any allocation
// attempt is an assertion failure. This eliminates:
// - Use-after-free (no free after init).
// - Unpredictable latency from allocation.
// - OOM in production.
//
// Forces all memory usage to be considered upfront as part of design.

const std = @import("std");
const assert = std.debug.assert;
const Allocator = std.mem.Allocator;

pub const StaticAllocator = struct {
    state: State = .init,
    backing: Allocator,

    const State = enum {
        /// Startup phase: alloc and resize permitted.
        init,
        /// Production phase: no allocation calls permitted.
        static,
        /// Shutdown phase: free permitted, alloc/resize forbidden.
        deinit,
    };

    pub fn allocator(self: *StaticAllocator) Allocator {
        return .{
            .ptr = self,
            .vtable = &vtable,
        };
    }

    pub fn transition_from_init_to_static(self: *StaticAllocator) void {
        assert(self.state == .init);
        self.state = .static;
    }

    pub fn transition_from_static_to_deinit(self: *StaticAllocator) void {
        assert(self.state == .static);
        self.state = .deinit;
    }

    const vtable = Allocator.VTable{
        .alloc = alloc,
        .resize = resize,
        .free = free,
    };

    fn alloc(ctx: *anyopaque, len: usize, ptr_align: u8, ret_addr: usize) ?[*]u8 {
        const self: *StaticAllocator = @ptrCast(@alignCast(ctx));
        assert(self.state == .init); // Allocation only during init.
        return self.backing.rawAlloc(len, ptr_align, ret_addr);
    }

    fn resize(ctx: *anyopaque, buf: []u8, buf_align: u8, new_len: usize, ret_addr: usize) bool {
        const self: *StaticAllocator = @ptrCast(@alignCast(ctx));
        assert(self.state == .init); // Resize only during init.
        return self.backing.rawResize(buf, buf_align, new_len, ret_addr);
    }

    fn free(ctx: *anyopaque, buf: []u8, buf_align: u8, ret_addr: usize) void {
        const self: *StaticAllocator = @ptrCast(@alignCast(ctx));
        assert(self.state != .static); // No free during production.
        self.backing.rawFree(buf, buf_align, ret_addr);
    }
};

// -- Example usage --

const Database = struct {
    buffer_pool: []u8,
    index: []u64,

    fn init(alloc: Allocator) !Database {
        return .{
            .buffer_pool = try alloc.alloc(u8, 4096 * 1024), // 4MB buffer pool.
            .index = try alloc.alloc(u64, 1024),
        };
    }

    fn deinit(self: *Database, alloc: Allocator) void {
        alloc.free(self.buffer_pool);
        alloc.free(self.index);
        self.* = undefined;
    }
};

test "static allocator lifecycle" {
    var static = StaticAllocator{ .backing = std.testing.allocator };
    const alloc = static.allocator();

    // Init phase: allocations succeed.
    var db = try Database.init(alloc);

    // Transition to static: no more allocations.
    static.transition_from_init_to_static();

    // Production phase: use db freely, but can't allocate.
    // alloc.alloc(u8, 1) would hit an assertion failure here.

    // Shutdown: free is permitted.
    static.transition_from_static_to_deinit();
    db.deinit(alloc);
}
