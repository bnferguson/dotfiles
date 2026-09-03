// Target Zig Version: 0.16.0
// For other versions, see references/version-differences.md

const std = @import("std");

pub fn main(init: std.process.Init) !void {
    // The application owns the Io implementation and the allocator, and passes
    // them down to everything that needs them.
    const io = init.io;
    const allocator = init.gpa;
    _ = allocator;

    // A writer owns a buffer, and that buffer must be flushed before it goes
    // out of scope -- an early `return` above the flush loses the output.
    var stdout_buffer: [1024]u8 = undefined;
    var stdout_writer = std.Io.File.stdout().writerStreaming(io, &stdout_buffer);
    const stdout = &stdout_writer.interface;

    // Your code here
    try stdout.print("Hello, Zig!\n", .{});

    // A write reports the placeholder `error.WriteFailed` and stashes the real
    // error on the writer, so unwrap it rather than losing why the write failed.
    stdout.flush() catch |err| switch (err) {
        error.WriteFailed => return stdout_writer.err.?,
    };
}
