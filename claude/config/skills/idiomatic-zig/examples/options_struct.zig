// Options struct pattern for named arguments.
//
// From TigerBeetle's TIGER_STYLE: "A function taking two u64 must use an options struct."
// Dependencies (allocator, io) stay positional. Configuration goes in the struct.

const std = @import("std");
const Allocator = std.mem.Allocator;

pub const Server = struct {
    allocator: Allocator,
    config: Config,
    listener: ?std.posix.socket_t = null,

    pub const Config = struct {
        host: []const u8 = "127.0.0.1",
        port: u16 = 8080,
        max_connections: u32 = 1024,
        read_timeout_ms: u32 = 30_000,
        write_timeout_ms: u32 = 30_000,
        backlog: u31 = 128,
    };

    /// Dependencies are positional (unique types, can't be mixed up).
    /// Configuration uses a struct (multiple integers that could be swapped).
    pub fn init(allocator: Allocator, config: Config) !Server {
        return .{
            .allocator = allocator,
            .config = config,
        };
    }

    pub fn deinit(self: *Server) void {
        if (self.listener) |sock| std.posix.close(sock);
        self.* = undefined;
    }
};

// Usage — clear what each value means at the call site:
test "server init with named config" {
    var server = try Server.init(std.testing.allocator, .{
        .port = 9090,
        .max_connections = 512,
        .read_timeout_ms = 5_000,
    });
    defer server.deinit();

    try std.testing.expectEqual(@as(u16, 9090), server.config.port);
    try std.testing.expectEqual(@as(u32, 512), server.config.max_connections);
    // Defaults apply for unspecified fields.
    try std.testing.expectEqual(@as(u32, 30_000), server.config.write_timeout_ms);
}
