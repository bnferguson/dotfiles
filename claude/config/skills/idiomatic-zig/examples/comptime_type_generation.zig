// Comptime type generation from data tables.
//
// Pattern from Ghostty: Define data as a table, generate multiple types at comptime.
// This eliminates manual synchronization between related types (enum, packed struct,
// lookup functions) — they're all derived from a single source of truth.

const std = @import("std");
const assert = std.debug.assert;

// -- The data table: single source of truth --

const ModeEntry = struct {
    name: [:0]const u8,
    default: bool,
    ansi_code: u16,
    private: bool = false,
};

const entries = [_]ModeEntry{
    .{ .name = "cursor_visible", .default = true, .ansi_code = 25, .private = true },
    .{ .name = "auto_wrap", .default = true, .ansi_code = 7, .private = true },
    .{ .name = "reverse_video", .default = false, .ansi_code = 5, .private = true },
    .{ .name = "origin_mode", .default = false, .ansi_code = 6, .private = true },
    .{ .name = "insert_mode", .default = false, .ansi_code = 4 },
};

// -- Generated packed struct of booleans --

pub const ModePacked = blk: {
    var fields: [entries.len]std.builtin.Type.StructField = undefined;
    for (entries, 0..) |entry, i| {
        fields[i] = .{
            .name = entry.name,
            .type = bool,
            .default_value_ptr = @ptrCast(&entry.default),
            .is_comptime = false,
            .alignment = 0,
        };
    }
    break :blk @Type(.{ .@"struct" = .{
        .layout = .@"packed",
        .fields = &fields,
        .decls = &.{},
        .is_tuple = false,
    } });
};

// -- Generated enum --

pub const Mode = blk: {
    var fields: [entries.len]std.builtin.Type.EnumField = undefined;
    for (entries, 0..) |entry, i| {
        fields[i] = .{
            .name = entry.name,
            .value = i,
        };
    }
    break :blk @Type(.{ .@"enum" = .{
        .tag_type = u8,
        .fields = &fields,
        .decls = &.{},
        .is_exhaustive = true,
    } });
};

// -- Comptime dispatch via inline else --

pub const ModeState = struct {
    values: ModePacked = .{},

    /// Set a mode by its enum value. `inline else` makes each variant
    /// comptime-known, enabling @field access on the packed struct.
    pub fn set(self: *ModeState, mode: Mode, value: bool) void {
        switch (mode) {
            inline else => |mode_comptime| {
                const name = @tagName(mode_comptime);
                @field(self.values, name) = value;
            },
        }
    }

    pub fn get(self: *const ModeState, mode: Mode) bool {
        return switch (mode) {
            inline else => |mode_comptime| {
                const name = @tagName(mode_comptime);
                return @field(self.values, name);
            },
        };
    }
};

// -- Comptime lookup function --

pub fn ansiCodeForMode(mode: Mode) u16 {
    return switch (mode) {
        inline else => |mode_comptime| {
            const entry = entries[@intFromEnum(mode_comptime)];
            return entry.ansi_code;
        },
    };
}

// -- Tests verify everything stays in sync --

comptime {
    // The packed struct fits in a byte (5 bools).
    assert(@sizeOf(ModePacked) == 1);
}

test "defaults from table" {
    const state = ModeState{};
    // cursor_visible defaults to true (from the table).
    try std.testing.expect(state.get(.cursor_visible));
    // reverse_video defaults to false (from the table).
    try std.testing.expect(!state.get(.reverse_video));
}

test "set and get round-trip" {
    var state = ModeState{};
    state.set(.reverse_video, true);
    try std.testing.expect(state.get(.reverse_video));

    state.set(.reverse_video, false);
    try std.testing.expect(!state.get(.reverse_video));
}

test "ansi codes from table" {
    try std.testing.expectEqual(@as(u16, 25), ansiCodeForMode(.cursor_visible));
    try std.testing.expectEqual(@as(u16, 7), ansiCodeForMode(.auto_wrap));
}
