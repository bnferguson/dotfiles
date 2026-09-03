//! @cImport wrapping patterns from Ghostty.
//!
//! 1. Dedicated c.zig module — isolates all C symbols to one @cImport block.
//! 2. Opaque type wrapping (CoreText Font) — methods delegate to C functions.
//! 3. Struct-with-handle (FreeType Face) — Zig struct owns the C handle.
//!
//! Alternative: Bun pre-translates complex C++ headers into Zig files,
//! avoiding translate-c limitations with templates and overloaded functions.

const std = @import("std");

// --- Pattern 1: Dedicated @cImport module (the c.zig pattern) ---------------
// In Ghostty this lives in its own file: `const c = @import("c.zig");`

const c = @cImport({
    @cInclude("freetype-zig.h");
});

const FT_Library = c.FT_Library;
const FT_Face = c.FT_Face;
const FT_Error = c.FT_Error;

// --- Pattern 2: Opaque type wrapping (CoreText Font style) ------------------

pub const Font = opaque {
    extern fn CTFontCreateWithName(name: c.CFStringRef, size: f64, matrix: ?*const c.CGAffineTransform) ?*Font;
    extern fn CTFontGetSize(font: *Font) f64;
    extern fn CFRelease(cf: *anyopaque) void;

    pub fn createWithName(name: c.CFStringRef, size: f64) ?*Font {
        return CTFontCreateWithName(name, size, null);
    }

    pub fn getSize(self: *Font) f64 {
        return CTFontGetSize(self);
    }

    pub fn release(self: *Font) void {
        CFRelease(@ptrCast(self));
    }
};

// --- Pattern 3: Struct-with-handle (FreeType Face style) --------------------
// Owns the C handle, converts sentinel pointers at the boundary.

pub const Face = struct {
    handle: FT_Face,
    library: FT_Library,

    pub fn init(library: FT_Library, path: [:0]const u8) !Face {
        var face: FT_Face = undefined;
        const err = c.FT_New_Face(library, path.ptr, 0, &face);
        if (err != 0) return error.FreetypeError;
        return .{ .handle = face, .library = library };
    }

    pub fn deinit(self: Face) void {
        _ = c.FT_Done_Face(self.handle);
    }

    pub fn setCharSize(self: Face, width: i32, height: i32, h_dpi: u32, v_dpi: u32) !void {
        const err = c.FT_Set_Char_Size(self.handle, width, height, h_dpi, v_dpi);
        if (err != 0) return error.FreetypeError;
    }

    /// Returns family name as a Zig slice. Valid until deinit.
    pub fn familyName(self: Face) ?[]const u8 {
        const raw: ?[*:0]const u8 = @ptrCast(self.handle.*.family_name);
        return if (raw) |ptr| std.mem.span(ptr) else null;
    }
};

// --- Tests ------------------------------------------------------------------

test "opaque type pointer size matches anyopaque" {
    try std.testing.expect(@sizeOf(*Font) == @sizeOf(*anyopaque));
}

test "sentinel-terminated path has null byte" {
    const path: [:0]const u8 = "/usr/share/fonts/DejaVuSans.ttf";
    try std.testing.expect(path[path.len] == 0);
}

test "c type aliases match expected sizes" {
    try std.testing.expect(@sizeOf(FT_Error) == @sizeOf(c_int));
}
