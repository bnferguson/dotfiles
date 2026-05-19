//! Zig-side patterns for binding C++ through a C shim, inspired by Bun.
//!
//! 1. Opaque types with extern fn methods (JSGlobalObject pattern).
//! 2. Value type as enum(i64) — ABI-compatible with JSC's EncodedJSValue.
//! 3. Errorable(T) — ABI-safe tagged union for cross-boundary error propagation.
//! 4. Exception scope — init/check/deinit lifecycle.
//!
//! Alternative: Lightpanda uses a flat C API (V8 fork) instead of C++ shims.

const std = @import("std");

// --- Pattern 1: Opaque type with extern fn methods --------------------------

pub const JSGlobalObject = opaque {
    extern fn JSGlobalObject__throwOutOfMemoryError(this: *JSGlobalObject) void;
    extern fn JSGlobalObject__createError(this: *JSGlobalObject, msg: JSValue) JSValue;

    pub fn throwOutOfMemoryError(this: *JSGlobalObject) void {
        JSGlobalObject__throwOutOfMemoryError(this);
    }

    pub fn createError(this: *JSGlobalObject, msg: JSValue) JSValue {
        return JSGlobalObject__createError(this, msg);
    }
};

// --- Pattern 2: Value type as enum(i64) (NaN-boxed JSValue) -----------------

pub const JSValue = enum(i64) {
    zero = 0,
    undefined = 0x0a,
    null_value = 0x02,
    true_value = (0x06 | 0x01) + (1 << 49),
    false_value = 0x06,
    _,

    pub fn isUndefined(this: JSValue) bool { return this == .undefined; }
    pub fn isNull(this: JSValue) bool { return this == .null_value; }
    pub fn fromRaw(raw: i64) JSValue { return @enumFromInt(raw); }
    pub fn toRaw(this: JSValue) i64 { return @intFromEnum(this); }
};

// --- Pattern 3: Errorable(T) — ABI-safe tagged union -----------------------

pub fn Errorable(comptime Type: type) type {
    return extern struct {
        result: Result,
        success: bool,

        pub const Result = extern union { value: Type, err: ZigError };

        pub fn ok(value: Type) @This() {
            return .{ .result = .{ .value = value }, .success = true };
        }
        pub fn failure(err: ZigError) @This() {
            return .{ .result = .{ .err = err }, .success = false };
        }
        pub fn unwrap(self: @This()) !Type {
            if (self.success) return self.result.value;
            return error.JsError;
        }
    };
}

pub const ZigError = extern struct {
    code: u32,
    message: ExternString,
};

pub const ExternString = extern struct {
    ptr: ?[*]const u8,
    len: usize,

    pub fn slice(self: ExternString) []const u8 {
        const p = self.ptr orelse return &.{};
        return p[0..self.len];
    }
};

// --- Pattern 4: Exception scope lifecycle -----------------------------------

pub const ExceptionScope = extern struct {
    global: *JSGlobalObject,
    exception: JSValue,

    extern fn ExceptionScope__init(global: *JSGlobalObject) ExceptionScope;
    extern fn ExceptionScope__deinit(scope: *ExceptionScope) void;

    pub fn init(global: *JSGlobalObject) ExceptionScope {
        return ExceptionScope__init(global);
    }
    pub fn deinit(self: *ExceptionScope) void {
        ExceptionScope__deinit(self);
    }
    pub fn hasException(self: ExceptionScope) bool {
        return !self.exception.isUndefined();
    }
};

// --- Tests ------------------------------------------------------------------

test "JSValue enum ABI matches i64" {
    try std.testing.expectEqual(@sizeOf(i64), @sizeOf(JSValue));
    try std.testing.expectEqual(@as(i64, 0x0a), @intFromEnum(JSValue.undefined));
}

test "JSValue round-trip through raw encoding" {
    const val = JSValue.fromRaw(0xDEAD_BEEF);
    try std.testing.expectEqual(@as(i64, 0xDEAD_BEEF), val.toRaw());
}

test "Errorable success and failure paths" {
    const ok = Errorable(u32).ok(42);
    try std.testing.expectEqual(@as(u32, 42), try ok.unwrap());

    const fail = Errorable(u32).failure(.{ .code = 1, .message = .{ .ptr = null, .len = 0 } });
    try std.testing.expectError(error.JsError, fail.unwrap());
}

test "ExternString empty slice on null ptr" {
    const s = ExternString{ .ptr = null, .len = 0 };
    try std.testing.expectEqual(@as(usize, 0), s.slice().len);
}
