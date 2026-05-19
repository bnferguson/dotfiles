// Generic data structure via type function — TigerBeetle pattern.
//
// The dominant pattern for reusable data structures in production Zig.
// FooType(comptime args) returns a struct type specialized at compile time.

const std = @import("std");
const assert = std.debug.assert;

/// A sorted array with comptime-specialized key extraction and comparison.
/// Pattern: accept key_from_value and compare as comptime function pointers.
pub fn SortedArrayType(
    comptime Value: type,
    comptime Key: type,
    comptime key_from_value: fn (*const Value) Key,
    comptime compare_keys: fn (Key, Key) std.math.Order,
) type {
    return struct {
        const Self = @This();

        items: []Value,
        len: usize = 0,

        pub fn init(buffer: []Value) Self {
            return .{ .items = buffer };
        }

        /// Binary search for a key. Returns the index if found.
        pub fn find(self: *const Self, key: Key) ?usize {
            if (self.len == 0) return null;

            var lo: usize = 0;
            var hi: usize = self.len;

            while (lo < hi) {
                const mid = lo + (hi - lo) / 2;
                const mid_key = key_from_value(&self.items[mid]);

                switch (compare_keys(mid_key, key)) {
                    .lt => lo = mid + 1,
                    .gt => hi = mid,
                    .eq => return mid,
                }
            }
            return null;
        }

        /// Insert maintaining sorted order.
        pub fn insert(self: *Self, value: Value) !void {
            assert(self.len < self.items.len); // Capacity check.

            const key = key_from_value(&value);

            // Find insertion point.
            var i: usize = self.len;
            while (i > 0) {
                const prev_key = key_from_value(&self.items[i - 1]);
                if (compare_keys(prev_key, key) != .gt) break;
                self.items[i] = self.items[i - 1];
                i -= 1;
            }

            self.items[i] = value;
            self.len += 1;

            // Post-condition: sorted order maintained.
            if (self.len > 1) {
                for (1..self.len) |j| {
                    const a = key_from_value(&self.items[j - 1]);
                    const b = key_from_value(&self.items[j]);
                    assert(compare_keys(a, b) != .gt);
                }
            }
        }
    };
}

// -- Concrete instantiation --

const Transfer = struct {
    id: u64,
    amount: u64,
    timestamp: u64,
};

fn transferId(t: *const Transfer) u64 {
    return t.id;
}

fn compareU64(a: u64, b: u64) std.math.Order {
    return std.math.order(a, b);
}

const TransferArray = SortedArrayType(Transfer, u64, transferId, compareU64);

test "sorted array insert and find" {
    var buffer: [16]Transfer = undefined;
    var arr = TransferArray.init(&buffer);

    try arr.insert(.{ .id = 30, .amount = 100, .timestamp = 1 });
    try arr.insert(.{ .id = 10, .amount = 200, .timestamp = 2 });
    try arr.insert(.{ .id = 20, .amount = 300, .timestamp = 3 });

    // Sorted by id.
    try std.testing.expectEqual(@as(u64, 10), arr.items[0].id);
    try std.testing.expectEqual(@as(u64, 20), arr.items[1].id);
    try std.testing.expectEqual(@as(u64, 30), arr.items[2].id);

    // Find works.
    try std.testing.expectEqual(@as(?usize, 1), arr.find(20));
    try std.testing.expectEqual(@as(?usize, null), arr.find(99));
}
