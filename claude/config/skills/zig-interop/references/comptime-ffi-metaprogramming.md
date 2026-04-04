# Comptime FFI Metaprogramming

Zig's comptime evaluation turns type information into code at compile time — no external code generators, no macro preprocessors. For FFI, this means generating type-safe wrappers, dispatch logic, and binding tables from type definitions, with zero runtime cost.

### zig-objc: Function Type Synthesis with @Type

The canonical comptime FFI pattern. zig-objc synthesizes the correct `objc_msgSend` function pointer type at comptime based on the expected return type and argument types.

The core technique uses `@Type(.{ .@"fn" = ... })` to construct a function type programmatically:

```zig
fn msgSendFnType(comptime ReturnType: type, comptime ArgTypes: []const type) type {
    var params: [ArgTypes.len + 2]std.builtin.Type.Fn.Param = undefined;

    // First two params are always (id, SEL)
    params[0] = .{ .is_generic = false, .is_noalias = false, .type = objc.Id };
    params[1] = .{ .is_generic = false, .is_noalias = false, .type = objc.SEL };

    // Remaining params from the message signature
    for (ArgTypes, 0..) |T, i| {
        params[i + 2] = .{ .is_generic = false, .is_noalias = false, .type = T };
    }

    return @Type(.{
        .@"fn" = .{
            .calling_convention = .c,
            .is_generic = false,
            .is_var_args = false,
            .return_type = ReturnType,
            .params = &params,
        },
    });
}
```

This replaces what would require runtime reflection or code generation in other languages. The compiler resolves the function pointer type entirely at compile time, producing a direct call with no dispatch overhead.

---

### zig-objc: Architecture-Aware Dispatch Selection

ObjC message sends use different runtime functions depending on CPU architecture and return type. zig-objc selects the correct variant at comptime:

```zig
fn selectMsgSend(comptime ReturnType: type) *const anyopaque {
    const arch = @import("builtin").cpu.arch;

    if (arch == .x86_64) {
        // x86_64 uses specialized variants
        if (isLargeStruct(ReturnType)) return &objc_msgSend_stret;
        if (ReturnType == f64) return &objc_msgSend_fpret;
        return &objc_msgSend;
    }

    // aarch64 handles everything through base msgSend
    return &objc_msgSend;
}

fn isLargeStruct(comptime T: type) bool {
    const info = @typeInfo(T);
    if (info != .@"struct") return false;
    return @sizeOf(T) > 16; // Threshold for register passing
}
```

The branch disappears entirely in the compiled output — on aarch64, only `objc_msgSend` exists in the binary. On x86_64, each call site uses the correct variant with no runtime check.

---

### zig-objc: Comptime Type Encoding for class_addMethod

When registering Zig methods as ObjC method implementations, zig-objc generates the ObjC type encoding string at comptime from the Zig function signature:

```zig
fn encodeType(comptime T: type) [:0]const u8 {
    if (T == objc.Id) return "@";
    if (T == objc.SEL) return ":";
    if (T == void) return "v";
    if (T == bool) return "B";
    if (T == f32) return "f";
    if (T == f64) return "d";
    if (T == c_int) return "i";
    if (T == c_uint) return "I";
    if (T == c_long) return "l";
    // ...
    @compileError("Unsupported type for ObjC encoding: " ++ @typeName(T));
}

fn methodTypeEncoding(comptime Fn: type) [:0]const u8 {
    const info = @typeInfo(Fn).@"fn";
    comptime var encoding: []const u8 = encodeType(info.return_type.?);
    inline for (info.params) |param| {
        encoding = encoding ++ encodeType(param.type.?);
    }
    return encoding ++ "\x00";
}
```

The resulting encoding string is a compile-time constant embedded in the binary. `class_addMethod` receives it without any runtime string construction.

---

### ziglua: @typeInfo Struct Field Walking

ziglua registers Zig types with the Lua runtime by walking struct and enum fields at comptime. The pattern uses `@typeInfo(T).@"struct".fields` to iterate fields and generate push/check logic for each:

```zig
fn pushStruct(comptime T: type, state: *lua.State, value: T) void {
    const fields = @typeInfo(T).@"struct".fields;
    state.createTable(0, fields.len);

    inline for (fields) |field| {
        state.pushString(field.name);
        pushValue(field.type, state, @field(value, field.name));
        state.setTable(-3);
    }
}

fn pushValue(comptime T: type, state: *lua.State, value: T) void {
    if (T == f64) { state.pushNumber(value); return; }
    if (T == bool) { state.pushBoolean(value); return; }
    if (T == []const u8) { state.pushString(value); return; }
    if (@typeInfo(T) == .@"struct") { pushStruct(T, state, value); return; }
    @compileError("Unsupported Lua type: " ++ @typeName(T));
}
```

This generates specialized marshaling code for each struct type. A struct with three `f64` fields compiles to three `pushNumber` calls with no reflection overhead.

---

### ziglua: Comptime Version Dispatch

ziglua supports Lua 5.1 through 5.5, LuaJIT, and Luau from a single codebase. Version differences are resolved at comptime using a `switch` on a comptime-known `lang` value:

```zig
pub fn getField(state: *State, index: i32, name: [:0]const u8) LuaType {
    switch (lang) {
        .lua51, .luajit => {
            state.getField(index, name);
            return state.typeOf(-1);
        },
        .lua52, .lua53, .lua54, .lua55 => {
            return @enumFromInt(c.lua_getfield(state.state, index, name.ptr));
        },
        .luau => {
            return @enumFromInt(c.lua_getfield(state.state, index, name.ptr));
        },
    }
}
```

Because `lang` is comptime-known, the switch compiles to a single branch. The unused Lua version code is eliminated entirely. This is more maintainable than separate files per version — behavioral differences are visible inline.

---

### Lightpanda: Builder(comptime T: type) for V8 Mapping

Lightpanda's JavaScript engine integration uses a comptime builder pattern to map Zig types to V8 concepts. Given a Zig type, `Builder` generates the V8 function templates, property descriptors, and accessor callbacks:

```zig
fn Builder(comptime T: type) type {
    return struct {
        pub fn build(isolate: *v8.Isolate) *v8.FunctionTemplate {
            const tmpl = v8.FunctionTemplate.init(isolate, constructor);
            const inst = tmpl.instanceTemplate();

            const fields = @typeInfo(T).@"struct".fields;
            inline for (fields) |field| {
                if (isJSExposed(field)) {
                    inst.setAccessor(
                        field.name,
                        makeGetter(T, field),
                        makeSetter(T, field),
                    );
                }
            }
            return tmpl;
        }

        fn makeGetter(comptime Owner: type, comptime field: std.builtin.Type.StructField) v8.AccessorCallback {
            return struct {
                fn get(info: *const v8.PropertyCallbackInfo) void {
                    const obj: *Owner = unwrapInternal(info.getThis());
                    const value = @field(obj, field.name);
                    info.getReturnValue().set(toV8Value(value));
                }
            }.get;
        }
    };
}
```

Each Zig struct produces a unique `Builder` instantiation. The generated V8 template code is specialized per type — no generic property lookup at runtime.

---

### When to Use Comptime vs Build-Step Generation

#### Comptime (inline in source)

Use when:
- Transforming Zig type information (struct fields, function signatures, enums)
- The "input" is Zig types already available at compile time
- Output is used directly by Zig code in the same compilation unit

Examples: zig-objc (function type synthesis), ziglua (type marshaling), Lightpanda (V8 template generation)

#### Build-Step Generation (in build.zig)

Use when:
- The input is an external file (XML, JSON, protocol spec)
- Parsing requires complex logic that would exhaust the comptime evaluation budget
- The generated output should be inspectable as a file on disk

Example: vulkan-zig parses the ~2MB Vulkan XML registry with a generator executable during the build step. The output is a complete `vk.zig` file with dispatch tables and type definitions.

```zig
const generate_step = b.addRunArtifact(generator);
generate_step.addFileArg(b.path("vk.xml"));
const generated = generate_step.addOutputFileArg("vk.zig");
exe.root_module.addImport("vulkan", b.createModule(.{
    .root_source_file = generated,
}));
```

#### External Tooling (outside Zig entirely)

Use when:
- The source language has its own build toolchain (C++, TypeScript)
- Binding generation requires analysis that Zig cannot perform

Example: Bun uses `cppbind.ts` to generate C++ binding glue. The TypeScript tool produces C++ source files that are compiled by Ninja, not by `build.zig`. The generated code is then linked with the Zig `.o` file.

---

### Memory Ownership

Comptime-generated wrappers must make ownership explicit in their signatures. Do not hide allocations inside generated code.

When generating wrappers that cross language boundaries, propagate the allocator parameter or use caller-provided buffers:

```zig
// Good: caller controls the allocation
fn generatedWrapper(allocator: Allocator, input: []const u8) ![:0]u8 {
    return allocator.dupeZ(u8, input);
}

// Better: zero allocations, caller provides buffer
fn generatedWrapperBuf(input: []const u8, buf: []u8) ![*:0]const u8 {
    if (input.len >= buf.len) return error.BufferTooSmall;
    @memcpy(buf[0..input.len], input);
    buf[input.len] = 0;
    return buf[0..input.len :0].ptr;
}
```

For comptime type synthesis (zig-objc, Lightpanda Builder), ownership is inherent in the generated function signature — `objc_msgSend` returns values by the ObjC ownership convention, V8 accessor callbacks operate on GC-managed values. The comptime code does not introduce new ownership semantics; it preserves the target runtime's model.

---

See also: `references/cross-language-abi.md` for zig-objc in action (Ghostty's ObjC/Swift bridging), `references/build-system-c-integration.md` for build-step code generation details.
