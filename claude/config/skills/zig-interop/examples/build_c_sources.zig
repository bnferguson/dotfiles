//! Build template for compiling C sources alongside Zig.
//!
//! Patterns from real projects:
//! 1. System vs vendored build (Ghostty's pkg/ pattern).
//! 2. addCSourceFiles with flags (ziglua).
//! 3. addTranslateC for C header -> Zig module (ziglua).
//! 4. Build-time code generation exe (vulkan-zig).
//! 5. Framework linking + conditional OS checks (Ghostty).
//! 6. Dual static/dynamic library output (libxev).

const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const resolved = target.result;

    // Pattern 1: system vs vendored, selected by build option
    const use_system = b.option(bool, "system-freetype", "Use system FreeType") orelse false;

    const exe = b.addExecutable(.{
        .name = "myapp",
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
    });

    if (use_system) {
        exe.linkSystemLibrary("freetype2");
    } else {
        // Pattern 2: addCSourceFiles with version-specific flags
        exe.addCSourceFiles(.{
            .files = &.{
                "vendor/freetype/src/base/ftbase.c",
                "vendor/freetype/src/base/ftsystem.c",
                "vendor/freetype/src/truetype/truetype.c",
            },
            .flags = &.{ "-DFT2_BUILD_LIBRARY", "-std=c99", "-fno-sanitize=undefined" },
        });
        exe.addIncludePath(b.path("vendor/freetype/include"));
    }

    // Ghostty's ext.c workaround for constructs translate-c can't handle
    exe.addCSourceFile(.{ .file = b.path("src/ext.c"), .flags = &.{"-std=c11"} });

    // Pattern 3: addTranslateC — expose C types as `@import("lua")`
    const translate_c = b.addTranslateC(.{
        .root_source_file = b.path("vendor/lua/lua.h"),
        .target = target,
        .optimize = optimize,
    });
    translate_c.addIncludePath(b.path("vendor/lua"));
    exe.root_module.addImport("lua", translate_c.createModule());

    // Pattern 4: build-time code generation (vulkan-zig)
    const generator = b.addExecutable(.{
        .name = "generate-bindings",
        .root_source_file = b.path("tools/gen_bindings.zig"),
        .target = b.host,
    });
    const gen_step = b.addRunArtifact(generator);
    gen_step.addArg("--spec");
    gen_step.addFileArg(b.path("spec/api.xml"));
    const gen_output = gen_step.addOutputFileArg("bindings.zig");
    exe.root_module.addAnonymousImport("bindings", .{ .root_source_file = gen_output });

    // Pattern 5: OS-conditional framework/library linking
    exe.linkLibC();
    switch (resolved.os.tag) {
        .macos => {
            exe.linkFramework("CoreText");
            exe.linkFramework("CoreFoundation");
        },
        .linux => exe.linkSystemLibrary("fontconfig"),
        else => {},
    }
    b.installArtifact(exe);

    // Pattern 6: dual static/dynamic library (libxev)
    inline for ([_]bool{ false, true }) |is_shared| {
        const lib = if (is_shared) b.addSharedLibrary(.{
            .name = "mylib",
            .root_source_file = b.path("src/lib.zig"),
            .target = target,
            .optimize = optimize,
        }) else b.addStaticLibrary(.{
            .name = "mylib",
            .root_source_file = b.path("src/lib.zig"),
            .target = target,
            .optimize = optimize,
        });
        lib.linkLibC();
        b.installArtifact(lib);
    }

    // Tests
    const tests = b.addTest(.{
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
    });
    tests.linkLibC();
    const test_step = b.step("test", "Run unit tests");
    test_step.dependOn(&b.addRunArtifact(tests).step);
}
