// Cross-Version Adaptive Build.zig Template
//
// This build.zig works across multiple Zig versions (0.11+) by detecting
// features at compile time rather than checking version numbers.
//
// Supported Versions: Zig 0.11.0 through 0.16.0+
// Not Supported: Zig 0.10.x and earlier (completely different build API)
//
// Key Features:
// - Uses feature detection (@hasDecl) instead of version checks
// - Gracefully handles API differences between versions
// - Provides clear error messages for unsupported versions
//
// Usage:
//   1. Copy this file to your project as build.zig
//   2. Customize the project name, source paths, and dependencies
//   3. Build with: zig build
//
// For version-specific code, see references/version-differences.md

const std = @import("std");
const builtin = @import("builtin");

// Detect if we're using the modern build API (0.11+)
const has_modern_build_api = @hasDecl(std, "Build");

// Ensure we're on a supported version
comptime {
    if (!has_modern_build_api) {
        @compileError(
            \\This build.zig requires Zig 0.11.0 or later.
            \\
            \\You are using Zig with the legacy build API (0.10.x or earlier).
            \\Please upgrade to Zig 0.11+ or use a legacy build.zig template.
            \\
            \\Download Zig: https://ziglang.org/download/
        );
    }
}

// Modern build API (0.11+)
pub fn build(b: *std.Build) void {
    // Get version info for debugging
    const version = builtin.zig_version;
    if (b.verbose) {
        std.debug.print("Building with Zig {}.{}.{}\n", .{
            version.major,
            version.minor,
            version.patch,
        });
    }

    // Standard target and optimization options
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // === CUSTOMIZE PROJECT SETTINGS BELOW ===

    // Project configuration
    const project_name = "myapp";
    const root_source = "src/main.zig";

    // 0.15 moved the source, target and optimize options off the artifact
    // and onto a module (0.14 added `root_module`, 0.15 removed the old
    // fields). Detect which shape this compiler wants.
    const takes_module = @hasField(std.Build.ExecutableOptions, "root_module");

    // Build executable
    const exe = if (takes_module) b.addExecutable(.{
        .name = project_name,
        .root_module = b.createModule(.{
            .root_source_file = b.path(root_source),
            .target = target,
            .optimize = optimize,
        }),
    }) else b.addExecutable(.{
        .name = project_name,
        .root_source_file = b.path(root_source),
        .target = target,
        .optimize = optimize,
    });

    // === OPTIONAL: Add dependencies ===
    //
    // Example: Add a local dependency. Since 0.15 addStaticLibrary is gone and
    // the linking options live on the module:
    // const my_lib = b.addLibrary(.{
    //     .name = "mylib",
    //     .linkage = .static,
    //     .root_module = b.createModule(.{
    //         .root_source_file = b.path("lib/mylib.zig"),
    //         .target = target,
    //         .optimize = optimize,
    //     }),
    // });
    // exe.root_module.linkLibrary(my_lib);
    //
    // Example: Link system libraries
    // exe.root_module.link_libc = true;
    // exe.root_module.linkSystemLibrary("sqlite3", .{});
    //
    // Example: Add module (0.16 spelling)
    // const my_module = b.addModule("mymod", .{
    //     .root_source_file = b.path("modules/mymod.zig"),
    // });
    // exe.root_module.addImport("mymod", my_module);

    // Install the executable
    b.installArtifact(exe);

    // === RUN COMMAND ===
    // Create "zig build run" command
    const run_cmd = b.addRunArtifact(exe);

    // Ensure exe is installed before running
    run_cmd.step.dependOn(b.getInstallStep());

    // Forward arguments to the executable
    if (b.args) |args| {
        run_cmd.addArgs(args);
    }

    const run_step = b.step("run", "Run the application");
    run_step.dependOn(&run_cmd.step);

    // === TEST COMMAND ===
    // Create "zig build test" command
    const tests = if (takes_module) b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path(root_source),
            .target = target,
            .optimize = optimize,
        }),
    }) else b.addTest(.{
        .root_source_file = b.path(root_source),
        .target = target,
        .optimize = optimize,
    });

    // Add the same dependencies to tests
    // (Copy any linkLibrary or addModule calls from above)

    const run_tests = b.addRunArtifact(tests);
    const test_step = b.step("test", "Run unit tests");
    test_step.dependOn(&run_tests.step);

    // === VERSION-SPECIFIC FEATURES ===
    //
    // Example: Detect and use version-specific features
    //
    // // Check if new for-loop syntax is available (0.13+)
    // const has_modern_for_loops = (version.minor >= 13);
    //
    // // Check for specific stdlib features
    // const has_http_client = @hasDecl(std, "http") and @hasDecl(std.http, "Client");
    //
    // // Conditionally enable features
    // const options = b.addOptions();
    // options.addOption(bool, "has_modern_for_loops", has_modern_for_loops);
    // options.addOption(bool, "has_http_client", has_http_client);
    // exe.root_module.addOptions("build_options", options);
    //
    // Then in your code:
    // const build_options = @import("build_options");
    // if (build_options.has_http_client) {
    //     // Use std.http.Client
    // }

    // === ADDITIONAL BUILD STEPS ===
    //
    // Example: Custom build step
    // const custom_step = b.step("custom", "Run custom build action");
    // const custom_cmd = b.addSystemCommand(&[_][]const u8{"echo", "Custom build!"});
    // custom_step.dependOn(&custom_cmd.step);
    //
    // Example: Generate documentation. `getEmittedDocs` returns a LazyPath,
    // not a step, so install it rather than depending on it.
    // const docs_step = b.step("docs", "Generate documentation");
    // docs_step.dependOn(&b.addInstallDirectory(.{
    //     .source_dir = exe.getEmittedDocs(),
    //     .install_dir = .prefix,
    //     .install_subdir = "docs",
    // }).step);
}

// === CROSS-VERSION COMPATIBILITY NOTES ===
//
// This build.zig uses feature detection to work across versions:
//
// 1. Feature Detection (Recommended):
//    - Use @hasDecl(std, "Build") to detect modern API
//    - Use builtin.zig_version for version-specific logic
//    - Prefer feature checks over version number comparisons
//
// 2. API Stability:
//    - The core build API (0.11+) is relatively stable
//    - addExecutable, addTest, addRunArtifact exist across 0.11-0.16, but
//      their options struct changed shape in 0.15 (see below)
//    - b.path() is required for file paths in 0.11+
//
// 3. Version-Specific Considerations:
//    - 0.11-0.12: Initial modern build API
//    - 0.13+: For-loop syntax changed (doesn't affect build.zig)
//    - 0.14: `root_module` added to ExecutableOptions and friends; the loose
//      root_source_file/target/optimize fields deprecated
//    - 0.15: those deprecated fields removed, so `root_module` is mandatory.
//      addStaticLibrary/addSharedLibrary replaced by addLibrary(.{ .linkage })
//    - 0.16: link options moved from Step.Compile onto Module, so it is
//      exe.root_module.linkSystemLibrary / .addImport / .addOptions
//
// 4. Breaking Changes to Watch:
//    - Package/module system APIs (evolving)
//    - Standard library reorganizations
//    - Build options and configuration
//
// For detailed migration guides between versions:
// See skill/references/version-differences.md
//
// For more cross-version patterns:
// See skill/references/latest/patterns-integration.md

// === TESTING THIS BUILD FILE ===
//
// Test across versions (if you have multiple Zig installations):
//
//   # Test with specific version
//   zig-0.11.0 build
//   zig-0.13.0 build
//   zig-0.15.2 build
//
// Common issues:
//
// 1. "error: no member named 'path'" → Using 0.10.x or earlier
//    Solution: Upgrade to Zig 0.11+
//
// 2. "error: expected type '*std.Build', found '*std.build.Builder'"
//    Solution: This build.zig requires 0.11+, you're using 0.10.x
//
// 3. Module/package system errors → Check Zig version and docs
//    Solution: Package system APIs evolved between 0.11-0.16
//
// For troubleshooting build errors:
//   1. Run: zig build --verbose
//   2. Check: zig version
//   3. Read: references/version-differences.md
//   4. Compare: Your code against templates in assets/templates/
