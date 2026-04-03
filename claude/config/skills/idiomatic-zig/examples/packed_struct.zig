// Packed struct design for cache-friendly layout.
//
// Pattern from Ghostty: Design hot data structures to fit in cache lines.
// Make the zero value meaningful — zero = empty/default enables trivial
// initialization and clearing via @memset.

const std = @import("std");
const assert = std.debug.assert;

/// A terminal cell packed into a single 64-bit word.
/// Zero value represents an empty cell — no constructor needed.
pub const Cell = packed struct(u64) {
    content_tag: ContentTag = .codepoint,
    content: packed union {
        codepoint: u21,
        run_offset: u21,
    } = .{ .codepoint = 0 },
    style_id: u16 = 0,
    wide: Wide = .narrow,
    protected: bool = false,
    hyperlink: bool = false,
    _padding: u18 = 0,

    const ContentTag = enum(u2) { codepoint, run };
    const Wide = enum(u2) { narrow, wide, spacer_head, spacer_tail };

    /// C ABI compatibility — cast to/from u64.
    pub const C = u64;
    pub fn cval(self: Cell) C {
        return @bitCast(self);
    }
};

/// A row with metadata flags for fast-path decisions.
/// Flags track whether any cell in the row has managed resources,
/// avoiding per-cell checks on the common (plain text) path.
pub const Row = packed struct(u64) {
    styled: bool = false,
    grapheme: bool = false,
    hyperlink: bool = false,
    dirty: bool = true,
    _padding: u60 = 0,

    /// True if any cell in this row requires per-cell processing.
    pub inline fn managedMemory(self: Row) bool {
        return self.styled or self.hyperlink or self.grapheme;
    }
};

/// Clear a row of cells efficiently.
/// Uses u64 zeroing because empirically it's faster than byte-level.
pub fn clearCells(cells: []Cell) void {
    // Zero = empty cell by design, so @memset to zero clears everything.
    @memset(@as([]u64, @ptrCast(cells)), 0);
}

/// Copy cells, choosing fast or slow path based on row metadata.
pub fn copyCells(dst_row: *Row, dst: []Cell, src_row: Row, src: []const Cell) void {
    if (!src_row.managedMemory()) {
        // Fast path: bulk copy, no per-cell processing needed.
        @memcpy(dst, src);
    } else {
        // Slow path: handle graphemes, hyperlinks, styles per-cell.
        for (src, dst) |s, *d| {
            d.* = s;
            if (s.hyperlink) {
                // Increment hyperlink reference count, etc.
            }
        }
    }
    dst_row.* = src_row;
}

comptime {
    assert(@sizeOf(Cell) == 8);
    assert(@sizeOf(Row) == 8);
}

test "zero cell is empty" {
    const cell: Cell = @bitCast(@as(u64, 0));
    try std.testing.expectEqual(.narrow, cell.wide);
    try std.testing.expectEqual(false, cell.protected);
    try std.testing.expectEqual(false, cell.hyperlink);
    try std.testing.expectEqual(@as(u21, 0), cell.content.codepoint);
}

test "clearCells produces empty cells" {
    var cells: [10]Cell = undefined;
    for (&cells) |*c| c.* = .{ .content = .{ .codepoint = 'A' }, .style_id = 42 };

    clearCells(&cells);

    for (cells) |c| {
        try std.testing.expectEqual(@as(u64, 0), @as(u64, @bitCast(c)));
    }
}
