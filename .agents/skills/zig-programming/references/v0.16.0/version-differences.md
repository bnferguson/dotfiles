# Zig 0.16 Version Differences

Use this file when migrating 0.15 code to 0.16. Read [io.md](io.md) for the full I/O model.

## Main changes from 0.15

- I/O, time, entropy, processes, and blocking synchronization now use a passed `std.Io` interface.
- `main` can accept `std.process.Init` or `std.process.Init.Minimal`.
- Process arguments and environment variables are no longer global.
- `@cImport` is deprecated. Add translated C modules through `std.Build`.
- `@Type` is replaced by `@EnumLiteral`, `@Enum`, `@Fn`, `@Int`, `@Pointer`, `@Struct`, `@Tuple`, and `@Union`.
- Runtime vector indexes are forbidden. Use a compile-time index or convert to an array.
- Arrays and vectors no longer coerce through an in-memory reinterpretation.
- Explicitly aligned pointers are distinct from naturally aligned pointers.
- Standard library containers continue moving toward allocator-per-operation APIs.
- `std.Thread.Pool` is removed.

## I/O migration

Change application entry points first. Then thread `std.Io` through each I/O boundary.

```zig
// Zig 0.15
pub fn main() !void {
    try std.fs.File.stdout().writeAll("Hello\n");
}

// Zig 0.16
pub fn main(init: std.process.Init) !void {
    try std.Io.File.stdout().writeStreamingAll(init.io, "Hello\n");
}
```

Use `std.testing.io` in tests. Use `std.Io.Threaded` only when a migration boundary cannot receive the application-owned interface.

## C translation

Move C translation into `build.zig`. Import the generated module from Zig code.

```zig
const translate_c = b.addTranslateC(.{
    .root_source_file = b.path("src/c.h"),
    .target = target,
    .optimize = optimize,
});

const exe = b.addExecutable(.{
    .name = "app",
    .root_module = b.createModule(.{
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{.{
            .name = "c",
            .module = translate_c.createModule(),
        }},
    }),
});
b.installArtifact(exe);
```

```zig
const c = @import("c");
```

## Type construction

Replace each `@Type` call with the builtin for the type it creates. For example, replace `@Type(.{ .int = .{ .signedness = .unsigned, .bits = 10 } })` with `@Int(.unsigned, 10)`.

## Verification

After migration, run `zig fmt`, `zig build`, and `zig build test`. Search the changed code for legacy `std.fs`, global process state, `@Type`, and direct blocking synchronization calls.

## Sources

- [Zig 0.16.0 release notes](https://ziglang.org/download/0.16.0/release-notes.html)
- [Zig 0.16.0 language reference](https://ziglang.org/documentation/0.16.0/)
