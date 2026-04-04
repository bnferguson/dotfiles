---
name: zig-interop
description: >
  This skill should be used when working on Zig FFI or cross-language
  interoperability — wrapping C libraries, binding C++, exporting Zig
  as C, bridging Zig with Rust/Swift/ObjC/Go/Ruby, configuring build.zig
  for C compilation, or using comptime for FFI metaprogramming. Patterns
  are extracted from production codebases (Bun, Ghostty, libxev,
  TigerBeetle, Lightpanda). Targets Zig 0.15+. Complements
  zig-programming (language fundamentals) and idiomatic-zig (style).
---

# Zig Interop Skill

Patterns for bridging Zig with C, C++, Rust, Swift, and Objective-C, drawn from production projects that ship real FFI boundaries. This skill covers the mechanics of crossing language borders -- type mapping, memory ownership transfer, ABI compliance, build integration, and comptime code generation.

## Table of Contents

- [How to Use This Skill](#how-to-use-this-skill)
- [Bundled Resources](#bundled-resources)
- [@cImport Direct Binding](#cimport-direct-binding)
- [C Shim Layer for C++](#c-shim-layer-for-cpp)
- [Exporting Zig as a C Library](#exporting-zig-as-a-c-library)
- [Cross-Language via C ABI](#cross-language-via-c-abi)
- [Zig Build System C Compilation](#zig-build-system-c-compilation)
- [Comptime Metaprogramming for FFI](#comptime-metaprogramming-for-ffi)
- [Memory Ownership Across Boundaries](#memory-ownership-across-boundaries)
- [Sources](#sources)

## How to Use This Skill

Pick the section that matches your task:

- **Wrapping a C library** -- Start with [@cImport Direct Binding](#cimport-direct-binding) and the `cimport_wrapping.zig` example
- **Binding C++ code** -- Read [C Shim Layer for C++](#c-shim-layer-for-cpp), then the shim pipeline in `cpp_shim_binding.zig`
- **Exposing Zig to other languages** -- [Exporting Zig as a C Library](#exporting-zig-as-a-c-library) and `export_c_library.zig`
- **Zig talking to Rust, Swift, ObjC, Go, or Ruby** -- [Cross-Language via C ABI](#cross-language-via-c-abi) and `cross_language_abi.zig`
- **Building a multi-language client library** -- [Exporting Zig as a C Library](#exporting-zig-as-a-c-library) and `cross_language_consumers.zig`
- **Compiling C sources with zig build** -- [Zig Build System C Compilation](#zig-build-system-c-compilation) and `build_c_sources.zig`
- **Generating type-safe wrappers at comptime** -- [Comptime Metaprogramming for FFI](#comptime-metaprogramming-for-ffi) and `comptime_ffi_wrapper.zig`
- **Ownership rules at FFI boundaries** -- [Memory Ownership Across Boundaries](#memory-ownership-across-boundaries) and `memory_ownership_boundary.zig`

## Bundled Resources

### References

Load on demand when working on a specific interop pattern:

| Reference | Description | Search hint |
|-----------|-------------|-------------|
| `references/cimport-and-type-mapping.md` | @cImport mechanics, Ghostty's c.zig pattern, Bun's pre-translation approach, opaque vs handle wrapping | `@cImport`, `translate-c` |
| `references/cpp-shim-patterns.md` | Bun's codegen pipeline, `[[ZIG_EXPORT]]` annotations, ExternTraits, Errorable(T), flat C API alternatives | `C++ shim`, `extern "C"` |
| `references/exporting-zig-as-c.md` | libxev's fixed-size byte arrays, Ghostty's CAPI struct, @fieldParentPtr smuggling, module.modulemap | `export fn`, `callconv` |
| `references/cross-language-abi.md` | Zig-ObjC (zig-objc), Zig-Swift (module.modulemap), Zig-Rust, Zig-Go (cgo/runtime.Pinner), Zig-Ruby (zig.rb/RubyAllocator) | `ABI`, `Rust FFI`, `cgo`, `Ruby` |
| `references/build-system-c-integration.md` | `addCSourceFiles`, `addTranslateC`, framework linking, allyourcodebase vendoring patterns, cross-compilation | `addCSourceFiles`, `linkSystemLibrary`, `addTranslateC` |
| `references/comptime-ffi-metaprogramming.md` | zig-objc @Type synthesis, ziglua field walking, TigerBeetle foreign code gen, zig-gobject GIR pipeline | `comptime`, `@typeInfo`, `@Type` |

### Examples

Complete, annotated code demonstrating each pattern:

| Example | Description |
|---------|-------------|
| `examples/cimport_wrapping.zig` | @cImport, type aliases, sentinel pointer conversion |
| `examples/cpp_shim_binding.zig` | Zig side of a C++ shim: extern decls, init/deinit lifecycle |
| `examples/export_c_library.zig` | Exporting Zig functions with opaque handles and error codes |
| `examples/cross_language_abi.zig` | extern struct layout, callbacks, context pointer passing |
| `examples/build_c_sources.zig` | build.zig template for compiling C alongside Zig |
| `examples/comptime_ffi_wrapper.zig` | Comptime type reflection for type-safe C wrappers |
| `examples/memory_ownership_boundary.zig` | Ownership transfer patterns across FFI boundaries |
| `examples/cross_language_consumers.zig` | Comptime binding generator emitting Go/Rust/C types (TigerBeetle pattern) |

## @cImport Direct Binding

Zig's `@cImport` translates C headers at compile time, giving direct access to C types and functions without writing bindings by hand. Production projects take different approaches depending on header complexity:

- **Dedicated c.zig files** -- Ghostty isolates each C library's `@cImport` into a per-package `c.zig` file (e.g., `pkg/freetype/c.zig`, `pkg/fontconfig/c.zig`). This prevents duplicate translation units and keeps import paths clean.
- **Pre-translated bindings** -- Bun does NOT use `@cImport` for BoringSSL. Instead it ships a 19K-line pre-translated and manually enriched Zig file, giving tighter control over types and avoiding translate-c limitations.
- **addTranslateC in build.zig** -- ziglua uses `addTranslateC` as a middle ground: build-time header translation without embedding `@cImport` in source.
- **C ABI workaround files** -- When Zig's C ABI has platform-specific issues, Ghostty uses small ext.c files compiled alongside the Zig code as shims.

See `references/cimport-and-type-mapping.md` for the full type mapping table and `examples/cimport_wrapping.zig` for a worked example wrapping a C library.

## C Shim Layer for C++

C++ cannot be imported directly. Production projects use different strategies depending on the C++ codebase's size and complexity:

- **Codegen pipeline** -- Bun wraps JavaScriptCore through a three-layer system: C++ `bindings.cpp` files annotated with `[[ZIG_EXPORT(tag)]]`, a TypeScript code generator (`cppbind.ts`) that parses annotations and emits Zig bindings, and Zig opaque types that consume the generated declarations. Exception handling uses three tags: `nothrow`, `zero_is_throw`, `check_slow`.
- **Flat C API alternative** -- Lightpanda does NOT wrap V8 C++ directly. It uses zig-v8-fork, which provides a pre-existing flat C API. When a maintained C API exists for your C++ dependency, prefer it over writing custom shims.
- **ABI-compatible types** -- Bun's JSValue is `enum(i64)`, directly matching JSC's NaN-boxed EncodedJSValue. Errorable(T) is an ABI-safe tagged union for error propagation across the boundary. ExternTraits<T> in C++ define conversion rules (e.g., WTF::String uses `leakRef()` to transfer ownership).
- **Opaque handle wrapping for STL types** -- zpp wraps `std::string` behind opaque `intptr_t` handles with three ownership modes (read-only, fixed write, growable write). C++ side uses `new`/`delete` behind `extern "C"` functions; Zig caches data pointer and length to avoid FFI calls on reads. Build requires `-fno-exceptions -fno-rtti` on the C++ side.
- **Separate build systems** -- Bun's C++ is NOT compiled by build.zig. It uses a separate Ninja/TypeScript build system; Zig produces one .o file that links against the C++ artifacts.

See `references/cpp-shim-patterns.md` and `examples/cpp_shim_binding.zig`.

## Exporting Zig as a C Library

Zig can produce shared or static libraries consumable by any C-compatible language. Production projects demonstrate two distinct approaches:

- **Fixed-size byte array handles** -- libxev exposes opaque types as stack-allocatable C structs containing a fixed-size byte array (`uint8_t data[XEV_SIZEOF_LOOP - sizeof(XEV_ALIGN_T)]`). No heap allocation needed on the C side. Size validation tests prevent drift.
- **CAPI struct pattern** -- Ghostty collects all `export fn` declarations into a single CAPI struct in `embedded.zig`. The C consumer receives one struct with all function pointers, rather than linking against individual symbols.
- **Callback pointer smuggling** -- libxev extends its Completion struct with extra fields, then uses `@fieldParentPtr` to recover context inside callbacks -- avoiding a separate userdata pointer.
- **Multi-language client pattern** -- TigerBeetle compiles one Zig core into platform-specific static libraries consumed by Go, Rust, Python, and other language clients through the C ABI. Comptime binding generators emit idiomatic types per target language. Gotcha: `u128` is passed as `[16]u8` because u128-by-value is broken across compilers.
- **Swift consumption path** -- Ghostty exports through a hand-written `ghostty.h` header with a `module.modulemap`, allowing Swift to import the Zig library as `GhosttyKit`. XCFramework generation handles macOS/iOS targets.

See `references/exporting-zig-as-c.md` and `examples/export_c_library.zig`.

## Cross-Language via C ABI

The C ABI is the lingua franca for cross-language calls. Production projects demonstrate several paths:

- **Zig-ObjC via zig-objc** -- Ghostty uses mitchellh/zig-objc, NOT raw `objc_msgSend`. Pattern: `objc.getClass("NSFileManager").?.msgSend(objc.Object, objc.sel("defaultManager"), .{})`. Metal rendering is the heaviest ObjC consumer, with AutoreleasePool manually managed per frame.
- **Zig-Swift via C API** -- Ghostty has no direct Zig-Swift bridge. Architecture: Zig export fn -> hand-written ghostty.h -> module.modulemap -> Swift imports as GhosttyKit. Swift passes userdata via `Unmanaged.passUnretained(self).toOpaque()`.
- **Zig-Rust via extern "C"** -- Lightpanda bridges to html5ever: Rust exposes `extern "C"` functions, Zig declares matching extern prototypes. Callback-driven memory: Zig passes function pointers into Rust, Rust calls back for DOM mutations. No shared heap.
- **Zig-Go via cgo** -- TigerBeetle's Go client links a pre-built Zig static library through cgo. Go objects accessed from Zig callback threads are pinned with `runtime.Pinner` for GC safety. Async bridge: Zig event loop fires a C completion callback that writes to a Go buffered channel. Achieves 94% of native Zig speed.
- **Zig-Ruby via zig.rb** -- zig.rb implements `std.mem.Allocator` backed by Ruby's `xmalloc`/`xrealloc`/`xfree`, keeping Zig allocations visible to Ruby's GC. Comptime method binding validates signatures and generates per-arity C trampolines (0-15 args), avoiding varargs entirely. TypedDataClass wraps Zig structs as GC-tracked Ruby objects.
- **Callback + userdata pattern** -- Ghostty's Options extern struct carries function pointers plus `?*anyopaque` userdata for each callback, letting the other language smuggle its own context through the C boundary.

See `references/cross-language-abi.md` and `examples/cross_language_abi.zig`.

## Zig Build System C Compilation

`zig build` can compile C and C++ sources alongside Zig, replacing Make/CMake for many projects:

- **Per-package build.zig** -- Ghostty isolates each C library in `pkg/<name>/` with its own `build.zig` and dedicated `c.zig` for `@cImport`. This keeps dependency boundaries clean and makes each library independently buildable.
- **addTranslateC for headers** -- ziglua compiles upstream Lua C source via `addCSourceFiles` and uses `addTranslateC` for headers, supporting Lua 5.1-5.5, LuaJIT, and Luau from a single codebase via comptime version dispatch.
- **Cross-compilation** -- Pass target triple; Zig's bundled libc headers handle sysroot concerns.
- **Separate C++ build** -- Bun does NOT compile C++ through build.zig. When the C++ dependency has its own complex build system, link against pre-built artifacts rather than trying to replicate the build in Zig.

See `references/build-system-c-integration.md` and `examples/build_c_sources.zig` (a build.zig template).

## Comptime Metaprogramming for FFI

Zig's comptime can generate type-safe wrappers from type information, eliminating boilerplate. But the approach depends on API surface size:

- **Comptime function synthesis** -- zig-objc's core trick: `@Type(.{ .@"fn" = ... })` synthesizes `objc_msgSend` call signatures at comptime, selecting `_stret`/`_fpret` variants based on `builtin.target.cpu.arch` and return type. The MsgSend(T) mixin gives both Object and Class the same dispatch interface.
- **Build-time code generation** -- vulkan-zig does NOT use comptime for the Vulkan API (too large). A generator executable runs during `zig build`, producing `vk.zig` with dispatch tables. Consumers use `inline for (std.meta.fields(Dispatch))` to load nullable function pointers from an opaque loader.
- **Comptime version dispatch** -- ziglua's define.zig walks `@typeInfo(T).@"struct".fields` at comptime to generate Lua type definitions. A single codebase supports multiple Lua versions via `switch (lang)`.
- **Comptime-generates-foreign-code** -- TigerBeetle's `rust_bindings.zig` and `go_bindings.zig` use Zig comptime to emit source code in other languages -- `#[repr(C)]` Rust structs and layout-compatible Go structs. The Zig build system runs the generator, and each language client consumes the output as checked-in generated code.
- **Build-time XML-to-Zig pipeline** -- zig-gobject translates GIR XML into a complete Zig package with `build.zig`. Generated `extern fn` declarations are aliased to `pub const` (zero-cost). Comptime type hierarchy enables `isAssignableFrom()` that walks parent chains and interfaces at compile time, with `as()` for safe upcast and `cast()` returning `?*T` for downcast.
- **Comptime bridge mapping** -- Lightpanda's bridge.zig uses `Builder(comptime T: type)` to map Zig types to JavaScript concepts at compile time.

See `references/comptime-ffi-metaprogramming.md` and `examples/comptime_ffi_wrapper.zig`.

## Memory Ownership Across Boundaries

Memory ownership is the hardest part of FFI. Production projects use these strategies:

- **Tagged pointer encoding** -- Bun's ZigString is an extern struct with UTF-16/Latin1 encoding packed into the high bits of the pointer, avoiding a separate encoding field.
- **Callback-driven allocation** -- Lightpanda's Rust bridge passes function pointers into Rust; Rust calls back into Zig for DOM mutations. No shared heap means no cross-language allocator coordination.
- **Custom allocator routing** -- Bun routes BoringSSL memory through mimalloc by exporting `OPENSSL_memory_alloc`/`OPENSSL_memory_free` hooks. The C library calls these instead of system malloc.
- **Sentinel tracking** -- Ghostty's `ghostty_string_s` tracks a sentinel flag so the receiving side knows whether to scan for a null terminator or use a length field for deallocation.
- **Ownership transfer via leakRef** -- Bun's ExternTraits<WTF::String> uses `leakRef()` to hand a reference-counted string across the boundary without the C++ side releasing it.

See `examples/memory_ownership_boundary.zig` for a comprehensive example combining these patterns.

## Sources

### Tier 1 -- Production codebases with extensive FFI

- **Bun** -- JavaScript runtime; C++ interop with JavaScriptCore via codegen pipeline, BoringSSL via pre-translated bindings, custom allocator routing through mimalloc
- **Ghostty** -- Terminal emulator; Zig-ObjC via zig-objc, Zig-Swift via C API + module.modulemap, per-package C library isolation, CAPI struct pattern
- **libxev** -- Cross-platform event loop; fixed-size byte array opaque handles, @fieldParentPtr callback smuggling, hand-written C header + pkg-config
- **Lightpanda** -- Headless browser; flat C API via zig-v8-fork, Rust-Zig via callback-driven extern "C", comptime bridge mapping
- **TigerBeetle** -- Financial transactions database; one Zig core with Go/Rust/Python/etc. clients via C ABI, comptime binding generators emit foreign-language source, u128-as-[16]u8 ABI workaround, runtime.Pinner for Go GC safety

### Tier 2 -- Libraries and binding generators

- **vulkan-zig** -- Build-time generated Vulkan bindings from XML spec, dispatch table pattern
- **ziglua** -- Lua binding using addTranslateC + comptime version dispatch across Lua 5.1-5.5/LuaJIT/Luau
- **zig-objc** -- Objective-C runtime bindings via comptime @Type function synthesis, architecture-aware dispatch
- **zig-gobject** -- GIR XML-to-Zig pipeline with comptime-safe type hierarchy, zero-cost extern fn aliasing, typed signal connection
- **zpp** -- C++ STL bridging via opaque handles; wraps std::string with three ownership modes, bidirectional data flow via function pointers
- **zig.rb** -- Ruby extension framework; RubyAllocator (std.mem.Allocator backed by xmalloc), comptime per-arity trampoline generation, TypedDataClass for GC-tracked Zig structs
- **allyourcodebase** -- Community collection of 115+ C library build.zig packages; vendoring patterns, config headers, platform dispatch without pkg-config
