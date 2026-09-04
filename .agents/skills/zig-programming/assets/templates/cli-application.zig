// Target Zig Version: 0.16.0
// For other versions, see references/version-differences.md

const std = @import("std");

// CLI Application Template
// Demonstrates argument parsing, subcommands, and user interaction

const Config = struct {
    allocator: std.mem.Allocator,
    verbose: bool = false,
    output_file: ?[]const u8 = null,
    input_files: std.ArrayList([]const u8),

    pub fn init(allocator: std.mem.Allocator) Config {
        return .{
            .allocator = allocator,
            .input_files = .empty,
        };
    }

    pub fn deinit(self: *Config) void {
        self.input_files.deinit(self.allocator);
        self.* = undefined;
    }
};

fn printUsage() void {
    const usage =
        \\Usage: myapp [OPTIONS] COMMAND [ARGS]
        \\
        \\Commands:
        \\  process   Process input files
        \\  convert   Convert file format
        \\  help      Show this help message
        \\
        \\Options:
        \\  -v, --verbose        Enable verbose output
        \\  -o, --output FILE    Specify output file
        \\  -h, --help           Show this help message
        \\
    ;
    std.debug.print("{s}", .{usage});
}

fn processCommand(stdout: *std.Io.Writer, config: *const Config, args: []const []const u8) !void {
    if (config.verbose) {
        try stdout.print("Processing files (verbose mode)...\n", .{});
    }

    // TODO: Implement your processing logic here
    for (args) |arg| {
        if (config.verbose) {
            try stdout.print("Processing: {s}\n", .{arg});
        }

        // Your processing code here
    }

    if (config.output_file) |output| {
        if (config.verbose) {
            try stdout.print("Writing output to: {s}\n", .{output});
        }
        // TODO: Write results to output file
    }

    try stdout.print("Processing complete!\n", .{});
}

fn convertCommand(stdout: *std.Io.Writer, config: *const Config, args: []const []const u8) !void {
    if (config.verbose) {
        try stdout.print("Converting files (verbose mode)...\n", .{});
    }

    if (args.len < 1) {
        try stdout.print("Error: No input file specified\n", .{});
        return error.MissingArgument;
    }

    const input_file = args[0];
    const output_file = config.output_file orelse "output.txt";

    if (config.verbose) {
        try stdout.print("Converting {s} -> {s}\n", .{ input_file, output_file });
    }

    // TODO: Implement your conversion logic here

    try stdout.print("Conversion complete!\n", .{});
}

pub fn main(init: std.process.Init) !void {
    const io = init.io;
    // `init.gpa` is already leak-checking in Debug and a fast allocator in
    // release builds, so there is no reason to construct another one.
    const allocator = init.gpa;

    // A writer owns a buffer, so build it once here and flush it on every path
    // out of main -- an early `return` with an unflushed buffer loses output.
    var stdout_buffer: [1024]u8 = undefined;
    var stdout_writer = std.Io.File.stdout().writerStreaming(io, &stdout_buffer);
    const stdout = &stdout_writer.interface;
    // A backstop for the error paths below, which are already returning a more
    // interesting error than a failed flush. The success path flushes with
    // `try` at the end of this function so a write failure is not swallowed.
    defer stdout_writer.flush() catch {};

    // Arguments come from the process init data; the arena owns them.
    const args = try init.minimal.args.toSlice(init.arena.allocator());

    // Parse command line arguments
    var config: Config = .init(allocator);
    defer config.deinit();

    var command: ?[]const u8 = null;
    var command_args: std.ArrayList([]const u8) = .empty;
    defer command_args.deinit(allocator);

    var i: usize = 1; // Skip program name
    while (i < args.len) : (i += 1) {
        const arg = args[i];

        if (std.mem.eql(u8, arg, "-h") or std.mem.eql(u8, arg, "--help")) {
            printUsage();
            return;
        } else if (std.mem.eql(u8, arg, "-v") or std.mem.eql(u8, arg, "--verbose")) {
            config.verbose = true;
        } else if (std.mem.eql(u8, arg, "-o") or std.mem.eql(u8, arg, "--output")) {
            if (i + 1 >= args.len) {
                std.debug.print("Error: --output requires a filename\n", .{});
                return error.MissingArgument;
            }
            i += 1;
            config.output_file = args[i];
        } else if (command == null and !std.mem.startsWith(u8, arg, "-")) {
            // First non-option argument is the command
            command = arg;
        } else {
            // Subsequent arguments go to the command
            try command_args.append(allocator, arg);
        }
    }

    // Execute command
    const cmd = command orelse {
        std.debug.print("Error: No command specified\n\n", .{});
        printUsage();
        return error.MissingCommand;
    };

    if (std.mem.eql(u8, cmd, "process")) {
        try processCommand(stdout, &config, command_args.items);
    } else if (std.mem.eql(u8, cmd, "convert")) {
        try convertCommand(stdout, &config, command_args.items);
    } else if (std.mem.eql(u8, cmd, "help")) {
        printUsage();
    } else {
        std.debug.print("Error: Unknown command '{s}'\n\n", .{cmd});
        printUsage();
        return error.UnknownCommand;
    }

    // `File.Writer.flush` unwraps the `error.WriteFailed` placeholder and
    // returns the real error, which the `defer` above deliberately cannot.
    try stdout_writer.flush();
}

// Tests
const testing = std.testing;

test "Config initialization" {
    const allocator = testing.allocator;
    var config = Config.init(allocator);
    defer config.deinit();

    try testing.expect(!config.verbose);
    try testing.expect(config.output_file == null);
    try testing.expectEqual(0, config.input_files.items.len);
}

test "every declaration compiles" {
    // The command handlers have no test of their own -- they need a writer and
    // a parsed argv. Referencing them still forces the compiler through their
    // bodies, which is what catches a stdlib API disappearing under them.
    testing.refAllDecls(@This());
    _ = &processCommand;
    _ = &convertCommand;
    _ = &printUsage;
}
