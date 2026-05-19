# @cImport and Type Mapping

Zig's `@cImport` translates C headers into Zig types at compile time. Under the hood it runs **translate-c**, the same tool available as `zig translate-c` on the command line. Production projects take different approaches depending on the complexity and reliability of the headers involved.

---

### Approaches to C Header Translation

#### Dedicated c.zig Files (Ghostty)

Ghostty isolates each C library's `@cImport` into a per-package `c.zig` file. Each package in `pkg/<name>/` has its own `c.zig` that contains exactly one `@cImport` block for that library.

```zig
// pkg/freetype/c.zig
pub const c = @cImport({
    @cInclude("freetype/freetype.h");
    @cInclude("freetype/ftmodapi.h");
});
```

This prevents duplicate type definitions (separate `@cImport` blocks produce separate translation units) and keeps import paths clean. Other Zig files import the namespace:

```zig
const c = @import("c.zig").c;
```

#### Pre-Translated Bindings (Bun)

Bun does NOT use `@cImport` for BoringSSL. The 19K-line file is pre-translated from BoringSSL headers and then manually enriched with better type information, additional constants, and documentation. Reasons to pre-translate:

- translate-c loses function-like macros
- Manual enrichment can add Zig-native types where C headers use `int`
- Build caching -- no translate-c invocation on every compile
- Reproducibility -- the binding file is committed, not generated per-machine

Use this approach when the C header surface is large, the library is stable, and translate-c drops important definitions.

#### addTranslateC in build.zig (ziglua)

ziglua uses `addTranslateC` as a middle ground. The build system translates headers at build time without embedding `@cImport` in source files:

```zig
// build.zig (simplified)
const translated = b.addTranslateC(.{
    .root_source_file = b.path("include/lua.h"),
    .target = target,
    .optimize = optimize,
});
lib.addModule("lua_h", translated.createModule());
```

This gives build-time control over include paths and defines while still auto-generating bindings. ziglua compiles upstream Lua C source via `addCSourceFiles` alongside this.

---

### Type Mapping Table

| C Type | Zig Type | Notes |
|--------|----------|-------|
| `int` | `c_int` | Platform-dependent width |
| `unsigned int` | `c_uint` | |
| `long` | `c_long` | |
| `size_t` | `usize` | |
| `int8_t` | `i8` | Fixed-width types map directly |
| `uint32_t` | `u32` | |
| `float` | `f32` | |
| `double` | `f64` | |
| `char` | `u8` | Zig treats `char` as unsigned |
| `_Bool` / `bool` | `bool` | |
| `char *` | `[*c]u8` | C pointer -- nullable, arithmetic-capable |
| `void *` | `*anyopaque` | Opaque pointer, must cast before use |
| `T *` | `*c.T` or `[*c]c.T` | Single-item vs. many-item pointer |
| `T[N]` | `[N]c.T` | Fixed-size arrays translate directly |
| `struct S` | `c.S` or `c.struct_S` | Depends on typedef usage |
| `enum E` | `c.E` or `c.enum_E` | Values become `c_int` by default |

**Convert away from `[*c]` at the boundary** into proper Zig pointer types (`*T`, `[*]T`, `[]T`, or `?*T`).

---

### ABI-Compatible Type Design

Production projects often define types that match C layouts exactly rather than relying on translate-c.

#### Bun's JSValue: enum(i64)

Bun represents JavaScript values as `enum(i64)` -- directly ABI-compatible with JSC's NaN-boxed `EncodedJSValue` (a 64-bit integer). No translation layer needed; the Zig enum IS the C type:

```zig
pub const JSValue = enum(i64) {
    // Named sentinel values
    zero = 0,
    undefined = 0xa,
    null_value = 0x2,
    true_value = 0x7,
    false_value = 0x6,
    _,  // Non-exhaustive: any i64 is a valid JSValue
};
```

This avoids struct wrapping overhead and matches the C++ side's `reinterpret_cast` patterns.

#### Bun's ZigString: Tagged Pointer Encoding

```zig
pub const ZigString = extern struct {
    ptr: [*]const u8,
    len: usize,  // High bits encode UTF-16/Latin1 flag
};
```

Encoding information is packed into the high bits of `len`, avoiding a separate field. The C++ side reads these bits to determine string encoding.

---

### Wrapping Opaque Types (Ghostty)

Ghostty uses two distinct patterns for wrapping C library types, chosen based on whether Zig needs to access fields.

#### Opaque Pattern (CoreText)

When Zig never accesses internal fields, use the `opaque` type. Ghostty wraps CoreText types this way:

```zig
pub const Font = opaque {
    pub fn createWithFontDescriptor(
        desc: *const FontDescriptor,
        size: f64,
        matrix: ?*const [6]f64,
    ) ?*Font {
        return @ptrCast(@alignCast(
            c.CTFontCreateWithFontDescriptor(
                @ptrCast(desc),
                size,
                @ptrCast(matrix),
            ),
        ));
    }

    pub fn release(self: *Font) void {
        c.CFRelease(@ptrCast(self));
    }
};
```

Methods are attached directly to the opaque type. The pointer never gets dereferenced on the Zig side -- it exists only to pass back into C functions.

#### Struct-with-Handle Pattern (FreeType)

When Zig needs to store the handle alongside other state:

```zig
pub const Face = struct {
    handle: c.FT_Face,
    library: *Library,

    pub fn init(library: *Library, path: [*:0]const u8) !Face {
        var face: c.FT_Face = undefined;
        if (c.FT_New_Face(library.handle, path, 0, &face) != 0)
            return error.FreeTypeError;
        return .{ .handle = face, .library = library };
    }

    pub fn deinit(self: *Face) void {
        _ = c.FT_Done_Face(self.handle);
    }
};
```

Choose this when the wrapper adds state (like back-references) or when multiple C handles need coordinated lifetime.

---

### C ABI Workaround Files

When Zig's C ABI has platform-specific bugs, Ghostty uses small C files compiled alongside Zig as workarounds. These `ext.c` files contain trivial C functions that call the problematic APIs correctly:

```c
// ext.c -- workaround for Zig ABI issue with this specific call
#include <CoreText/CoreText.h>

CTFontRef ext_CTFontCreateWithFontDescriptor(
    CTFontDescriptorRef desc, CGFloat size
) {
    return CTFontCreateWithFontDescriptor(desc, size, NULL);
}
```

The Zig side declares the ext function as `extern` and calls it instead of the C library function directly. This is a pragmatic escape hatch -- file a Zig bug and use the workaround until it's fixed.

---

### Sentinel Pointers and Null-Terminated Strings

C strings are `char *` with a null terminator. Zig represents this as `[*:0]const u8`. Convert at the boundary:

```zig
const c_str: [*:0]const u8 = c.get_name();
const zig_slice: []const u8 = std.mem.span(c_str);

// Runtime slices going to C need null-terminated copies
const c_compatible = try allocator.dupeZ(u8, zig_slice);
defer allocator.free(c_compatible);
c.some_c_function(c_compatible.ptr);
```

`std.mem.span` scans for the sentinel -- O(n). Cache the result.

---

### Limitations

#### Macros

translate-c handles simple `#define` constants but cannot translate function-like macros. Rewrite as Zig `inline fn`. Check translate-c output to see what survived.

#### Bitfields

C bitfields have no stable ABI. Access through C helper functions or rewrite with packed structs:

```zig
const Flags = packed struct {
    readable: bool,
    writable: bool,
    executable: bool,
    _padding: u5 = 0,
};
```

#### Inline Functions

C `inline` functions sometimes translate, sometimes do not. Write Zig wrappers for any the code depends on.

---

### Memory Ownership

When calling C functions that return pointers, determine who owns the allocation:

- **C owns it** -- Do not free from Zig. Use `defer` to call the C cleanup function (Ghostty's `Font.release` calling `CFRelease`).
- **Caller owns it** -- Call the library's free function or `std.c.free` if the C code used `malloc`.
- **Borrowed pointer** -- Valid only for a limited scope. Copy if it needs to outlive that scope.

Read the C library's documentation for every function that returns a pointer. When wrapping, document ownership in the Zig wrapper's doc comments.

---

See also: `references/cpp-shim-patterns.md` for wrapping C++ through a C shim layer, `references/exporting-zig-as-c.md` for the reverse direction.
