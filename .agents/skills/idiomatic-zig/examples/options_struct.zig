// Options struct pattern for named arguments.
//
// From TigerBeetle's TIGER_STYLE: "A function taking two u64 must use an options struct."
// Dependencies (allocator, io) stay positional. Configuration goes in the struct.
//
// Zig 0.16's own standard library is the reference implementation of this rule:
//
//     net.IpAddress.listen(address: *const IpAddress, io: Io, options: ListenOptions)
//
// The address and the `Io` are positional because they have distinct types and
// cannot be swapped by accident. Everything configurable -- `kernel_backlog`,
// `reuse_address`, `mode`, `protocol` -- lives in `ListenOptions` with a default.

const std = @import("std");
const Allocator = std.mem.Allocator;
const Io = std.Io;

pub const Server = struct {
    allocator: Allocator,
    config: Options,
    listener: ?Io.net.Server = null,

    pub const Options = struct {
        host: []const u8 = "127.0.0.1",
        port: u16 = 8080,
        max_connections: u32 = 1024,
        read_timeout_ms: u32 = 30_000,
        write_timeout_ms: u32 = 30_000,
        backlog: u31 = Io.net.default_kernel_backlog,
    };

    /// Dependencies are positional (unique types, can't be mixed up).
    /// Configuration uses an options struct (multiple integers that could be swapped).
    pub fn init(allocator: Allocator, config: Options) Server {
        return .{
            .allocator = allocator,
            .config = config,
        };
    }

    /// Binding is separate from `init` so that constructing a `Server` cannot
    /// fail: the only fallible step is the one that touches the network.
    pub fn listen(self: *Server, io: Io) !void {
        std.debug.assert(self.listener == null);

        const address = try Io.net.IpAddress.parse(self.config.host, self.config.port);
        self.listener = try address.listen(io, .{
            .kernel_backlog = self.config.backlog,
            .reuse_address = true,
        });

        std.debug.assert(self.listener != null);
    }

    /// `deinit` takes the `Io` that owns the socket, not the one that happens
    /// to be in scope. Closing is I/O, so it is spelled as I/O.
    pub fn deinit(self: *Server, io: Io) void {
        if (self.listener) |*server| server.deinit(io);
        self.* = undefined;
    }
};

// Usage — clear what each value means at the call site:
test "server init with named config" {
    var server: Server = .init(std.testing.allocator, .{
        .port = 9090,
        .max_connections = 512,
        .read_timeout_ms = 5_000,
    });
    defer server.deinit(std.testing.io);

    try std.testing.expectEqual(9090, server.config.port);
    try std.testing.expectEqual(512, server.config.max_connections);
    // Defaults apply for unspecified fields.
    try std.testing.expectEqual(30_000, server.config.write_timeout_ms);
    try std.testing.expectEqual(Io.net.default_kernel_backlog, server.config.backlog);
}

// The point of the pattern: swapping two same-typed arguments is a compile
// error at the field level, not a silent runtime bug.
test "options are named, so order does not matter" {
    const a: Server.Options = .{ .read_timeout_ms = 1_000, .write_timeout_ms = 2_000 };
    const b: Server.Options = .{ .write_timeout_ms = 2_000, .read_timeout_ms = 1_000 };
    // `expectEqual` compares slices by pointer identity, and `Options.host` is
    // a slice. These two happen to share an interned literal, so `expectEqual`
    // would pass for the wrong reason. `expectEqualDeep` compares contents.
    try std.testing.expectEqualDeep(a, b);
}

// `listen` has no unit test -- it would need a real network. Referencing it
// still forces the compiler to analyse its body, so the file cannot rot
// silently the way it did when `std.posix.socket_t` disappeared in 0.16.
test "every declaration compiles" {
    std.testing.refAllDecls(@This());
    _ = &Server.init;
    _ = &Server.listen;
    _ = &Server.deinit;
}
