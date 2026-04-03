# Safety & Assertion Patterns

Based on TigerBeetle's assertion discipline (inspired by NASA's Power of Ten) and Ghostty's
integrity verification patterns.

## NASA's Power of Ten for Zig

TigerBeetle's safety model is adapted from [NASA's Power of Ten — Rules for Developing Safety
Critical Code](https://spinroot.com/gerard/pdf/P10.pdf):

1. **Simple, explicit control flow.** No recursion. Minimum of excellent abstractions.
2. **Limit everything.** All loops and queues have fixed upper bounds.
3. **Explicitly-sized types.** `u32` over `usize`.
4. **Assert everything.** Minimum two assertions per function.
5. **Static memory allocation.** No dynamic allocation after init.
6. **Smallest possible scope.** Minimize variables in scope.
7. **70-line function limit.** Hard limit. Art is born of constraints.
8. **All compiler warnings at strictest.** From day one.
9. **Run at your own pace.** Don't react directly to external events.

## Assertion Density

Target a minimum of **two assertions per function**. Assertions are a force multiplier for fuzzing —
they downgrade catastrophic correctness bugs into liveness bugs (crashes instead of silent
corruption).

```zig
fn processTransaction(txn: *const Transaction, ledger: *Ledger) !void {
    assert(txn.amount > 0);
    assert(txn.account_id != 0);

    const balance = ledger.getBalance(txn.account_id);
    assert(balance >= 0);

    // ... process ...

    const new_balance = ledger.getBalance(txn.account_id);
    assert(new_balance == balance - txn.amount);
}
```

## Pair Assertions

For every property you enforce, find at least two different code paths to assert it:

```zig
// Before writing to disk:
fn writeBlock(block: *const Block) !void {
    assert(block.checksum == computeChecksum(block.data));
    // ... write to disk ...
}

// After reading from disk:
fn readBlock(block: *Block) !void {
    // ... read from disk ...
    assert(block.checksum == computeChecksum(block.data));
}
```

This catches corruption at both boundaries.

## Positive AND Negative Space

Assert what you expect AND what you don't:

```zig
// Positive space: what we expect.
assert(index < length);
assert(state == .ready);

// Negative space: what we don't expect.
assert(value != sentinel);
assert(state != .corrupted);
```

Bugs live at the boundary between valid and invalid data. Test and assert both sides.

## Split Compound Assertions

```zig
// Prefer — precise diagnostics on failure:
assert(a);
assert(b);

// Over — which condition failed?:
assert(a and b);
```

## Implication Assertions

Use single-line `if` for "if A then B" assertions:

```zig
if (has_grapheme) assert(grapheme_data != null);
if (is_leader) assert(term >= min_term);
```

## Compile-Time Assertions

Assert relationships between constants before the program even runs:

```zig
comptime {
    // Size invariants.
    assert(@sizeOf(Cell) == 8);
    assert(@sizeOf(Row) == 8);

    // No hidden padding in on-disk formats.
    assert(stdx.no_padding(TransferPending));

    // Design invariants.
    assert(checkpoint_ops >= pipeline_max);
    assert(checkpoint_ops % compaction_ops == 0);

    // Alignment requirements.
    assert(std.heap.page_size_min % @max(
        @alignOf(Row), @alignOf(Cell),
    ) == 0);
}
```

## Blatantly True Assertions

Use assertions as stronger-than-comments documentation when a condition is critical and surprising:

```zig
assert(true);  // No, not this.

// But this — documenting that the value is always positive here:
assert(offset >= 0);
```

## stdx.maybe() — Documenting Valid States (TigerBeetle)

A unique "documentation assertion" that something may or may not be true:

```zig
pub fn maybe(ok: bool) void {
    assert(ok or !ok);  // Compiles away, but documents intent.
}

// Usage — documenting that zero contestants is a valid case:
maybe(contestant_count == 0);
```

## Three-Tier Error Strategy

### 1. assert — Programmer Errors

Invariant violations. Always crashes. Kept on in production because silent corruption is worse than
downtime.

```zig
assert(index < self.items.len);
```

### 2. fatal — Environmental Errors (TigerBeetle)

When stopping is the correct response. Uses typed exit codes for monitoring:

```zig
pub const FatalReason = enum(u8) {
    cli = 1,
    no_space_left = 2,
    manifest_node_pool_exhausted = 3,
    // ...
};

pub fn fatal(reason: FatalReason, comptime fmt: []const u8, args: anytype) noreturn {
    log.err(fmt, args);
    std.process.exit(reason.exit_status());
}
```

Don't use `fatal` for bugs — use `assert` or `@panic` instead.

### 3. Error Unions — Expected Operational Errors

For errors that callers must handle:

```zig
pub fn allocate(pool: *Pool) error{OutOfMemory}!*Node {
    // ...
}
```

## Negation Avoidance

State invariants positively. This form is easy to get right:

```zig
if (index < length) {
    // The invariant holds.
} else {
    // The invariant doesn't hold.
}
```

This form is harder and goes against the grain:

```zig
if (index >= length) {
    // It's not true that the invariant holds.
}
```

## Compound Condition Splitting

Split compound conditions into nested `if/else`:

```zig
// Prefer — all cases visible:
if (is_leader) {
    if (has_quorum) {
        // Leader with quorum.
    } else {
        // Leader without quorum.
    }
} else {
    // Not leader.
}

// Over — harder to verify all cases:
if (is_leader and has_quorum) {
    // ...
} else if (is_leader) {
    // ...
}
```

## slow_runtime_safety (Ghostty)

Gate expensive debug checks behind a comptime flag:

```zig
pub const slow_runtime_safety = std.debug.runtime_safety and switch (builtin.mode) {
    .Debug => true,
    .ReleaseSafe, .ReleaseFast, .ReleaseSmall => false,
};

pub inline fn assertIntegrity(self: *const Page) void {
    if (comptime build_options.slow_runtime_safety) {
        self.verifyIntegrity() catch |e| @panic(@errorName(e));
    }
}
```

## constants.verify (TigerBeetle)

An additional tier of expensive checks, enabled in debug but disabled in release:

```zig
if (constants.verify) {
    // Expensive O(n) verification that sorted order is maintained.
    assert(offset == 0 or key_from_value(&values[offset - 1]) < key);
}
```

Use `@setRuntimeSafety(constants.verify)` to selectively control bounds checks.

## Buffer Bleed Prevention

Watch for buffer underflow — padding not zeroed correctly can leak sensitive information or violate
deterministic guarantees:

```zig
// Always zero padding explicitly.
@memset(buffer[used_len..buffer.len], 0);
```

## Function Completion Guarantee

Ensure functions run to completion without suspending, so precondition assertions remain true
throughout the function's lifetime. If a function can suspend, its assertions may be stale when it
resumes.

## errdefer comptime unreachable

After a point where no more errors can occur, document it explicitly:

```zig
try self.nodes.insert(alloc, idx, value);
errdefer comptime unreachable;
// Everything below is infallible — errdefer above proves it.
self.count += 1;
self.dirty = true;
```
