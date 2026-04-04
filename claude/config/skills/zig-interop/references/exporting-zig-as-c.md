# Exporting Zig as C

Zig can produce shared and static libraries with a C-compatible API. libxev and Ghostty demonstrate two distinct approaches: libxev uses fixed-size byte array handles for stack-allocatable opaque types, while Ghostty collects all exports into a CAPI struct with a hand-written header chain for Swift consumption.

---

### libxev: Fixed-Size Byte Array Handles

libxev's C header exposes opaque types as fixed-size structs containing a byte array. C consumers can stack-allocate these without knowing the internal layout:

```c
// xev.h (hand-written)
#define XEV_SIZEOF_LOOP 512
#define XEV_ALIGN_T size_t

typedef struct {
    XEV_ALIGN_T _pad;
    uint8_t data[XEV_SIZEOF_LOOP - sizeof(XEV_ALIGN_T)];
} xev_loop;

typedef struct {
    XEV_ALIGN_T _pad;
    uint8_t data[XEV_SIZEOF_COMPLETION - sizeof(XEV_ALIGN_T)];
} xev_completion;
```

The Zig side casts between the byte array and the real type:

```zig
export fn xev_loop_create() xev_loop {
    var result: xev_loop = undefined;
    const loop = Loop.init() catch return zeroed_loop;
    @as(*Loop, @ptrCast(@alignCast(&result.data))) .* = loop;
    return result;
}

export fn xev_loop_run(loop: *xev_loop) c_int {
    const real: *Loop = @ptrCast(@alignCast(&loop.data));
    real.run() catch |err| return @intFromError(err);
    return 0;
}
```

This avoids heap allocation on the C side entirely. The consumer declares `xev_loop loop;` on the stack.

#### Size Validation Tests

libxev uses compile-time and runtime tests to prevent the byte array sizes from dting behind the real struct:

```zig
test "opaque type sizes" {
    // If Loop grows beyond 512 bytes, this test fails --
    // update XEV_SIZEOF_LOOP in the C header
    try testing.expect(@sizeOf(xev.Loop) <= 512);
    try testing.expect(@sizeOf(xev.Completion) <= 256);
}
```

Run these tests in CI. A size increase without a header update produces silent memory corruption.

---

### libxev: Callback Pointer Smuggling via @fieldParentPtr

libxev extends its Completion struct with an extra field rather than using a separate userdata pointer. The callback recovers context via `@fieldParentPtr`:

```zig
const MyCompletion = struct {
    // Embed the library's completion as the first field
    completion: xev.Completion,
    // Extra application state follows
    buffer: []u8,
    handler: *Handler,
};

fn callback(completion: *xev.Completion, result: xev.Result) void {
    // Recover the containing struct from the embedded field
    const my: *MyCompletion = @fieldParentPtr("completion", completion);
    my.handler.onComplete(my.buffer, result);
}
```

This is more efficient than a separate `void* userdata` -- one pointer instead of two, and the context is always the right type.

---

### libxev: Error Code Translation

Zig error unions cannot cross the C boundary. libxev converts them to integer error codes:

```zig
export fn xev_loop_run(loop: *xev_loop) c_int {
    const real: *Loop = @ptrCast(@alignCast(&loop.data));
    real.run() catch |err| return @intFromError(err);
    return 0;  // Success
}
```

`@intFromError(err)` produces a stable integer for each error value. Pair with a strerror-style function:

```zig
export fn xev_strerror(code: c_int) [*:0]const u8 {
    const err = @errorFromInt(code) catch return "unknown error";
    return @errorName(err);
}
```

Convention: return 0 for success, positive integers for errors (matching `@intFromError` output).

---

### libxev: Build Output

libxev builds both static and dynamic libraries, installs a hand-written header, and generates a pkg-config file:

```zig
// build.zig (simplified)
const static = b.addStaticLibrary(.{ .name = "xev", ... });
const shared = b.addSharedLibrary(.{ .name = "xev", ... });

b.installArtifact(static);
b.installArtifact(shared);
static.installHeader(b.path("include/xev.h"), "xev.h");

// pkg-config generation
const pc = b.addInstallFile(
    generatePkgConfig(b, static),
    "lib/pkgconfig/libxev.pc",
);
b.getInstallStep().dependOn(&pc.step);
```

---

### Ghostty: CAPI Struct Pattern

Ghostty collects all exported function declarations into a single CAPI struct in `embedded.zig`. The C consumer receives one struct containing all function pointers rather than linking against individual symbols:

```zig
// src/apprt/embedded.zig (simplified)
pub const CAPI = struct {
    // App lifecycle
    app_new: *const fn (*const Options) ?*App,
    app_free: *const fn (*App) void,

    // Surface management
    surface_new: *const fn (*App, *const SurfaceOptions) ?*Surface,
    surface_free: *const fn (*Surface) void,
    surface_set_size: *const fn (*Surface, u32, u32) void,

    // Input handling
    surface_key_event: *const fn (*Surface, *const KeyEvent) bool,
    surface_mouse_event: *const fn (*Surface, *const MouseEvent) bool,

    // ... all other exports
};
```

This pattern is useful when the consuming language (Swift, in Ghostty's case) benefits from receiving a single initialization point rather than resolving dozens of individual symbols.

---

### Ghostty: Options with Callback Function Pointers

Ghostty passes configuration and callbacks through extern structs with function pointers and `?*anyopaque` userdata:

```zig
pub const Options = extern struct {
    // Callbacks the host must implement
    write_callback: ?*const fn (?*anyopaque, [*]const u8, usize) void,
    size_callback: ?*const fn (?*anyopaque, *u32, *u32) void,
    focus_callback: ?*const fn (?*anyopaque) void,

    // Context pointer passed to every callback
    userdata: ?*anyopaque,

    // Configuration values
    initial_width: u32,
    initial_height: u32,
};
```

The Swift side fills this in with `Unmanaged.passUnretained(self).toOpaque()` for userdata:

```swift
var opts = ghostty_options_s()
opts.userdata = Unmanaged.passUnretained(self).toOpaque()
opts.write_callback = { ctx, data, len in
    let surface = Unmanaged<GhosttySurface>
        .fromOpaque(ctx!).takeUnretainedValue()
    surface.handleWrite(data, length: len)
}
```

---

### Ghostty: String Handling with Sentinel Tracking

Ghostty's `ghostty_string_s` tracks whether the string has a null sentinel, so the receiving side knows how to handle deallocation:

```zig
pub const String = extern struct {
    ptr: [*]const u8,
    len: usize,
    has_sentinel: bool,
};
```

When `has_sentinel` is true, the pointer points to a null-terminated buffer and the receiver can pass it directly to C string functions. When false, the receiver must use the length and cannot assume null termination. This matters for deallocation -- a sentinel-terminated string may have been allocated with `dupeZ` and needs the sentinel byte accounted for.

---

### Ghostty: Hand-Written Header + module.modulemap for Swift

Ghostty does not generate C headers. The chain to Swift is:

1. **Zig export fn** -- Functions with C linkage in `embedded.zig`
2. **Hand-written ghostty.h** -- C header declaring all exported types and functions
3. **module.modulemap** -- Clang module map that wraps ghostty.h:

```
// module.modulemap
module GhosttyKit {
    header "ghostty.h"
    export *
}
```

4. **Swift imports** -- `import GhosttyKit` makes all declarations available

This is the standard pattern for exposing any C-compatible library to Swift. The module.modulemap is required for Swift Package Manager and Xcode framework integration.

Ghostty also generates an XCFramework bundle for multi-architecture support (macOS + iOS), bundling the header, module.modulemap, and architecture-specific static libraries.

---

### export fn Mechanics

Mark a function with `export` for C linkage (implies `callconv(.c)`). Prefix all exported symbols with a library name to avoid collisions in C's global namespace. For function pointers in structs or callbacks, annotate with `callconv(.c)` explicitly.

---

### Memory Ownership

For every allocation the library makes that the consumer receives, provide a corresponding free function. State the contract in the header:

- **Library-allocated, caller-frees** -- Provide a `_free` function
- **Caller-allocated, caller-frees** -- Library writes into a caller-provided buffer
- **Library-allocated, library-frees** -- Arena-based; document when memory becomes invalid

Thread safety: decide and document the model. libxev uses per-loop thread safety -- each loop instance is bound to one thread, no locks needed internally.

---

See also: `references/cimport-and-type-mapping.md` for the type mapping rules consumers use when calling your exported API, `references/cpp-shim-patterns.md` for the reverse direction.
