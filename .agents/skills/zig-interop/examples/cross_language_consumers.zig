//! Cross-language binding generation via comptime reflection.
//!
//! Demonstrates TigerBeetle's pattern of walking Zig type definitions at comptime
//! to emit source code for foreign languages (C, Go, Rust). The Zig types are the
//! single source of truth — bindings for each target language are derived, never
//! hand-maintained.
//!
//! See: https://github.com/tigerbeetle/tigerbeetle (rust_bindings.zig, go_bindings.zig)

const std = @import("std");

/// Operation status codes returned by the storage engine.
pub const Status = enum(u8) {
    ok = 0,
    exists = 1,
    not_found = 2,
    invalid = 3,
};

/// An account record with a 128-bit identifier.
/// Uses extern layout for C ABI compatibility across all target languages.
pub const Account = extern struct {
    /// Unique account identifier. Represented as [16]u8 across the ABI boundary
    /// because most calling conventions cannot pass u128 in registers.
    id: u128,
    /// Ledger this account belongs to.
    ledger: u32,
    /// Application-defined account type code.
    code: u16,
    /// Bitfield of boolean flags.
    flags: u16,
    /// Current balance in the account's native unit.
    balance: u64,
};

/// Look up an account by its 128-bit id, passed as a byte array for ABI safety.
export fn account_lookup(id_bytes: *const [16]u8) ?*const Account {
    _ = id_bytes;
    return null; // Stub -- real implementation indexes into storage.
}

/// Return the balance field from an account.
export fn account_balance(account: *const Account) u64 {
    return account.balance;
}

/// Maps Zig primitive types to their representation in a target language.
fn resolve_foreign_type(comptime lang: Language, comptime T: type) []const u8 {
    // u128 is not passable in registers on most ABIs -- project as a byte array.
    // C uses a typedef (tb_uint128_t) because C arrays can't appear as struct
    // field types in the `type name;` position -- TigerBeetle does the same.
    if (T == u128) return switch (lang) {
        .c => "tb_uint128_t",
        .go => "[16]byte",
        .rust => "[u8; 16]",
    };
    if (T == u64) return switch (lang) { .c => "uint64_t", .go => "uint64", .rust => "u64" };
    if (T == u32) return switch (lang) { .c => "uint32_t", .go => "uint32", .rust => "u32" };
    if (T == u16) return switch (lang) { .c => "uint16_t", .go => "uint16", .rust => "u16" };
    if (T == u8) return switch (lang) { .c => "uint8_t", .go => "uint8", .rust => "u8" };
    if (T == i64) return switch (lang) { .c => "int64_t", .go => "int64", .rust => "i64" };

    if (@typeInfo(T) == .@"enum") {
        return resolve_foreign_type(lang, @typeInfo(T).@"enum".tag_type);
    }

    @compileError("unmapped type: " ++ @typeName(T));
}

const Language = enum { c, go, rust };

/// Extract the short name from a fully-qualified @typeName (e.g., "mod.Foo" -> "Foo").
fn shortName(comptime full: [:0]const u8) [:0]const u8 {
    const idx = comptime std.mem.lastIndexOfScalar(u8, full, '.') orelse return full;
    return full[idx + 1 ..];
}

/// Emit a foreign struct definition by walking @typeInfo fields.
fn emit_struct(comptime lang: Language, comptime T: type, writer: anytype) !void {
    const name = comptime shortName(@typeName(T));
    switch (lang) {
        .c => {
            try writer.print("typedef struct {s} {{\n", .{name});
            for (@typeInfo(T).@"struct".fields) |field| {
                const ft = resolve_foreign_type(lang, field.type);
                try writer.print("    {s} {s};\n", .{ ft, field.name });
            }
            try writer.print("}} {s};\n\n", .{name});
        },
        .go => {
            try writer.print("type {s} struct {{\n", .{name});
            for (@typeInfo(T).@"struct".fields) |field| {
                const first: [1]u8 = .{std.ascii.toUpper(field.name[0])};
                try writer.print("    {s}{s} {s}\n", .{ &first, field.name[1..], resolve_foreign_type(lang, field.type) });
            }
            try writer.writeAll("}\n\n");
        },
        .rust => {
            try writer.writeAll("#[repr(C)]\n#[derive(Debug, Copy, Clone)]\n");
            try writer.print("pub struct {s} {{\n", .{name});
            for (@typeInfo(T).@"struct".fields) |field| {
                try writer.print("    pub {s}: {s},\n", .{ field.name, resolve_foreign_type(lang, field.type) });
            }
            try writer.writeAll("}\n\n");
        },
    }
}

/// Emit a foreign enum definition by walking @typeInfo enum fields.
fn emit_enum(comptime lang: Language, comptime T: type, writer: anytype) !void {
    const info = @typeInfo(T).@"enum";
    const name = comptime shortName(@typeName(T));
    const backing = resolve_foreign_type(lang, info.tag_type);

    switch (lang) {
        .c => {
            try writer.print("typedef enum {s} {{\n", .{name});
            for (info.fields) |field| {
                try writer.print("    {s}_{s} = {d},\n", .{ name, field.name, field.value });
            }
            try writer.print("}} {s};\n\n", .{name});
        },
        .go => {
            try writer.print("type {s} {s}\n\nconst (\n", .{ name, backing });
            for (info.fields) |field| {
                const first: [1]u8 = .{std.ascii.toUpper(field.name[0])};
                try writer.print("    {s}{s}{s} {s} = {d}\n", .{ name, &first, field.name[1..], name, field.value });
            }
            try writer.writeAll(")\n\n");
        },
        .rust => {
            try writer.writeAll("#[repr(" ++ backing ++ ")]\n#[derive(Debug, Copy, Clone, PartialEq, Eq)]\n");
            try writer.print("pub enum {s} {{\n", .{name});
            for (info.fields) |field| {
                const first: [1]u8 = .{std.ascii.toUpper(field.name[0])};
                try writer.print("    {s}{s} = {d},\n", .{ &first, field.name[1..], field.value });
            }
            try writer.writeAll("}\n\n");
        },
    }
}

fn generateLen(comptime lang: Language) usize {
    comptime {
        var buf: [4096]u8 = undefined;
        var stream = std.io.fixedBufferStream(&buf);
        const writer = stream.writer();
        emit_enum(lang, Status, writer) catch unreachable;
        emit_struct(lang, Account, writer) catch unreachable;
        return stream.getWritten().len;
    }
}

fn generate(comptime lang: Language) *const [generateLen(lang)]u8 {
    const len = comptime generateLen(lang);
    // Two-pass: first pass computes length, second copies by value via `.*`
    // to avoid returning a reference to comptime-local memory.
    const result = comptime blk: {
        var buf: [4096]u8 = undefined;
        var stream = std.io.fixedBufferStream(&buf);
        const writer = stream.writer();
        emit_enum(lang, Status, writer) catch unreachable;
        emit_struct(lang, Account, writer) catch unreachable;
        break :blk stream.getWritten()[0..len].*;
    };
    return &result;
}

test "rust bindings contain repr(C) struct" {
    const output = generate(.rust);
    try std.testing.expect(std.mem.indexOf(u8, output, "#[repr(C)]") != null);
    try std.testing.expect(std.mem.indexOf(u8, output, "pub struct Account") != null);
    try std.testing.expect(std.mem.indexOf(u8, output, "pub id: [u8; 16]") != null);
}

test "go bindings contain struct with exported fields" {
    const output = generate(.go);
    try std.testing.expect(std.mem.indexOf(u8, output, "type Account struct") != null);
    try std.testing.expect(std.mem.indexOf(u8, output, "Id [16]byte") != null);
    try std.testing.expect(std.mem.indexOf(u8, output, "Balance uint64") != null);
}

test "c bindings contain typedef struct" {
    const output = generate(.c);
    try std.testing.expect(std.mem.indexOf(u8, output, "typedef struct Account") != null);
    try std.testing.expect(std.mem.indexOf(u8, output, "tb_uint128_t id") != null);
    try std.testing.expect(std.mem.indexOf(u8, output, "uint64_t balance") != null);
}

test "enum generation includes all variants" {
    const rust_output = generate(.rust);
    try std.testing.expect(std.mem.indexOf(u8, rust_output, "Ok = 0") != null);
    try std.testing.expect(std.mem.indexOf(u8, rust_output, "Not_found = 2") != null);

    const go_output = generate(.go);
    try std.testing.expect(std.mem.indexOf(u8, go_output, "StatusOk Status = 0") != null);
}

test "u128 maps to byte array in all languages" {
    try std.testing.expectEqualStrings("[u8; 16]", resolve_foreign_type(.rust, u128));
    try std.testing.expectEqualStrings("[16]byte", resolve_foreign_type(.go, u128));
    try std.testing.expectEqualStrings("tb_uint128_t", resolve_foreign_type(.c, u128));
}
