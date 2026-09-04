// Static allocation after init — a performance optimization from TigerBeetle.
//
// When memory usage is known or knowable at startup, allocating everything
// upfront and forbidding further allocation eliminates:
// - Unpredictable latency from allocation.
// - OOM in production.
//
// This is a performance choice, not a universal rule. Use it when your
// memory needs are knowable at init time (databases, servers with fixed
// connection pools, embedded systems).

const std = @import("std");
const assert = std.debug.assert;
const Allocator = std.mem.Allocator;
const Alignment = std.mem.Alignment;

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
        .remap = noRemap,
        .free = free,
    };

    fn alloc(ctx: *anyopaque, len: usize, alignment: Alignment, ret_addr: usize) ?[*]u8 {
        const self: *StaticAllocator = @ptrCast(@alignCast(ctx));
        assert(self.state == .init); // Allocation only during init.
        return self.backing.rawAlloc(len, alignment, ret_addr);
    }

    fn resize(ctx: *anyopaque, memory: []u8, alignment: Alignment, new_len: usize, ret_addr: usize) bool {
        const self: *StaticAllocator = @ptrCast(@alignCast(ctx));
        assert(self.state == .init); // Resize only during init.
        return self.backing.rawResize(memory, alignment, new_len, ret_addr);
    }

    // Remap not supported — we don't allow relocation.
    fn noRemap(_: *anyopaque, _: []u8, _: Alignment, _: usize, _: usize) ?[*]u8 {
        return null;
    }

    fn free(ctx: *anyopaque, memory: []u8, alignment: Alignment, ret_addr: usize) void {
        const self: *StaticAllocator = @ptrCast(@alignCast(ctx));
        assert(self.state != .static); // No free during production.
        self.backing.rawFree(memory, alignment, ret_addr);
    }
};

// -- Example usage --

const Database = struct {
    buffer_pool: []u8,
    index: []u64,

    fn init(alloc: Allocator) !Database {
        // Struct-literal fields are evaluated in order, so a failure on the
        // second allocation would leak the first. Split them out and register
        // the `errdefer` while ownership is still in flight -- the caller does
        // not have a `Database` to `deinit` yet.
        const buffer_pool = try alloc.alloc(u8, 4096 * 1024); // 4MB buffer pool.
        errdefer alloc.free(buffer_pool);

        const index = try alloc.alloc(u64, 1024);
        errdefer comptime unreachable;

        return .{ .buffer_pool = buffer_pool, .index = index };
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

// Zig only analyses a function something references, so an untested method can
// keep calling a deleted stdlib API for releases without anyone noticing.
// `refAllDecls` is shallow and `@typeInfo().decls` lists only public
// declarations, so name the file-scope types too.
test "every declaration compiles" {
    std.testing.refAllDecls(@This());
    _ = StaticAllocator;
    _ = Database;
}
