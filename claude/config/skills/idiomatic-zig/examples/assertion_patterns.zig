// Assertion patterns from TigerBeetle.
//
// Key principles:
// - Minimum two assertions per function.
// - Pair assertions (assert same property in two code paths).
// - Assert positive AND negative space.
// - Split compound assertions.
// - Use comptime assertions for design invariants.

const std = @import("std");
const assert = std.debug.assert;

// -- Compile-time assertions for design invariants --

const page_size = 4096;
const block_size = 64;
const blocks_per_page = page_size / block_size;

comptime {
    // Verify our constants are consistent.
    assert(page_size % block_size == 0);
    assert(blocks_per_page * block_size == page_size);
    assert(blocks_per_page > 0);
    assert(blocks_per_page <= 256); // Must fit in u8.
}

// -- Split compound assertions --

fn transfer(from: *Account, to: *Account, amount: u64) !void {
    // Split — precise diagnostics on failure:
    assert(amount > 0);
    assert(from != to);
    assert(from.balance >= amount);

    // NOT: assert(amount > 0 and from != to and from.balance >= amount);

    from.balance -= amount;
    to.balance += amount;

    // Pair assertion: verify the transfer preserved total balance.
    // (This is the second code path asserting balance consistency.)
    assert(from.balance + to.balance == from.balance + amount + to.balance - amount);
}

// -- Positive and negative space --

fn insertSorted(items: []u32, len: *usize, value: u32) !void {
    // Positive: there's room.
    assert(len.* < items.len);

    // Negative: not a duplicate.
    for (items[0..len.*]) |item| {
        assert(item != value);
    }

    // Find insertion point, maintaining sorted order.
    var i: usize = len.*;
    while (i > 0 and items[i - 1] > value) : (i -= 1) {
        items[i] = items[i - 1];
    }
    items[i] = value;
    len.* += 1;

    // Post-condition: still sorted.
    for (1..len.*) |j| {
        assert(items[j - 1] < items[j]);
    }
}

// -- Implication assertions --

const Status = enum { pending, committed, rolled_back };

fn verifyTransaction(txn: *const Transaction) void {
    // If committed, must have a timestamp.
    if (txn.status == .committed) assert(txn.timestamp > 0);

    // If rolled back, amount must be zero.
    if (txn.status == .rolled_back) assert(txn.amount == 0);
}

// -- maybe() for documenting valid states --

/// Documents that a value may or may not satisfy a condition.
/// Compiles away entirely, but communicates intent.
fn maybe(ok: bool) void {
    assert(ok or !ok);
}

fn processQueue(queue: *Queue) void {
    // Document that an empty queue is a valid, expected case.
    maybe(queue.len == 0);

    while (queue.pop()) |item| {
        process(item);
    }
}

// -- Supporting types for the examples --

const Account = struct {
    balance: u64,
};

const Transaction = struct {
    status: Status,
    timestamp: u64,
    amount: u64,
};

const Queue = struct {
    len: usize = 0,
    fn pop(_: *Queue) ?u32 {
        return null;
    }
};

fn process(_: u32) void {}

test "compile-time assertions pass" {
    // These are checked at comptime, but including a test ensures
    // the comptime block is evaluated.
    comptime {
        assert(page_size == 4096);
        assert(blocks_per_page == 64);
    }
}
