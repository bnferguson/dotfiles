//! Comptime FFI patterns from zig-objc, ziglua, and Lightpanda.
//!
//! 1. Function type synthesis via @Type (zig-objc msgSend).
//! 2. @typeInfo struct field walking (ziglua's define.zig).
//! 3. Comptime version dispatch (ziglua Lua 5.3/5.4/LuaJIT).
//! 4. Comptime bridge builder (Lightpanda Zig-to-JS type mapping).

const std = @import("std");
const builtin = @import("builtin");
const CallingConvention = std.builtin.CallingConvention;

// --- Pattern 1: Function type synthesis (zig-objc's msgSend) ----------------
pub fn ObjcSendFn(comptime Return: type, comptime ArgTypes: []const type) type {
    var params: [ArgTypes.len + 2]std.builtin.Type.Fn.Param = undefined;
    params[0] = .{ .is_generic = false, .is_noalias = false, .type = *anyopaque }; // id
    params[1] = .{ .is_generic = false, .is_noalias = false, .type = *anyopaque }; // SEL
    for (ArgTypes, 0..) |T, i| {
        params[i + 2] = .{ .is_generic = false, .is_noalias = false, .type = T };
    }
    return @Type(.{ .@"fn" = .{
        .calling_convention = CallingConvention.c,
        .is_generic = false,
        .is_var_args = false,
        .return_type = Return,
        .params = params[0 .. ArgTypes.len + 2],
    } });
}

// x86_64: _stret for large structs, _fpret for floating point.
// aarch64: base msgSend handles everything.
pub fn msgSendVariant(comptime Return: type) [:0]const u8 {
    if (builtin.cpu.arch == .x86_64) {
        if (@typeInfo(Return) == .@"struct" and @sizeOf(Return) > 16) return "objc_msgSend_stret";
        if (Return == f64 or Return == f80) return "objc_msgSend_fpret";
    }
    return "objc_msgSend";
}

// --- Pattern 2: @typeInfo struct field walking (ziglua) ---------------------
pub fn FieldMeta(comptime T: type) type {
    const fields = std.meta.fields(T);
    return struct {
        pub const count = fields.len;
        pub const entries = blk: {
            var result: [fields.len]struct { name: [:0]const u8, offset: usize, size: usize } = undefined;
            for (fields, 0..) |f, i| {
                result[i] = .{ .name = f.name, .offset = @offsetOf(T, f.name), .size = @sizeOf(f.type) };
            }
            break :blk result;
        };
    };
}

// --- Pattern 3: Comptime version dispatch (ziglua) --------------------------

pub const LuaVersion = enum { lua53, lua54, luajit };

pub fn LuaState(comptime version: LuaVersion) type {
    return struct {
        handle: *anyopaque,

        pub fn pushInteger(_: @This(), _: i64) void {}

        // lua_isinteger: 5.3+, not LuaJIT
        pub const isInteger = switch (version) {
            .lua53, .lua54 => struct {
                pub fn call(_: @This(), _: i32) bool { return true; }
            }.call,
            .luajit => struct {
                pub fn call(_: @This(), _: i32) bool { return false; }
            }.call,
        };

        // lua_warning: 5.4+ only.
        // usingnamespace was removed in 0.14+; use a comptime bool flag instead.
        pub const has_warning = version == .lua54;
        pub fn warning(_: @This(), _: [:0]const u8) void {
            comptime std.debug.assert(version == .lua54);
        }
    };
}

// --- Pattern 4: Comptime bridge builder (Lightpanda) ------------------------
pub fn JsBridge(comptime T: type) type {
    const fields = std.meta.fields(T);
    return struct {
        pub const property_count = fields.len;

        pub fn getProperty(obj: *T, name: []const u8) ?i64 {
            inline for (fields) |f| {
                if (std.mem.eql(u8, name, f.name)) {
                    const val = @field(obj, f.name);
                    return switch (@typeInfo(f.type)) {
                        .int => @intCast(val),
                        .bool => if (val) @as(i64, 1) else 0,
                        else => null,
                    };
                }
            }
            return null;
        }
    };
}

// --- Tests ------------------------------------------------------------------

const TestPoint = extern struct { x: i32, y: i32, z: i32 };
const Widget = struct { width: u32, height: u32, visible: bool };

test "ObjcSendFn synthesizes correct signature" {
    const info = @typeInfo(ObjcSendFn(void, &.{ u32, bool })).@"fn";
    try std.testing.expectEqual(@as(usize, 4), info.params.len);
    try std.testing.expectEqual(CallingConvention.c, info.calling_convention);
}

test "msgSendVariant selects base for void return" {
    try std.testing.expectEqualStrings("objc_msgSend", msgSendVariant(void));
}

test "FieldMeta walks struct fields" {
    const meta = FieldMeta(TestPoint);
    try std.testing.expectEqual(@as(usize, 3), meta.count);
    try std.testing.expectEqualStrings("x", meta.entries[0].name);
    try std.testing.expectEqual(@as(usize, 0), meta.entries[0].offset);
}

test "LuaVersion dispatch selects correct API" {
    try std.testing.expect(LuaState(.lua54).has_warning);
    try std.testing.expect(LuaState(.luajit).has_warning == false);
}

test "JsBridge reflects struct properties" {
    var w = Widget{ .width = 100, .height = 200, .visible = true };
    const Bridge = JsBridge(Widget);
    try std.testing.expectEqual(@as(i64, 100), Bridge.getProperty(&w, "width").?);
    try std.testing.expect(Bridge.getProperty(&w, "nonexistent") == null);
}
