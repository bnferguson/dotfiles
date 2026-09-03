//! Cross-language ABI patterns from Ghostty's C API layer.
//!
//! 1. Options extern struct — callconv(.c) function pointers + ?*anyopaque.
//! 2. Platform variant — extern union for NSView/UIView/GtkWidget.
//! 3. zig-objc msgSend — comptime function type synthesis via @Type.
//! 4. Callback registration and context pointer round-trip.

const std = @import("std");
const builtin = @import("builtin");
const CallingConvention = std.builtin.CallingConvention;

// --- Pattern 1: Options extern struct (Ghostty's apprt config) --------------

pub const SurfaceOptions = extern struct {
    render_cb: ?*const fn (?*anyopaque) callconv(.c) void = null,
    resize_cb: ?*const fn (u32, u32, ?*anyopaque) callconv(.c) void = null,
    userdata: ?*anyopaque = null,
    width: u32 = 800,
    height: u32 = 600,
    scale_factor: f64 = 1.0,
};

pub fn processFrame(opts: *const SurfaceOptions) void {
    if (opts.render_cb) |cb| cb(opts.userdata);
}

// --- Pattern 2: Platform variant (extern union) -----------------------------

pub const PlatformTag = enum(c_int) { macos = 0, ios = 1, gtk = 2 };

pub const NativeView = extern struct {
    tag: PlatformTag,
    view: extern union {
        ns_view: ?*anyopaque,
        ui_view: ?*anyopaque,
        gtk_widget: ?*anyopaque,
    },
};

pub fn nativeTagForTarget() PlatformTag {
    return switch (builtin.os.tag) {
        .macos => .macos,
        .ios => .ios,
        .linux => .gtk,
        else => .macos,
    };
}

// --- Pattern 3: zig-objc msgSend type synthesis -----------------------------

pub fn MsgSendFn(comptime Return: type, comptime Args: []const type) type {
    var params: [Args.len + 2]std.builtin.Type.Fn.Param = undefined;
    // Every objc_msgSend starts with (id, SEL)
    params[0] = .{ .is_generic = false, .is_noalias = false, .type = ?*anyopaque };
    params[1] = .{ .is_generic = false, .is_noalias = false, .type = ?*anyopaque };
    for (Args, 0..) |A, i| {
        params[i + 2] = .{ .is_generic = false, .is_noalias = false, .type = A };
    }
    return @Type(.{ .@"fn" = .{
        .calling_convention = CallingConvention.c,
        .is_generic = false,
        .is_var_args = false,
        .return_type = Return,
        .params = params[0 .. Args.len + 2],
    } });
}

// x86_64 uses _stret for large struct returns; aarch64 uses base msgSend.
pub fn msgSendVariant(comptime Return: type) [:0]const u8 {
    if (builtin.cpu.arch == .x86_64) {
        if (@typeInfo(Return) == .@"struct" and @sizeOf(Return) > 16) return "objc_msgSend_stret";
        if (Return == f64 or Return == f80) return "objc_msgSend_fpret";
    }
    return "objc_msgSend";
}

// --- Pattern 4: Callback registration with context round-trip ---------------

pub const Renderer = struct {
    frame_count: u64 = 0,

    pub fn asOptions(self: *Renderer) SurfaceOptions {
        return .{ .render_cb = &renderCb, .userdata = @ptrCast(self) };
    }
};

fn renderCb(userdata: ?*anyopaque) callconv(.c) void {
    const self: *Renderer = @ptrCast(@alignCast(userdata));
    self.frame_count += 1;
}

// --- Tests ------------------------------------------------------------------

test "callback round-trip through SurfaceOptions" {
    var r = Renderer{};
    const opts = r.asOptions();
    processFrame(&opts);
    processFrame(&opts);
    try std.testing.expectEqual(@as(u64, 2), r.frame_count);
}

test "MsgSendFn synthesizes correct param count" {
    const Fn = MsgSendFn(void, &.{u32});
    const info = @typeInfo(Fn).@"fn";
    try std.testing.expectEqual(@as(usize, 3), info.params.len);
    try std.testing.expectEqual(CallingConvention.c, info.calling_convention);
}

test "NativeView platform tag is valid" {
    _ = @intFromEnum(nativeTagForTarget());
}

test "SurfaceOptions has C-compatible layout" {
    try std.testing.expect(@sizeOf(SurfaceOptions) > 0);
    try std.testing.expect(@alignOf(SurfaceOptions) <= 8);
}
