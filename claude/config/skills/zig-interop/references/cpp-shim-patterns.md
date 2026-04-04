# C++ Shim Patterns

Zig cannot import C++ directly. The language boundary requires a C-compatible interface. Production projects take fundamentally different approaches depending on the C++ codebase: Bun builds a codegen-driven shim pipeline for JavaScriptCore, while Lightpanda avoids custom shims entirely by using a pre-existing flat C API.

---

### Why Direct C++ Import Is Impossible

C++ features with no C ABI equivalent: name mangling, templates, exceptions, RAII, overloading, vtables. The C ABI is the only stable binary interface shared between C++ compilers and Zig.

---

### Bun's Codegen Pipeline (JavaScriptCore)

Bun wraps JSC through a three-layer system, with TypeScript code generation bridging C++ annotations to Zig declarations.

#### Layer 1: Annotated C++ (bindings.cpp)

C++ shim functions carry `[[ZIG_EXPORT(tag)]]` annotations that describe error handling behavior:

```cpp
// src/bun.js/bindings/bindings.cpp
[[ZIG_EXPORT(nothrow)]]
EncodedJSValue JSValue__jsNull() {
    return JSC::JSValue::encode(JSC::jsNull());
}

[[ZIG_EXPORT(zero_is_throw)]]
EncodedJSValue JSGlobalObject__createErrorInstance(
    JSGlobalObject* global,
    const ZigString* message
) {
    // Returns 0 (encoded null) on failure
    auto scope = DECLARE_THROW_SCOPE(global->vm());
    // ...
}

[[ZIG_EXPORT(check_slow)]]
EncodedJSValue JSValue__call(
    EncodedJSValue func,
    JSGlobalObject* global,
    const EncodedJSValue* args,
    uint32_t arg_count
) {
    // Must check TopExceptionScope after return
    // ...
}
```

The three exception handling tags:
- **nothrow** -- Function never throws. Zig calls it directly.
- **zero_is_throw** -- Return value of 0 signals an exception. Zig checks the return.
- **check_slow** -- Caller must inspect TopExceptionScope after the call returns.

#### Layer 2: TypeScript Codegen (cppbind.ts)

A TypeScript tool parses the `[[ZIG_EXPORT]]` annotations and generates Zig extern declarations. The generator produces opaque type definitions and function prototypes that match the C++ shim's ABI.

#### Layer 3: Zig Consumer

Zig code uses the generated declarations as opaque types. JSValue is `enum(i64)` -- directly ABI-compatible with JSC's NaN-boxed `EncodedJSValue`:

```zig
pub const JSValue = enum(i64) {
    zero = 0,
    undefined = 0xa,
    _,
};

// Generated extern declarations (simplified)
extern fn JSValue__jsNull() JSValue;
extern fn JSValue__call(
    func: JSValue,
    global: *JSGlobalObject,
    args: [*]const JSValue,
    arg_count: u32,
) JSValue;
```

---

### ABI-Compatible Types Across the Boundary

#### Errorable(T): Tagged Union for Error Propagation

Bun defines an ABI-safe tagged union that crosses the C boundary without losing error information:

```zig
pub fn Errorable(comptime T: type) type {
    return extern struct {
        result: Result,
        success: bool,

        const Result = extern union {
            value: T,
            err: JSError,
        };
    };
}
```

C++ returns `Errorable<JSValue>` from shim functions. Zig checks the `success` field and either unwraps the value or propagates the error.

#### ExternTraits<T>: C++ Type Conversion Rules

On the C++ side, `ExternTraits<T>` templates define how C++ types convert to C-compatible representations:

```cpp
template<>
struct ExternTraits<WTF::String> {
    static ZigString encode(const WTF::String& str) {
        // leakRef() transfers ownership -- the Zig side
        // is now responsible for releasing
        auto impl = str.impl();
        if (!impl) return ZigString{ nullptr, 0 };
        impl->ref();  // Prevent C++ side from deallocating
        return ZigString{
            impl->characters8(),
            impl->length() | (impl->is8Bit() ? LATIN1_FLAG : 0)
        };
    }
};
```

`leakRef()` is the critical pattern: it increments the reference count so the C++ destructor does not free the backing memory. The Zig side must eventually release it.

#### TopExceptionScope

For `check_slow` tagged functions, Bun wraps exception checking:

```cpp
class TopExceptionScope {
    JSGlobalObject* global;
public:
    TopExceptionScope(JSGlobalObject* g) : global(g) {}
    bool hasException() const {
        return global->vm().exception() != nullptr;
    }
    EncodedJSValue exception() const {
        return JSC::JSValue::encode(global->vm().exception()->value());
    }
};
```

The Zig caller checks this scope after calling functions tagged `check_slow`.

---

### Flat C API Alternative (Lightpanda)

Lightpanda does NOT wrap V8's C++ directly. It uses **zig-v8-fork**, which provides a flat C API over V8:

```zig
// Zig side -- calls into pre-existing C API, no custom shim
extern fn v8__Isolate__New(params: *const CreateParams) *Isolate;
extern fn v8__Isolate__Dispose(isolate: *Isolate) void;
extern fn v8__Context__New(isolate: *Isolate) *Context;
```

When a maintained flat C API exists for your C++ dependency, prefer it. Writing and maintaining a custom shim for a large, actively-developed C++ project is a significant ongoing cost.

Evaluate the tradeoff:
- **Custom shim** -- Full control over the API surface, can expose exactly what you need, requires ongoing maintenance as the C++ API evolves
- **Existing C API** -- Less control, may not expose everything, but maintenance burden shifts to the upstream project

---

### Build System Considerations

#### Bun: Separate C++ Build

Bun's C++ is NOT compiled by `build.zig`. The C++ side uses a separate Ninja/TypeScript build system. Zig produces one `.o` file that links against the C++ artifacts.

This is appropriate when:
- The C++ dependency has its own complex build (CMake, Ninja, Bazel)
- C++ build flags are numerous and specialized
- The C++ code is large enough that build.zig would struggle to replicate the configuration

#### Simple Shims via build.zig

For small, self-contained C++ shims (not Bun's case), compile through build.zig:

```zig
lib.addCSourceFiles(.{
    .files = &.{"shim/bindings.cpp"},
    .flags = &.{ "-std=c++17", "-fno-exceptions" },
});
lib.linkLibCpp();
```

Use `-fno-exceptions` when the shim catches all exceptions internally.

---

### RAII Bridging

C++ constructors and destructors map to create/destroy functions in the shim. Zig's `defer` provides the cleanup guarantee:

```zig
pub fn processWithStream(path: [*:0]const u8) !void {
    const stream = c.stream_create(path) orelse return error.StreamFailed;
    defer c.stream_destroy(stream);

    const buf = c.buffer_create(4096) orelse return error.BufferFailed;
    defer c.buffer_destroy(buf);

    const conn = c.connection_open(stream) orelse return error.ConnFailed;
    errdefer c.connection_close(conn);

    try doWork(conn, buf);
    c.connection_close(conn);
}
```

Every `create` must have a matching `destroy`. Wrap the pair in a Zig struct with `init`/`deinit`.

---

### Callback Bridging

Pass Zig functions to C++ through function pointers with a context argument:

```zig
fn onEvent(ctx: ?*anyopaque, event_type: c_int, data: [*c]const u8) callconv(.c) void {
    const self: *MyHandler = @ptrCast(@alignCast(ctx));
    const event_data = if (data) |d| std.mem.span(d) else "";
    self.handleEvent(event_type, event_data);
}
```

`callconv(.c)` is required -- without it the function uses Zig's calling convention, which corrupts the stack when called from C/C++.

---

### Memory Ownership

The shim creates a clear ownership boundary:

- **C++ objects** -- Allocated with `new` in create, freed with `delete` in destroy. Zig holds a handle, never the raw object.
- **Strings from C++ to Zig** -- Bun uses `leakRef()` on WTF::String to transfer ownership. The Zig side must eventually release.
- **Strings from Zig to C++** -- The shim typically copies them (via `std::string` constructor). Zig retains ownership of its buffer.
- **Tagged pointer encoding** -- Bun's ZigString packs encoding (UTF-16/Latin1) into high bits of the length field, avoiding a separate allocation for metadata.

---

### C++ STL Type Bridging (zpp)

zpp wraps C++ STL types (primarily `std::string`) behind opaque `intptr_t` handles, providing Zig with safe access to C++ containers without exposing any C++ types across the boundary.

#### Opaque Handle Pattern

The C++ side allocates STL objects with `new` and returns the pointer as an `intptr_t`. Zig never sees the `std::string` layout — only the handle and accessor functions:

```cpp
// C++ side — extern "C" functions for std::string lifecycle
extern "C" intptr_t stdstring_create(const char* data, uint32_t len) {
    return reinterpret_cast<intptr_t>(new std::string(data, len));
}

extern "C" void stdstring_destroy(intptr_t handle) {
    delete reinterpret_cast<std::string*>(handle);
}

extern "C" const char* stdstring_data(intptr_t handle) {
    return reinterpret_cast<std::string*>(handle)->data();
}

extern "C" uint32_t stdstring_len(intptr_t handle) {
    return reinterpret_cast<std::string*>(handle)->size();
}
```

#### Three Ownership Modes

zpp provides three wrapper types with different write semantics:

- **StdString** -- Read-only access. Zig caches the data pointer and length after the first FFI call, avoiding repeated border crossings for subsequent reads.
- **FixedStdString** -- Fixed-capacity write. Zig writes into a pre-allocated buffer; the C++ `std::string` does not reallocate.
- **FlexStdString** -- Growable write. Zig can append data; the C++ side may reallocate, so the cached pointer is invalidated after writes.

#### Read-Path Optimization

Zig caches the data pointer and length returned by the accessor functions. Reads after the first call are pure Zig memory access with no FFI overhead. The cache is invalidated on any write operation.

#### Bidirectional Data Flow

C++ can call back into Zig through function pointers. zpp uses this for C++ code that needs to read from a Zig `ArrayList` — the Zig side exports accessor functions, and C++ calls them through stored function pointers.

#### Build Requirements

Compile the C++ shim with `-fno-exceptions -fno-rtti`. Exceptions cannot propagate across the `extern "C"` boundary, and RTTI is unnecessary when all types are opaque handles. These flags also reduce binary size.

---

See also: `references/cimport-and-type-mapping.md` for type mapping rules when importing the shim header, `references/exporting-zig-as-c.md` for the reverse direction.
