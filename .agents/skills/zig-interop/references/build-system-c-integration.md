# Build System C Integration

Zig's build system compiles C and C++ sources alongside Zig code, replacing Make or CMake for many projects. Real codebases demonstrate several distinct architectural patterns for organizing this.

### Ghostty: pkg/<name>/build.zig Architecture

Ghostty places each C library dependency in its own `pkg/<name>/` directory, each with its own `build.zig`. The top-level `build.zig` delegates to a `src/build/` module system that orchestrates everything.

Each package's `build.zig` supports **system integration OR vendored builds**, selected at configure time:

```zig
// Ghostty's pattern for optional system library integration
if (b.systemIntegrationOption("freetype", .{})) {
    // Use system-installed freetype
    step.linkSystemLibrary("freetype2");
} else {
    // Build freetype from vendored source in pkg/freetype/
    const freetype = @import("pkg/freetype/build.zig");
    freetype.link(step, target, optimize);
}
```

This gives packagers (Homebrew, Nix, distros) the ability to link against system libraries while developers get reproducible vendored builds by default.

---

### ziglua: Building C from Source with addCSourceFiles

ziglua compiles upstream Lua C source files directly, supporting Lua 5.1 through 5.5, LuaJIT, and Luau from a single codebase.

```zig
const lua_sources = &.{
    "vendor/lua/lapi.c",
    "vendor/lua/lcode.c",
    "vendor/lua/ldebug.c",
    "vendor/lua/ldo.c",
    "vendor/lua/lfunc.c",
    "vendor/lua/lgc.c",
    // ... all Lua core sources
};

lib.addCSourceFiles(.{
    .files = lua_sources,
    .flags = &.{
        "-std=c99",
        "-DLUA_USE_POSIX",
        "-fno-sanitize=undefined",
    },
});
```

**Separate flags per file set** when different sources need different options. Call `addCSourceFiles` multiple times rather than forcing one flag set on everything.

#### addTranslateC for C Headers

ziglua uses `addTranslateC` to convert Lua's C headers into a Zig module, making C types available as native Zig types without `@cImport`:

```zig
const translate_c = b.addTranslateC(.{
    .root_source_file = b.path("vendor/lua/lua.h"),
    .target = target,
    .optimize = optimize,
});
translate_c.addIncludePath(b.path("vendor/lua"));
const lua_module = translate_c.createModule();

// Other modules can now import Lua types directly
exe.root_module.addImport("lua", lua_module);
```

This approach produces a cached Zig file from the C header, enabling Zig-native access to all type definitions without runtime overhead.

---

### vulkan-zig: Build-Time Code Generation

vulkan-zig takes a different approach — a generator executable runs during the build to produce Zig source from the Vulkan XML registry.

```zig
// build.zig
const vk_gen = b.dependency("vulkan-zig", .{});
const generator = vk_gen.artifact("generator");

// Run the generator executable during build
const generate_step = b.addRunArtifact(generator);
generate_step.addFileArg(b.path("vk.xml"));
const generated_source = generate_step.addOutputFileArg("vk.zig");

// Use the generated file as a module
exe.root_module.addImport("vulkan", b.createModule(.{
    .root_source_file = generated_source,
}));
```

The pattern: `b.addExecutable` for the generator, `b.addRunArtifact` to execute it, `addOutputFileArg` to capture the output, `b.createModule` to make it importable. The build system tracks dependencies automatically — regeneration happens only when `vk.xml` changes.

The generated output includes dispatch tables with nullable function pointers for Vulkan's loader pattern. This is inspectable on disk, unlike comptime-generated types.

---

### libxev: Dual Static/Dynamic Build

libxev produces both static and dynamic libraries from the same C API module, plus a hand-written header and generated pkg-config file:

```zig
const static_lib = b.addStaticLibrary(.{
    .name = "xev",
    .root_source_file = b.path("src/c_api.zig"),
    .target = target,
    .optimize = optimize,
});

const dynamic_lib = b.addSharedLibrary(.{
    .name = "xev",
    .root_source_file = b.path("src/c_api.zig"),
    .target = target,
    .optimize = optimize,
});

// Install the hand-written header
b.installFile("include/xev.h", "include/xev.h");

// Generate and install pkg-config file
const pc = generatePkgConfig(b, "xev");
b.installFile(pc, "lib/pkgconfig/xev.pc");

b.installArtifact(static_lib);
b.installArtifact(dynamic_lib);
```

This pattern enables C projects to consume the Zig library through standard tooling — `pkg-config --libs xev` works as expected.

---

### Bun: Split Build Architecture

Bun does **not** compile C++ through `build.zig`. The C++ code (WebKit/JavaScriptCore integration) uses a separate Ninja build system. Zig's `build.zig` produces a single `.o` file for the Zig code only.

For C system headers, Bun uses translate-c via a combined header:

```zig
// A single header that includes all needed system headers
const translate_c = b.addTranslateC(.{
    .root_source_file = b.path("src/c-headers-for-zig.h"),
    .target = target,
    .optimize = optimize,
});
```

Generated C++ binding code is passed into the Zig build as module imports, not compiled by it. This split recognizes that some C++ codebases (WebKit) have build systems too complex to replicate in `build.zig`.

---

### Framework Linking and XCFramework Generation

Ghostty links macOS and iOS frameworks conditionally:

```zig
const os = target.result.os.tag;
if (os == .macos) {
    lib.linkFramework("CoreFoundation");
    lib.linkFramework("Metal");
    lib.linkFramework("AppKit");
    lib.linkFramework("IOKit");
    lib.linkFramework("CoreGraphics");
} else if (os == .ios) {
    lib.linkFramework("UIKit");
    lib.linkFramework("Metal");
    lib.linkFramework("CoreGraphics");
}
```

For distribution, Ghostty generates an **XCFramework** bundle that packages the library for both macOS and iOS targets. The build system produces platform-specific artifacts, then combines them with `xcodebuild -create-xcframework`.

#### MetallibStep: Custom Build Steps

Ghostty compiles Metal shaders through a custom build step that invokes `xcrun metal` and `xcrun metallib`:

```zig
// Custom step that compiles .metal → .air → .metallib
const metallib = MetallibStep.create(b, .{
    .name = "shaders",
    .source = b.path("src/shaders/main.metal"),
    .target = target,
});
lib.step.dependOn(&metallib.step);
```

Custom build steps extend `std.Build.Step` and can run arbitrary logic — Ghostty uses this pattern for any build artifact that Zig's built-in steps do not handle natively.

---

### addIncludePath vs addSystemIncludePath

`addIncludePath` — for your own headers. The compiler emits warnings for issues in these files.

`addSystemIncludePath` — for third-party headers. Suppresses warnings so vendor code does not pollute build output.

```zig
// Your headers — want warnings
lib.addIncludePath(b.path("include"));

// Vendored headers — suppress warnings
lib.addSystemIncludePath(b.path("vendor/lua/include"));
lib.addSystemIncludePath(b.path("vendor/freetype/include"));
```

Use `addSystemIncludePath` for anything you do not maintain.

---

### Cross-Compilation Considerations

Zig bundles libc headers for many targets, making cross-compilation work without a separate toolchain:

```zig
const target = b.resolveTargetQuery(.{
    .cpu_arch = .aarch64,
    .os_tag = .linux,
    .abi = .gnu,
});

exe.addCSourceFiles(.{
    .files = &.{"vendor/sqlite3.c"},
    .flags = &.{"-std=c99"},
});
exe.linkLibC();
```

C sources cross-compile alongside Zig code — Zig provides the compiler, headers, and linker for the target.

When system integration packages are not available for the target, Ghostty's `systemIntegrationOption` pattern falls back to vendored source automatically. This makes cross-compilation the default case rather than a special one.

For targets without bundled libc, specify a sysroot:

```zig
exe.addSysroot(.{ .cwd_relative = "/path/to/riscv64-sysroot" });
```

---

### Memory Ownership

Static linking produces one allocator heap — Zig and C code share the same `malloc`/`free`. Dynamic linking can produce **separate heaps** if each shared library links its own libc. Never `free` a pointer across a dynamic library boundary unless both sides provably share the same allocator.

Bun routes BoringSSL's memory through mimalloc by exporting custom `OPENSSL_memory_alloc`, `OPENSSL_memory_free`, and `OPENSSL_memory_realloc` hooks. The free hook also **zeros memory before releasing it** — a security requirement for cryptographic allocations. This pattern works because static linking puts everything in the same address space.

---

### Build-From-Source Packages (allyourcodebase)

The [allyourcodebase](https://github.com/allyourcodebase) organization maintains ~115 community packages, each wrapping a single C library with a `build.zig`. These packages demonstrate the minimal viable pattern for making C libraries available to the Zig ecosystem.

**Two vendoring strategies** coexist across the repos:

1. **Tarball dependency** — `build.zig.zon` declares a URL to the upstream release tarball. The Zig package manager fetches it at build time.
2. **Committed sources** — the C source tree is checked into the repository directly, typically under a `vendor/` or `upstream/` directory.

**None of these packages use `@cImport` internally.** They compile the C library from source using `addCSourceFiles` and produce a linkable artifact with installed headers. Downstream consumers link the library and `@cImport` the installed headers — the package itself does not bridge the C/Zig boundary.

```zig
// Downstream consumer pattern
const zlib_dep = b.dependency("zlib", .{ .target = target, .optimize = optimize });
exe.linkLibrary(zlib_dep.artifact("z"));
exe.addIncludePath(zlib_dep.path("include"));
```

**Platform dispatch** uses `target.result.os.tag` switches rather than pkg-config. Since the libraries are built from source, there is no need to probe the host system for installed packages:

```zig
const os = target.result.os.tag;
if (os == .linux) {
    lib.addCSourceFile(.{ .file = b.path("src/platform_linux.c"), .flags = &.{} });
} else if (os == .macos) {
    lib.addCSourceFile(.{ .file = b.path("src/platform_darwin.c"), .flags = &.{} });
} else if (os == .windows) {
    lib.addCSourceFile(.{ .file = b.path("src/platform_win32.c"), .flags = &.{} });
}
```

**Config headers** replace autoconf-style `config.h` generation. `b.addConfigHeader()` produces a header with `#define` values computed from the build configuration:

```zig
const config = b.addConfigHeader(.{
    .style = .{ .autoconf = b.path("config.h.in") },
});
config.addValues(.{
    .HAVE_UNISTD_H = target.result.os.tag != .windows,
    .HAVE_STDINT_H = true,
    .SIZEOF_LONG = @as(u64, target.result.ptrBitWidth() / 8),
});
lib.addConfigHeader(config);
```

The SDL package is the most complex example (~50KB `build.zig`), while zlib is among the simplest (54 lines). SDL also demonstrates **Zig version compatibility**: it checks `@hasDecl` for build API changes between Zig versions, allowing the same `build.zig` to work across multiple Zig releases:

```zig
// Zig version compat shim pattern from SDL
const root_module = if (@hasDecl(std.Build, "createModule"))
    lib.root_module
else
    lib.root_module_ptr.*;
```

The allyourcodebase pattern is complementary to Ghostty's `pkg/<name>/build.zig` approach. Ghostty vendors libraries inside its own repo with system-integration fallback; allyourcodebase publishes each library as a standalone Zig package. Both avoid pkg-config and build everything from source for cross-compilation.

---

See also: `references/cross-language-abi.md` for struct layout and linking across languages, `references/comptime-ffi-metaprogramming.md` for build-time vs comptime code generation tradeoffs.
