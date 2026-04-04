# Cross-Language ABI

The C ABI is the universal interop layer. When Zig talks to Objective-C, Swift, or Rust, both sides meet at C — never at each other's native ABI. Real projects demonstrate distinct patterns for each language pair.

### Zig and Objective-C: zig-objc Runtime Bridging

Ghostty uses mitchellh/zig-objc to call Objective-C without writing any .m files. The library wraps the ObjC runtime (`objc_msgSend`) with comptime type safety.

#### Message Sends

Retrieve a class, then send messages with return type and selector specified as comptime parameters:

```zig
const objc = @import("zig-objc");

// Equivalent to: [NSProcessInfo processInfo]
const info = objc.getClass("NSProcessInfo").?.msgSend(
    objc.Object,
    objc.sel("processInfo"),
    .{},
);
```

The `.msgSend` method synthesizes the correct function pointer type at comptime (see `references/comptime-ffi-metaprogramming.md` for the `@Type(.{ .@"fn" = ... })` technique underneath). It selects the right variant based on architecture:

- **x86_64:** `objc_msgSend_stret` for large struct returns, `objc_msgSend_fpret` for `f64` returns
- **aarch64:** always uses base `objc_msgSend` (ARM calling convention handles structs and floats in registers)

#### ObjC Blocks

zig-objc provides `objc.Block` for passing Zig functions as Objective-C block arguments. Ghostty uses this for completion handlers and notification observers where AppKit expects a block type.

#### AutoreleasePool

ObjC autorelease pools must be managed manually from Zig. Ghostty creates and drains a pool per frame to prevent unbounded memory growth from autoreleased ObjC objects:

```zig
const pool = objc.AutoreleasePool.init();
defer pool.deinit();
// All ObjC calls within this scope are covered
```

---

### Zig and Swift: The C API Bridge

Ghostty's Zig-to-Swift bridge follows a three-layer architecture:

1. **Zig exports** functions with `export` and `callconv(.c)`
2. **ghostty.h** declares the C prototypes
3. **module.modulemap** wraps ghostty.h into a Clang module that Swift imports as `GhosttyKit`

Swift code `import GhosttyKit` and calls the C functions directly — no `@_cdecl` needed on the Swift side for this direction.

#### Options Struct with Callback Function Pointers

Ghostty passes configuration from Swift to Zig via an `extern struct` containing `callconv(.c)` function pointers and a `?*anyopaque` userdata field:

```zig
pub const Options = extern struct {
    // Callback function pointers with C calling convention
    size_report: ?*const fn (u32, u32, ?*anyopaque) callconv(.c) void = null,
    title_report: ?*const fn ([*:0]const u8, ?*anyopaque) callconv(.c) void = null,

    // Opaque pointer for callback context
    userdata: ?*anyopaque = null,
};
```

Swift sets the userdata to `Unmanaged.passUnretained(self).toOpaque()`, then each callback casts it back:

```swift
// Swift side
let ud = Unmanaged.passUnretained(self).toOpaque()
options.userdata = ud
options.size_report = { width, height, ctx in
    let surface = Unmanaged<SurfaceView>.fromOpaque(ctx!).takeUnretainedValue()
    surface.handleSizeReport(width, height)
}
```

This pattern avoids ARC overhead on every callback invocation. Use `passUnretained` when the Swift object's lifetime is guaranteed to outlive the Zig usage.

#### Platform View Passing

Ghostty passes `NSView` (macOS) and `UIView` (iOS) through the C boundary as `?*anyopaque`. On the Zig side, convert to an `objc.Object` via `fromId()` to send messages:

```zig
fn attachToView(raw_view: ?*anyopaque) void {
    const view = objc.Object.fromId(raw_view.?);
    const layer = view.msgSend(objc.Object, objc.sel("layer"), .{});
    // ...
}
```

#### String Ownership

Ghostty defines `ghostty_string_s` for ownership-tracked string passing across the boundary:

```zig
pub const String = extern struct {
    ptr: [*]const u8,
    len: usize,
    sentinel: bool, // whether ptr is null-terminated
};
```

Swift wraps this in `AllocatedString`, which calls `ghostty_string_free` in its `deinit`. The Zig side allocates; the Swift side frees through the provided function — never through Swift's own allocator.

---

### Zig and Rust: Matching extern "C" Declarations

Lightpanda bridges Zig and Rust (html5ever) by declaring matching `extern "C"` signatures on both sides. There is no shared header — both sides manually maintain compatible declarations.

Rust side:

```rust
#[no_mangle]
pub extern "C" fn html5ever_parse(
    input_ptr: *const u8,
    input_len: usize,
    callback: extern "C" fn(*const Node, *mut c_void),
    userdata: *mut c_void,
) -> i32 {
    // Parse HTML, invoke callback for each DOM node
}
```

Zig side:

```zig
extern "C" fn html5ever_parse(
    input_ptr: [*]const u8,
    input_len: usize,
    callback: *const fn (*const Node, ?*anyopaque) callconv(.c) void,
    userdata: ?*anyopaque,
) c_int;
```

#### Callback-Driven Memory Model

Lightpanda uses a **shared-nothing** approach: Zig passes function pointers into Rust for DOM mutations. Rust never allocates on Zig's heap or vice versa. DOM nodes are built on the Zig side inside the callback — Rust only passes data needed to construct them.

This eliminates the need for a shared allocator or cross-language free functions. Each side manages its own memory exclusively.

---

### extern struct: Layout Guarantees

Use `extern struct` when a struct crosses a language boundary. Zig's default struct layout is undefined — the compiler reorders fields. An `extern struct` guarantees C-compatible layout: fields in declaration order with platform-standard alignment and padding.

```zig
const ImageBuffer = extern struct {
    data: [*]u8,
    width: u32,
    height: u32,
    stride: u32,
    format: PixelFormat,
};
```

Place larger-aligned fields first to minimize padding. A `u8` followed by a `u64` wastes 7 bytes; reverse them and it wastes none.

---

### extern union for Platform Variants

Use `extern union` paired with an enum tag for values that differ by platform:

```zig
const PlatformView = extern union {
    ns_view: ?*anyopaque,  // NSView* on macOS
    ui_view: ?*anyopaque,  // UIView* on iOS
    hwnd: ?*anyopaque,     // HWND on Windows
};

const ViewHandle = extern struct {
    platform: enum(c_int) { macos = 0, ios = 1, windows = 2 },
    view: PlatformView,
};
```

Unlike Zig's native tagged unions, `extern union` has no built-in discriminant. Always send the tag — the other language must check it before accessing a field.

---

### Enum Representation

Specify the integer backing type when enums cross ABI boundaries:

```zig
const PixelFormat = enum(c_int) {
    rgba8 = 0,
    bgra8 = 1,
    rgb565 = 2,
    _,  // Allow unknown values from C
};
```

The `_` catch-all is critical. C code may pass values outside your known set. Without it, Zig triggers safety-checked undefined behavior on an unknown value.

---

### Memory Ownership

#### Shared-Nothing (Lightpanda Pattern)

Each language manages its own heap. Data crosses the boundary through callbacks or caller-provided buffers. No cross-language free functions needed.

#### Ownership-Tracked Strings (Ghostty Pattern)

One side allocates, the other side receives a struct with the data and a free function. Ghostty's `ghostty_string_s` + `ghostty_string_free` ensures Swift always calls the correct deallocator.

#### Caller-Provided Buffers

The safest default — caller allocates, callee fills:

```zig
extern "C" fn render_frame(
    engine: *anyopaque,
    output_buf: [*]u8,
    buf_len: usize,
    out_written: *usize,
) c_int;
```

No ambiguity about who frees what. Prefer this when buffer sizes are predictable.

---

See also: `references/build-system-c-integration.md` for linking multi-language artifacts, `references/comptime-ffi-metaprogramming.md` for zig-objc's comptime type synthesis.
