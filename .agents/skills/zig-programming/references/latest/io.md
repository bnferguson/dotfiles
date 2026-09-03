# Zig 0.16 I/O

Zig 0.16 makes `std.Io` the interface for operations that can block or introduce nondeterminism. This includes files, networking, time, entropy, processes, and blocking synchronization.

Use the [0.16.0 release notes](https://ziglang.org/download/0.16.0/release-notes.html#I-O-as-an-Interface) and the local `zig std` output for API details.

## Design rule

The application owns the `std.Io` implementation. Pass its `std.Io` interface into every library function that needs I/O.

```zig
const std = @import("std");

pub fn main(init: std.process.Init) !void {
    try greet(init.io);
}

fn greet(io: std.Io) !void {
    try std.Io.File.stdout().writeStreamingAll(io, "Hello, world!\n");
}
```

Use `std.testing.io` in tests:

```zig
test "uses the I/O interface" {
    const io = std.testing.io;
    try doWork(io);
}
```

If migration code has no `Io`, this single-threaded adapter matches the old blocking behavior:

```zig
var threaded: std.Io.Threaded = .init_single_threaded;
const io = threaded.io();
```

Treat that adapter as a migration bridge. Pass `Io` from `main` in application code.

## Entry point

`main` can take one of these forms:

- `pub fn main() ...` when the program needs no process initialization data.
- `pub fn main(init: std.process.Init.Minimal) ...` for raw arguments and environment data.
- `pub fn main(init: std.process.Init) ...` for `io`, `gpa`, an arena, parsed environment data, arguments, and preopens.

```zig
pub fn main(init: std.process.Init) !void {
    const args = try init.minimal.args.toSlice(init.arena.allocator());

    for (args, 0..) |arg, index| {
        std.log.info("arg[{d}] = {s}", .{ index, arg });
    }
}
```

Environment variables and process arguments are no longer global. Pass the values a function needs, or pass a `*const std.process.Environ.Map` when it needs the full environment.

## Migration map

| Zig 0.15 | Zig 0.16 |
| --- | --- |
| `file.close()` | `file.close(io)` |
| `std.fs.cwd()` | `std.Io.Dir.cwd()` or `.cwd()` when inferred |
| `std.time.Instant` | `std.Io.Timestamp` |
| `std.time.Timer` | `std.Io.Timestamp` |
| `std.time.timestamp` | `std.Io.Timestamp.now` |
| `std.crypto.random.bytes(&buffer)` | `io.random(&buffer)` |
| `std.Thread.ResetEvent` | `std.Io.Event` |
| `std.Thread.WaitGroup` | `std.Io.Group` |
| `std.Thread.Futex` | `std.Io.Futex` |
| `std.Thread.Mutex` | `std.Io.Mutex` |
| `std.Thread.Condition` | `std.Io.Condition` |
| `std.Thread.Semaphore` | `std.Io.Semaphore` |
| `std.Thread.RwLock` | `std.Io.RwLock` |

Lock-free atomics do not need `std.Io`.

The old `GenericReader`, `AnyReader`, and `FixedBufferStream` APIs are gone. Use `std.Io.Reader` and `std.Io.Writer`. Formatting now goes through `std.Io.Writer.print`.

## Tasks

`io.async` expresses independence. An implementation can run the function immediately when concurrency is unavailable.

`io.concurrent` requires concurrent execution. It can return `error.ConcurrencyUnavailable`.

```zig
var task = io.async(load, .{ io, path });
defer if (task.cancel(io)) |resource| resource.deinit() else |_| {};

const resource = try task.await(io);
```

Both `await` and `cancel` are idempotent. Defer cancellation after task creation so every error path releases the task resource.

Use `std.Io.Group` when many tasks share one lifetime. Use `std.Io.Batch` for low-overhead groups of supported operations.

## Cancellation

Cancelable I/O operations include `error.Canceled` in their error sets. Use one of these responses:

1. Propagate `error.Canceled`.
2. Call `io.recancel()` before suppressing it.
3. Use `io.swapCancelProtection()` only when cancellation is invalid for a protected region.

The code that requested cancellation can ignore `error.Canceled`. Other code must preserve cancellation semantics.

## Implementations

- `std.Io.Threaded` is the stable, feature-complete implementation. It matches the blocking behavior used by 0.15 code.
- `std.Io.Evented` is experimental.
- `std.Io.failing` models an environment with no supported operations.

With `-fno-single-threaded`, `std.Io.Threaded` supports task concurrency and cancellation. With `-fsingle-threaded`, it does not.

## Sources

- [Zig 0.16.0 release notes: I/O as an Interface](https://ziglang.org/download/0.16.0/release-notes.html#I-O-as-an-Interface)
- [Zig 0.16.0 language reference](https://ziglang.org/documentation/0.16.0/)
