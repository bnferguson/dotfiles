//! Build template for compiling C sources alongside Zig (0.15+ API).
//!
//! Patterns from real projects:
//! 1. System vs vendored build (Ghostty's pkg/ pattern).
//! 2. addCSourceFiles with flags (ziglua).
//! 3. addTranslateC for C header -> Zig module (ziglua).
//! 4. Build-time code generation exe (vulkan-zig).
//! 5. Framework linking + conditional OS checks (Ghostty).
//! 6. Dual static/dynamic library output (libxev).
//!
//! 0.15 API changes from 0.14:
//! - addExecutable/addTest/addLibrary take .root_module (not .root_source_file)
//! - addCSourceFiles, addIncludePath, linkSystemLibrary, linkFramework are on Module
//! - addStaticLibrary/addSharedLibrary merged into addLibrary with .linkage field
//! - Module is created separately via b.createModule()

const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // Pattern 1: system vs vendored, selected by build option
    const use_system = b.option(bool, "system-freetype", "Use system FreeType") orelse false;

    const exe_mod = b.createModule(.{
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });

    if (use_system) {
        exe_mod.linkSystemLibrary("freetype2", .{});
    } else {
        // Pattern 2: addCSourceFiles with version-specific flags
        exe_mod.addCSourceFiles(.{
            .root = b.path(""),
            .files = &.{
                "vendor/freetype/src/base/ftbase.c",
                "vendor/freetype/src/base/ftsystem.c",
                "vendor/freetype/src/truetype/truetype.c",
            },
            .flags = &.{ "-DFT2_BUILD_LIBRARY", "-std=c99", "-fno-sanitize=undefined" },
        });
        exe_mod.addIncludePath(b.path("vendor/freetype/include"));
    }

    // Ghostty's ext.c workaround for constructs translate-c can't handle
    exe_mod.addCSourceFile(.{ .file = b.path("src/ext.c"), .flags = &.{"-std=c11"} });

    // Pattern 3: addTranslateC — expose C types as `@import("lua")`
    const translate_c = b.addTranslateC(.{
        .root_source_file = b.path("vendor/lua/lua.h"),
        .target = target,
        .optimize = optimize,
    });
    translate_c.addIncludePath(b.path("vendor/lua"));
    exe_mod.addImport("lua", translate_c.createModule());

    // Pattern 4: build-time code generation (vulkan-zig)
    const gen_mod = b.createModule(.{
        .root_source_file = b.path("tools/gen_bindings.zig"),
        .target = b.graph.host,
    });
    const generator = b.addExecutable(.{
        .name = "generate-bindings",
        .root_module = gen_mod,
    });
    const gen_step = b.addRunArtifact(generator);
    gen_step.addArg("--spec");
    gen_step.addFileArg(b.path("spec/api.xml"));
    const gen_output = gen_step.addOutputFileArg("bindings.zig");
    exe_mod.addAnonymousImport("bindings", .{ .root_source_file = gen_output });

    // Pattern 5: OS-conditional framework/library linking
    switch (target.result.os.tag) {
        .macos => {
            exe_mod.linkFramework("CoreText", .{});
            exe_mod.linkFramework("CoreFoundation", .{});
        },
        .linux => exe_mod.linkSystemLibrary("fontconfig", .{}),
        else => {},
    }
    const exe = b.addExecutable(.{ .name = "myapp", .root_module = exe_mod });
    b.installArtifact(exe);

    // Pattern 6: dual static/dynamic library (libxev)
    // In 0.15+, addStaticLibrary/addSharedLibrary merged into addLibrary
    inline for ([_]std.builtin.LinkMode{ .static, .dynamic }) |linkage| {
        const lib_mod = b.createModule(.{
            .root_source_file = b.path("src/lib.zig"),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        });
        const lib = b.addLibrary(.{
            .name = "mylib",
            .root_module = lib_mod,
            .linkage = linkage,
        });
        b.installArtifact(lib);
    }

    // Tests
    const test_mod = b.createModule(.{
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const tests = b.addTest(.{ .root_module = test_mod });
    const test_step = b.step("test", "Run unit tests");
    test_step.dependOn(&b.addRunArtifact(tests).step);
}
