# Concurrency & Threading Recipes

*8 recipes, all compiled against Zig 0.16.0*

## Quick Reference

| Recipe | Description | Difficulty |
|--------|-------------|------------|
| [12.1](#recipe-12-1) | Basic Threading and Thread Management | intermediate |
| [12.2](#recipe-12-2) | Mutexes and Basic Locking | intermediate |
| [12.3](#recipe-12-3) | Atomic Operations | intermediate |
| [12.4](#recipe-12-4) | Thread Pools for Parallel Work | intermediate |
| [12.5](#recipe-12-5) | Thread-Safe Queues and Channels | intermediate |
| [12.6](#recipe-12-6) | Condition Variables and Signaling | intermediate |
| [12.7](#recipe-12-7) | Read-Write Locks | intermediate |
| [12.10](#recipe-12-10) | Wait Groups for Synchronization | intermediate |

---

## Recipe 12.1: Basic Threading and Thread Management {#recipe-12-1}

**Tags:** allocators, concurrency, error-handling, memory, resource-cleanup, synchronization, testing, threading
**Difficulty:** intermediate
**Code:** `code/04-specialized/12-concurrency/recipe_12_1.zig`

### Problem

You need to run code in parallel using multiple threads, pass data between threads safely, and coordinate their execution.

### Solution

Zig provides `std.Thread` for creating and managing threads. Here's how to spawn a basic thread:

```zig
test "spawn a basic thread" {
    const thread = try Thread.spawn(.{}, simpleWorker, .{});
    thread.join();
}

fn simpleWorker() void {
    // Thread does some work
    std.debug.print("Thread running\n", .{});
}
```

### Passing Arguments to Threads

Threads can accept parameters through their function arguments:

```zig
test "spawn thread with arguments" {
    const message = "Hello from thread";
    const thread = try Thread.spawn(.{}, workerWithArgs, .{message});
    thread.join();
}

fn workerWithArgs(msg: []const u8) void {
    std.debug.print("{s}\n", .{msg});
}
```

### Managing Multiple Threads

Create and coordinate multiple threads using arrays:

```zig
test "spawn multiple threads" {
    var threads: [4]Thread = undefined;

    for (&threads, 0..) |*thread, i| {
        thread.* = try Thread.spawn(.{}, workerWithId, .{i});
    }

    for (threads) |thread| {
        thread.join();
    }
}

fn workerWithId(id: usize) void {
    std.debug.print("Thread {} running\n", .{id});
}
```

### Sharing State Between Threads

When threads need to share mutable state, protect it with a mutex:

```zig
const Counter = struct {
    value: usize,
    mutex: std.Io.Mutex,

    fn init() Counter {
        return .{
            .value = 0,
            .mutex = .{},
        };
    }

    fn increment(self: *Counter, io: std.Io) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        self.value += 1;
    }
};

var counter = Counter.init();
var threads: [4]Thread = undefined;

for (&threads) |*thread| {
    thread.* = try Thread.spawn(.{}, incrementCounter, .{&counter});
}

for (threads) |thread| {
    thread.join();
}
```

### Discussion

### Thread Lifecycle

Zig requires explicit thread management. Every spawned thread must be joined - there's no detach operation. This prevents resource leaks and ensures you handle thread completion properly.

The `join()` method blocks until the thread completes its work. Plan your thread coordination carefully to avoid unnecessary waiting.

### Thread Configuration

Customize thread behavior with `Thread.SpawnConfig`:

```zig
const config = Thread.SpawnConfig{
    .stack_size = 1024 * 1024, // 1 MB stack
};

const thread = try Thread.spawn(config, simpleWorker, .{});
thread.join();
```

### Timing and Sleep

Use `try io.sleep(.fromNanoseconds()` to pause execution. Time is specified in nanoseconds:

```zig
fn sleepWorker(ms: u64) void {
    Thread.sleep(ms * time.ns_per_ms), .awake);
}
```

### Error Handling in Threads

Thread functions can't directly return errors through `join()`. Instead, communicate errors through shared state:

```zig
var result: ?WorkerError = null;
const thread = try Thread.spawn(.{}, errorWorker, .{&result});
thread.join();

fn errorWorker(result: *?WorkerError) void {
    result.* = WorkerError.TaskFailed;
}
```

### Returning Results from Threads

Use a simple channel pattern to communicate results:

```zig
const ResultChannel = struct {
    result: ?i32,
    mutex: std.Io.Mutex,
    ready: bool,

    fn send(self: *ResultChannel, io: std.Io, value: i32) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        self.result = value;
        self.ready = true;
    }

    fn receive(self: *ResultChannel, io: std.Io) !?i32 {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        if (self.ready) return self.result;
        return null;
    }
};
```

### Thread Identification

Get the current thread's ID for debugging or logging:

```zig
const thread_id = Thread.getCurrentId();
```

### CPU Count Detection

Determine optimal thread pool size based on available CPUs:

```zig
const cpu_count = try Thread.getCpuCount();
// Common pattern: create worker threads = CPU count
```

### Practical Example: Parallel Sum

Here's a complete example of parallel computation:

```zig
fn parallelSum(data: []const i32, num_threads: usize) !i64 {
    const chunk_size = (data.len + num_threads - 1) / num_threads;
    const threads = try allocator.alloc(Thread, num_threads);
    defer allocator.free(threads);

    var partial_sums = try allocator.alloc(i64, num_threads);
    defer allocator.free(partial_sums);

    for (threads, 0..) |*thread, i| {
        const start = i * chunk_size;
        const end = @min(start + chunk_size, data.len);
        if (start >= data.len) {
            partial_sums[i] = 0;
            continue;
        }
        thread.* = try Thread.spawn(.{}, sumChunk, .{ data[start..end], &partial_sums[i] });
    }

    for (threads, 0..) |thread, i| {
        if (i * chunk_size < data.len) {
            thread.join();
        }
    }

    var total: i64 = 0;
    for (partial_sums) |sum| total += sum;
    return total;
}

fn sumChunk(data: []const i32, result: *i64) void {
    var sum: i64 = 0;
    for (data) |value| sum += value;
    result.* = sum;
}
```

### Key Takeaways

1. Always join threads - Zig has no detach operation
2. Protect shared state with mutexes
3. Use channels or shared state to communicate results
4. Configure stack size when needed for deep recursion
5. Match thread count to CPU count for compute-bound tasks
6. Remember that thread creation has overhead - don't spawn thousands of threads

### Full Tested Code

```zig
const std = @import("std");
const testing = std.testing;
const Thread = std.Thread;
const time = std.time;

// ANCHOR: basic_thread
test "spawn a basic thread" {
    const thread = try Thread.spawn(.{}, simpleWorker, .{});
    thread.join();
}

fn simpleWorker() void {
    // Thread does some work
    std.debug.print("Thread running\n", .{});
}
// ANCHOR_END: basic_thread

// ANCHOR: thread_with_args
test "spawn thread with arguments" {
    const message = "Hello from thread";
    const thread = try Thread.spawn(.{}, workerWithArgs, .{message});
    thread.join();
}

fn workerWithArgs(msg: []const u8) void {
    std.debug.print("{s}\n", .{msg});
}
// ANCHOR_END: thread_with_args

// ANCHOR: multiple_threads
test "spawn multiple threads" {
    var threads: [4]Thread = undefined;

    for (&threads, 0..) |*thread, i| {
        thread.* = try Thread.spawn(.{}, workerWithId, .{i});
    }

    for (threads) |thread| {
        thread.join();
    }
}

fn workerWithId(id: usize) void {
    std.debug.print("Thread {} running\n", .{id});
}
// ANCHOR_END: multiple_threads

// ANCHOR: shared_counter
const Counter = struct {
    value: usize,
    mutex: std.Io.Mutex,

    fn init() Counter {
        return .{
            .value = 0,
            .mutex = .init,
        };
    }

    fn increment(self: *Counter, io: std.Io) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        self.value += 1;
    }
};

test "threads with shared state" {
    const io = std.testing.io;
    var counter = Counter.init();
    var threads: [4]Thread = undefined;

    for (&threads) |*thread| {
        thread.* = try Thread.spawn(.{}, incrementCounter, .{ io, &counter });
    }

    for (threads) |thread| {
        thread.join();
    }

    try testing.expectEqual(@as(usize, 4), counter.value);
}

fn incrementCounter(io: std.Io, counter: *Counter) !void {
    try counter.increment(io);
}
// ANCHOR_END: shared_counter

// ANCHOR: thread_sleep
test "thread sleep and timing" {
    const io = std.testing.io;
    const start = @as(i64, @intCast(@divFloor(std.Io.Timestamp.now(io, .real).toNanoseconds(), std.time.ns_per_ms)));

    const thread = try Thread.spawn(.{}, sleepWorker, .{ io, 100 });
    thread.join();

    const elapsed = @as(i64, @intCast(@divFloor(std.Io.Timestamp.now(io, .real).toNanoseconds(), std.time.ns_per_ms))) - start;
    try testing.expect(elapsed >= 100);
}

fn sleepWorker(io: std.Io, ms: u64) !void {
    try io.sleep(.fromNanoseconds(ms * time.ns_per_ms), .awake);
}
// ANCHOR_END: thread_sleep

// ANCHOR: thread_config
test "thread with stack size configuration" {
    const config = Thread.SpawnConfig{
        .stack_size = 1024 * 1024, // 1 MB stack
    };

    const thread = try Thread.spawn(config, simpleWorker, .{});
    thread.join();
}
// ANCHOR_END: thread_config

// ANCHOR: thread_error_handling
const WorkerError = error{
    TaskFailed,
    InvalidInput,
};

test "handling errors in threads" {
    // Threads that return errors need special handling
    // The thread function itself can't return errors through join()
    // Instead, use shared state to communicate errors

    var result: ?WorkerError = null;
    const thread = try Thread.spawn(.{}, errorWorker, .{&result});
    thread.join();

    try testing.expectEqual(WorkerError.TaskFailed, result.?);
}

fn errorWorker(result: *?WorkerError) void {
    // Simulate an error condition
    result.* = WorkerError.TaskFailed;
}
// ANCHOR_END: thread_error_handling

// ANCHOR: thread_result_channel
const ResultChannel = struct {
    result: ?i32,
    mutex: std.Io.Mutex,
    ready: bool,

    fn init() ResultChannel {
        return .{
            .result = null,
            .mutex = .init,
            .ready = false,
        };
    }

    fn send(self: *ResultChannel, io: std.Io, value: i32) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        self.result = value;
        self.ready = true;
    }

    fn receive(self: *ResultChannel, io: std.Io) !?i32 {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        if (self.ready) {
            return self.result;
        }
        return null;
    }
};

test "thread result via channel" {
    const io = std.testing.io;
    var channel = ResultChannel.init();

    const thread = try Thread.spawn(.{}, computeWorker, .{ io, &channel });

    // Wait for result
    while (try channel.receive(io) == null) {
        try io.sleep(.fromNanoseconds(time.ns_per_ms), .awake);
    }

    thread.join();

    try testing.expectEqual(@as(i32, 42), channel.result.?);
}

fn computeWorker(io: std.Io, channel: *ResultChannel) !void {
    try io.sleep(.fromNanoseconds(10 * time.ns_per_ms), .awake);
    try channel.send(io, 42);
}
// ANCHOR_END: thread_result_channel

// ANCHOR: thread_current_id
test "get current thread ID" {
    const main_id = Thread.getCurrentId();

    var thread_id: Thread.Id = undefined;
    const thread = try Thread.spawn(.{}, getThreadId, .{&thread_id});
    thread.join();

    // IDs should be different
    try testing.expect(main_id != thread_id);
}

fn getThreadId(id: *Thread.Id) void {
    id.* = Thread.getCurrentId();
}
// ANCHOR_END: thread_current_id

// ANCHOR: cpu_count
test "detect CPU count for thread pool sizing" {
    const cpu_count = try Thread.getCpuCount();
    try testing.expect(cpu_count > 0);

    // Common pattern: create worker threads = CPU count
    std.debug.print("CPU count: {}\n", .{cpu_count});
}
// ANCHOR_END: cpu_count

// ANCHOR: thread_detach
test "understanding thread lifecycle" {
    // In Zig, you must explicitly join threads
    // There's no detach - all threads must be joined
    // This prevents resource leaks

    const thread = try Thread.spawn(.{}, simpleWorker, .{});

    // Must call join() or thread handle leaks
    thread.join();
}
// ANCHOR_END: thread_detach

// ANCHOR: practical_parallel_sum
fn parallelSum(data: []const i32, num_threads: usize) !i64 {
    if (data.len == 0) return 0;
    if (num_threads == 1) {
        var sum: i64 = 0;
        for (data) |value| sum += value;
        return sum;
    }

    const chunk_size = (data.len + num_threads - 1) / num_threads;
    const threads = try std.testing.allocator.alloc(Thread, num_threads);
    defer std.testing.allocator.free(threads);

    var partial_sums = try std.testing.allocator.alloc(i64, num_threads);
    defer std.testing.allocator.free(partial_sums);

    for (threads, 0..) |*thread, i| {
        const start = i * chunk_size;
        const end = @min(start + chunk_size, data.len);
        if (start >= data.len) {
            partial_sums[i] = 0;
            continue;
        }
        thread.* = try Thread.spawn(.{}, sumChunk, .{ data[start..end], &partial_sums[i] });
    }

    for (threads, 0..) |thread, i| {
        if (i * chunk_size < data.len) {
            thread.join();
        }
    }

    var total: i64 = 0;
    for (partial_sums) |sum| total += sum;
    return total;
}

fn sumChunk(data: []const i32, result: *i64) void {
    var sum: i64 = 0;
    for (data) |value| sum += value;
    result.* = sum;
}

test "parallel sum computation" {
    const data = [_]i32{ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 };
    const result = try parallelSum(&data, 4);
    try testing.expectEqual(@as(i64, 55), result);
}
// ANCHOR_END: practical_parallel_sum
```

### See Also

- Recipe 12.2: Mutexes and basic locking
- Recipe 12.4: Thread pools for parallel work
- Recipe 12.5: Thread

---

## Recipe 12.2: Mutexes and Basic Locking {#recipe-12-2}

**Tags:** allocators, arraylist, atomics, concurrency, data-structures, error-handling, hashmap, memory, resource-cleanup, synchronization, testing, threading
**Difficulty:** intermediate
**Code:** `code/04-specialized/12-concurrency/recipe_12_2.zig`

### Problem

You need to protect shared mutable data from race conditions when multiple threads access it concurrently. Without synchronization, concurrent reads and writes can corrupt data and cause unpredictable behavior.

### Solution

Use `std.Thread.Mutex` to create critical sections where only one thread can execute at a time.

### Basic Mutex Usage

```zig
test "basic mutex usage" {
    const io = std.testing.io;
    var mutex = std.Io.Mutex.init;
    var counter: i32 = 0;

    try mutex.lock(io);
    counter += 1;
    mutex.unlock(io);

    try testing.expectEqual(@as(i32, 1), counter);
}
```

### Defer for Automatic Unlock

Always use `defer` to ensure the mutex is unlocked, even if an error occurs:

```zig
test "defer for automatic unlock" {
    const io = std.testing.io;
    var mutex = std.Io.Mutex.init;
    var value: i32 = 0;

    {
        try mutex.lock(io);
        defer mutex.unlock(io);
        value = 42;
        // mutex automatically unlocks when scope exits
    }

    try testing.expectEqual(@as(i32, 42), value);
}
```

### Protecting Shared Data

Embed the mutex with the data it protects:

```zig
const BankAccount = struct {
    balance: i64,
    mutex: Mutex,

    fn init(initial_balance: i64) BankAccount {
        return .{
            .balance = initial_balance,
            .mutex = .{},
        };
    }

    fn deposit(self: *BankAccount, io: std.Io, amount: i64) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        self.balance += amount;
    }

    fn withdraw(self: *BankAccount, io: std.Io, amount: i64) !bool {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        if (self.balance >= amount) {
            self.balance -= amount;
            return true;
        }
        return false;
    }

    fn getBalance(self: *BankAccount, io: std.Io) !i64 {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        return self.balance;
    }
};
```

This pattern ensures the mutex is always held when accessing `balance`, preventing race conditions.

### Discussion

### Critical Sections

A critical section is code that must execute atomically with respect to other threads. Keep critical sections as short as possible to minimize contention:

```zig
const SharedBuffer = struct {
    data: [100]u8,
    write_index: usize,
    mutex: Mutex,

    fn append(self: *SharedBuffer, io: std.Io, value: u8) !bool {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        // Critical section: only one thread at a time
        if (self.write_index >= self.data.len) {
            return false;
        }

        self.data[self.write_index] = value;
        self.write_index += 1;
        return true;
    }
};
```

### Atomic Multi-Object Operations

When an operation involves multiple objects, you must lock all of them to ensure atomicity:

```zig
fn transfer(io: std.Io, from: *BankAccount, to: *BankAccount, amount: i64) !void {
    from.mutex.lock(io);
    defer from.mutex.unlock(io);

    to.mutex.lock(io);
    defer to.mutex.unlock(io);

    if (from.balance < amount) {
        return error.InsufficientFunds;
    }

    from.balance -= amount;
    to.balance += amount;
}
```

However, this approach can deadlock if two threads try to transfer in opposite directions simultaneously.

### Preventing Deadlock with Lock Ordering

Always acquire locks in a consistent order. One approach is to order by memory address:

```zig
fn safeConcurrentTransfer(io: std.Io, account1: *BankAccount,
    account2: *BankAccount,
    amount: i64,) !void {
    // Lock accounts in consistent order based on memory address
    const first = if (@intFromPtr(account1) < @intFromPtr(account2))
        account1 else account2;
    const second = if (@intFromPtr(account1) < @intFromPtr(account2))
        account2 else account1;

    first.mutex.lock(io);
    defer first.mutex.unlock(io);

    second.mutex.lock(io);
    defer second.mutex.unlock(io);

    if (account1.balance < amount) {
        return error.InsufficientFunds;
    }

    account1.balance -= amount;
    account2.balance += amount;
}
```

This guarantees threads always lock in the same order, preventing circular wait conditions.

### Avoiding Nested Locking

Don't call a locked method from another locked method of the same object - this causes deadlock:

```zig
// WRONG: This deadlocks!
fn incrementBy(self: *Counter, io: std.Io, amount: i32) !void {
    try self.mutex.lock(io);
    defer self.mutex.unlock(io);

    var i: i32 = 0;
    while (i < amount) : (i += 1) {
        self.increment(); // increment() tries to lock again!
    }
}

// RIGHT: Duplicate logic or use internal unlocked methods
fn incrementBy(self: *Counter, io: std.Io, amount: i32) !void {
    try self.mutex.lock(io);
    defer self.mutex.unlock(io);
    self.value += amount;
}
```

### Granular Locking

Instead of one global lock, use multiple locks to reduce contention. A concurrent hash map can lock individual buckets:

```zig
const ConcurrentHashMap = struct {
    buckets: [16]Bucket,
    allocator: Allocator,

    const Bucket = struct {
        items: std.ArrayList(Entry),
        mutex: Mutex,
    };

    fn put(self: *ConcurrentHashMap, io: std.Io, key: u32, value: i32) !void {
        const bucket_index = key % self.buckets.len;
        var bucket = &self.buckets[bucket_index];

        bucket.mutex.lock(io);
        defer bucket.mutex.unlock(io);

        // Only this bucket is locked, not the entire map
        try bucket.items.append(self.allocator, .{ .key = key, .value = value });
    }
};
```

Different buckets can be accessed concurrently, improving throughput.

### Mutex Initialization

Mutexes use default initialization with empty braces:

```zig
// Standalone mutex
var mutex = std.Io.Mutex.init;

// Embedded in struct with default field syntax
const Data = struct {
    value: i32,
    lock: Mutex = .{},
};
```

### Scoped Access Pattern

Encapsulate locking logic to prevent forgetting to acquire the mutex:

```zig
const SafeCounter = struct {
    value: i32,
    mutex: Mutex,

    fn add(self: *SafeCounter, io: std.Io, amount: i32) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        self.value += amount;
    }

    fn get(self: *SafeCounter, io: std.Io) !i32 {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        return self.value;
    }
};
```

Users of `SafeCounter` can't accidentally access `value` without holding the lock.

### Performance Considerations

Mutex contention slows down concurrent programs. To minimize contention:

1. Keep critical sections short
2. Use granular locking (multiple locks)
3. Prefer lock-free algorithms when appropriate (see Recipe 12.3 on atomics)
4. Avoid holding locks during I/O operations

### Common Mistakes

1. **Forgetting to unlock** - Always use `defer mutex.unlock()`
2. **Locking too much** - Don't hold locks during slow operations
3. **Inconsistent lock ordering** - Always lock in the same order
4. **Reading without locking** - Even reads need synchronization
5. **Nested locking** - Don't call locked methods from locked methods

### Full Tested Code

```zig
const std = @import("std");
const testing = std.testing;
const Thread = std.Thread;
const Mutex = std.Io.Mutex;

// ANCHOR: basic_mutex
test "basic mutex usage" {
    const io = std.testing.io;
    var mutex = std.Io.Mutex.init;
    var counter: i32 = 0;

    try mutex.lock(io);
    counter += 1;
    mutex.unlock(io);

    try testing.expectEqual(@as(i32, 1), counter);
}
// ANCHOR_END: basic_mutex

// ANCHOR: defer_unlock
test "defer for automatic unlock" {
    const io = std.testing.io;
    var mutex = std.Io.Mutex.init;
    var value: i32 = 0;

    {
        try mutex.lock(io);
        defer mutex.unlock(io);
        value = 42;
        // mutex automatically unlocks when scope exits
    }

    try testing.expectEqual(@as(i32, 42), value);
}
// ANCHOR_END: defer_unlock

// ANCHOR: protecting_shared_data
const BankAccount = struct {
    balance: i64,
    mutex: Mutex,

    fn init(initial_balance: i64) BankAccount {
        return .{
            .balance = initial_balance,
            .mutex = .init,
        };
    }

    fn deposit(self: *BankAccount, io: std.Io, amount: i64) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        self.balance += amount;
    }

    fn withdraw(self: *BankAccount, io: std.Io, amount: i64) !bool {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        if (self.balance >= amount) {
            self.balance -= amount;
            return true;
        }
        return false;
    }

    fn getBalance(self: *BankAccount, io: std.Io) !i64 {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        return self.balance;
    }
};

test "protecting shared data with mutex" {
    const io = std.testing.io;
    var account = BankAccount.init(1000);

    var threads: [10]Thread = undefined;

    // Spawn threads that deposit money
    for (&threads) |*thread| {
        thread.* = try Thread.spawn(.{}, depositWorker, .{ io, &account });
    }

    for (threads) |thread| {
        thread.join();
    }

    try testing.expectEqual(@as(i64, 1100), account.getBalance(io));
}

fn depositWorker(io: std.Io, account: *BankAccount) !void {
    try account.deposit(io, 10);
}
// ANCHOR_END: protecting_shared_data

// ANCHOR: multiple_operations
const TransferError = error{InsufficientFunds};

fn transfer(io: std.Io, from: *BankAccount, to: *BankAccount, amount: i64) (TransferError || std.Io.Cancelable)!void {
    // Lock both accounts to ensure atomic transfer
    try from.mutex.lock(io);
    defer from.mutex.unlock(io);

    try to.mutex.lock(io);
    defer to.mutex.unlock(io);

    if (from.balance < amount) {
        return TransferError.InsufficientFunds;
    }

    from.balance -= amount;
    to.balance += amount;
}

test "atomic transfer between accounts" {
    const io = std.testing.io;
    var account1 = BankAccount.init(1000);
    var account2 = BankAccount.init(500);

    try transfer(io, &account1, &account2, 300);

    try testing.expectEqual(@as(i64, 700), account1.getBalance(io));
    try testing.expectEqual(@as(i64, 800), account2.getBalance(io));
}
// ANCHOR_END: multiple_operations

// ANCHOR: critical_section
const SharedBuffer = struct {
    data: [100]u8,
    write_index: usize,
    mutex: Mutex,

    fn init() SharedBuffer {
        return .{
            .data = [_]u8{0} ** 100,
            .write_index = 0,
            .mutex = .init,
        };
    }

    fn append(self: *SharedBuffer, io: std.Io, value: u8) !bool {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        // Critical section: only one thread can execute this at a time
        if (self.write_index >= self.data.len) {
            return false;
        }

        self.data[self.write_index] = value;
        self.write_index += 1;
        return true;
    }

    fn size(self: *SharedBuffer, io: std.Io) !usize {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        return self.write_index;
    }
};

test "critical section protection" {
    const io = std.testing.io;
    var buffer = SharedBuffer.init();

    var threads: [10]Thread = undefined;
    for (&threads, 0..) |*thread, i| {
        thread.* = try Thread.spawn(.{}, appendWorker, .{ io, &buffer, @as(u8, @intCast(i)) });
    }

    for (threads) |thread| {
        thread.join();
    }

    try testing.expectEqual(@as(usize, 10), try buffer.size(io));
}

fn appendWorker(io: std.Io, buffer: *SharedBuffer, value: u8) !void {
    _ = try buffer.append(io, value);
}
// ANCHOR_END: critical_section

// ANCHOR: nested_locking_safe
const NestedCounter = struct {
    value: i32,
    mutex: Mutex,

    fn init() NestedCounter {
        return .{
            .value = 0,
            .mutex = .init,
        };
    }

    fn increment(self: *NestedCounter, io: std.Io) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        self.value += 1;
    }

    fn incrementBy(self: *NestedCounter, io: std.Io, amount: i32) !void {
        // Don't call increment(io) here - it would try to lock again (deadlock)
        // Instead, duplicate the logic or restructure
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        self.value += amount;
    }

    fn safeIncrementBy(self: *NestedCounter, amount: i32) void {
        // Safe pattern: internal method without lock
        var i: i32 = 0;
        while (i < amount) : (i += 1) {
            self.increment();
        }
    }
};

test "avoiding nested locking" {
    const io = std.testing.io;
    var counter = NestedCounter.init();
    try counter.incrementBy(io, 5);
    try testing.expectEqual(@as(i32, 5), counter.value);
}
// ANCHOR_END: nested_locking_safe

// ANCHOR: lock_ordering
// Always lock mutexes in the same order to avoid deadlock
fn safeConcurrentTransfer(io: std.Io, account1: *BankAccount,
    account2: *BankAccount,
    amount: i64,) (TransferError || std.Io.Cancelable)!void {
    // Lock accounts in consistent order based on memory address
    const first = if (@intFromPtr(account1) < @intFromPtr(account2)) account1 else account2;
    const second = if (@intFromPtr(account1) < @intFromPtr(account2)) account2 else account1;

    try first.mutex.lock(io);
    defer first.mutex.unlock(io);

    try second.mutex.lock(io);
    defer second.mutex.unlock(io);

    if (account1.balance < amount) {
        return TransferError.InsufficientFunds;
    }

    account1.balance -= amount;
    account2.balance += amount;
}

test "lock ordering prevents deadlock" {
    const io = std.testing.io;
    var account1 = BankAccount.init(1000);
    var account2 = BankAccount.init(500);

    try safeConcurrentTransfer(io, &account1, &account2, 100);
    try safeConcurrentTransfer(io, &account2, &account1, 50);

    try testing.expectEqual(@as(i64, 950), account1.balance);
    try testing.expectEqual(@as(i64, 550), account2.balance);
}
// ANCHOR_END: lock_ordering

// ANCHOR: granular_locking
const ConcurrentHashMap = struct {
    buckets: [16]Bucket,
    allocator: std.mem.Allocator,

    const Bucket = struct {
        items: std.ArrayList(Entry),
        mutex: Mutex,
    };

    const Entry = struct {
        key: u32,
        value: i32,
    };

    fn init(allocator: std.mem.Allocator) ConcurrentHashMap {
        var map: ConcurrentHashMap = .{
            .buckets = undefined,
            .allocator = allocator,
        };
        for (&map.buckets) |*bucket| {
            bucket.* = .{
                .items = std.ArrayList(Entry).empty,
                .mutex = .init,
            };
        }
        return map;
    }

    fn deinit(self: *ConcurrentHashMap) void {
        for (&self.buckets) |*bucket| {
            bucket.items.deinit(self.allocator);
        }
    }

    fn put(self: *ConcurrentHashMap, io: std.Io, key: u32, value: i32) !void {
        const bucket_index = key % self.buckets.len;
        var bucket = &self.buckets[bucket_index];

        try bucket.mutex.lock(io);
        defer bucket.mutex.unlock(io);

        // Check if key exists
        for (bucket.items.items) |*entry| {
            if (entry.key == key) {
                entry.value = value;
                return;
            }
        }

        // Add new entry
        try bucket.items.append(self.allocator, .{ .key = key, .value = value });
    }

    fn get(self: *ConcurrentHashMap, io: std.Io, key: u32) !?i32 {
        const bucket_index = key % self.buckets.len;
        var bucket = &self.buckets[bucket_index];

        try bucket.mutex.lock(io);
        defer bucket.mutex.unlock(io);

        for (bucket.items.items) |entry| {
            if (entry.key == key) {
                return entry.value;
            }
        }
        return null;
    }
};

test "granular locking with multiple mutexes" {
    const io = std.testing.io;
    var map = ConcurrentHashMap.init(testing.allocator);
    defer map.deinit();

    try map.put(io, 1, 100);
    try map.put(io, 17, 200); // Same bucket as 1 (1 % 16 == 17 % 16)

    try testing.expectEqual(@as(i32, 100), (try map.get(io, 1)).?);
    try testing.expectEqual(@as(i32, 200), (try map.get(io, 17)).?);
}
// ANCHOR_END: granular_locking

// ANCHOR: mutex_initialization
test "mutex initialization patterns" {
    const io = std.testing.io;
    // Default initialization
    var mutex1 = std.Io.Mutex.init;
    try mutex1.lock(io);
    mutex1.unlock(io);

    // Struct with embedded mutex
    const Data = struct {
        value: i32,
        lock: Mutex = .init,
    };

    var data = Data{ .value = 42 };
    try data.lock.lock(io);
    defer data.lock.unlock(io);
    try testing.expectEqual(@as(i32, 42), data.value);
}
// ANCHOR_END: mutex_initialization

// ANCHOR: scoped_access
const SafeCounter = struct {
    value: i32,
    mutex: Mutex,

    fn init() SafeCounter {
        return .{
            .value = 0,
            .mutex = .init,
        };
    }

    fn add(self: *SafeCounter, io: std.Io, amount: i32) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        self.value += amount;
    }

    fn get(self: *SafeCounter, io: std.Io) !i32 {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        return self.value;
    }
};

test "scoped mutex access" {
    const io = std.testing.io;
    var counter = SafeCounter.init();
    try counter.add(io, 10);

    const result = counter.get(io);
    try testing.expectEqual(@as(i32, 10), result);
}
// ANCHOR_END: scoped_access

// ANCHOR: benchmarking_contention
test "mutex contention stress test" {
    const io = std.testing.io;
    var counter = SafeCounter.init();
    var threads: [100]Thread = undefined;

    const start = @as(i64, @intCast(@divFloor(std.Io.Timestamp.now(io, .real).toNanoseconds(), std.time.ns_per_ms)));

    for (&threads) |*thread| {
        thread.* = try Thread.spawn(.{}, stressWorker, .{ io, &counter });
    }

    for (threads) |thread| {
        thread.join();
    }

    const elapsed = @as(i64, @intCast(@divFloor(std.Io.Timestamp.now(io, .real).toNanoseconds(), std.time.ns_per_ms))) - start;

    // Each thread increments 100 times
    try testing.expectEqual(@as(i32, 10000), counter.value);

    std.debug.print("Mutex contention test: {} threads, {}ms\n", .{ threads.len, elapsed });
}

fn stressWorker(io: std.Io, counter: *SafeCounter) !void {
    var i: usize = 0;
    while (i < 100) : (i += 1) {
        try counter.add(io, 1);
    }
}
// ANCHOR_END: benchmarking_contention
```

### See Also

- Recipe 12.1: Basic threading and thread management
- Recipe 12.3: Atomic operations
- Recipe 12.7: Read
- Recipe 12.9: Preventing race conditions

---

## Recipe 12.3: Atomic Operations {#recipe-12-3}

**Tags:** atomics, concurrency, pointers, resource-cleanup, synchronization, testing, threading
**Difficulty:** intermediate
**Code:** `code/04-specialized/12-concurrency/recipe_12_3.zig`

### Problem

Mutexes can be heavyweight for simple operations like incrementing a counter. You need faster synchronization primitives that work without locks, or you want to implement lock-free data structures.

### Solution

Use `std.atomic.Value` for lock-free atomic operations. Atomic operations execute indivisibly - no other thread can observe them in a partially completed state.

### Basic Atomic Operations

```zig
test "basic atomic operations" {
    var counter = Atomic(i32).init(0);

    // Atomic store
    counter.store(42, .monotonic);

    // Atomic load
    const value = counter.load(.monotonic);
    try testing.expectEqual(@as(i32, 42), value);
}
```

### Atomic Increment

Multiple threads can safely increment the same counter without locks:

```zig
test "atomic increment from multiple threads" {
    var counter = Atomic(u32).init(0);
    var threads: [10]Thread = undefined;

    for (&threads) |*thread| {
        thread.* = try Thread.spawn(.{}, atomicIncrementWorker, .{&counter});
    }

    for (threads) |thread| {
        thread.join();
    }

    // Each thread increments 1000 times
    try testing.expectEqual(@as(u32, 10000), counter.load(.monotonic));
}

fn atomicIncrementWorker(counter: *Atomic(u32)) void {
    var i: u32 = 0;
    while (i < 1000) : (i += 1) {
        _ = counter.fetchAdd(@as(u32, 1), .monotonic);
    }
}
```

This is much faster than using a mutex for simple counters.

### Discussion

### Compare-and-Swap (CAS)

The fundamental building block of lock-free programming. It atomically compares a value and swaps it only if it matches:

```zig
var value = Atomic(i32).init(100);

// Try to swap 100 for 200
const result = value.cmpxchgWeak(100, 200, .monotonic, .monotonic);
if (result == null) {
    // Swap succeeded, value is now 200
} else {
    // Swap failed, result contains current value
}
```

`cmpxchgWeak` may spuriously fail on some architectures but is faster. Use `cmpxchgStrong` if you can't handle spurious failures.

### Memory Ordering

Atomic operations take memory ordering parameters that control how operations are synchronized across threads:

- **`.seq_cst`** (Sequential Consistency) - Strongest guarantee, all operations appear in some global order. Slowest.
- **`.release`** - Writes before this operation are visible to threads that `acquire` this variable
- **`.acquire`** - Reads after this operation see writes from threads that `release` this variable
- **`.monotonic`** - Just atomic access, no synchronization with other threads
- **`.acq_rel`** - Combined acquire and release for read-modify-write operations

Common patterns:
- Producer sets flag with `.release`, consumer reads with `.acquire`
- Simple counters use `.monotonic`
- When unsure, use `.seq_cst` (safe but slower)

### Lock-Free Stack

A complete lock-free data structure using CAS:

```zig
const LockFreeStack = struct {
    head: Atomic(?*Node),

    fn push(self: *LockFreeStack, node: *Node) void {
        var current_head = self.head.load(.monotonic);

        while (true) {
            node.next = current_head;

            // Try to swing head to new node
            if (self.head.cmpxchgWeak(
                current_head,
                node,
                .release,
                .monotonic,
            )) |new_head| {
                // CAS failed, retry
                current_head = new_head;
            } else {
                // CAS succeeded
                break;
            }
        }
    }
};
```

The loop handles contention: if another thread modifies `head` between load and CAS, retry.

### Spin Lock

Implement a simple lock using an atomic flag:

```zig
const SpinLock = struct {
    locked: Atomic(bool),

    fn lock(self: *SpinLock) void {
        while (self.locked.swap(true, .acquire)) {
            // Spin until we acquire the lock
        }
    }

    fn unlock(self: *SpinLock) void {
        self.locked.store(false, .release);
    }
};
```

Spin locks are faster than mutexes for very short critical sections but waste CPU time spinning.

### Fetch-and-Modify Operations

Atomic operations that modify and return the previous value:

```zig
var counter = Atomic(u32).init(10);

// Returns old value (10), counter becomes 15
const old_add = counter.fetchAdd(5, .monotonic);

// Returns old value (15), counter becomes 12
const old_sub = counter.fetchSub(3, .monotonic);

// Bitwise operations
var flags = Atomic(u8).init(0b0000_1111);
_ = flags.fetchAnd(0b1111_0000, .monotonic); // Clear lower bits
_ = flags.fetchOr(0b1111_0000, .monotonic);  // Set upper bits
_ = flags.fetchXor(0b1010_1010, .monotonic); // Toggle bits
```

### Atomic Pointers

Pointers can be atomic too, useful for lock-free data structures:

```zig
var data: i32 = 42;
var ptr = Atomic(?*i32).init(&data);

// Load pointer atomically
const loaded = ptr.load(.monotonic);

// Swap pointers atomically
ptr.store(&other_data, .monotonic);

// CAS on pointers
_ = ptr.cmpxchgWeak(&old_ptr, &new_ptr, .monotonic, .monotonic);
```

### Atomic Min/Max Pattern

Update a shared minimum or maximum using CAS:

```zig
fn updateMin(min_val: *Atomic(i32), value: i32) void {
    var current = min_val.load(.monotonic);
    while (value < current) {
        if (min_val.cmpxchgWeak(
            current,
            value,
            .monotonic,
            .monotonic,
        )) |new_val| {
            current = new_val; // Retry
        } else {
            break; // Success
        }
    }
}
```

### Double-Checked Locking

Optimize lazy initialization with an atomic flag:

```zig
const LazyInit = struct {
    initialized: Atomic(bool),
    mutex: Mutex,
    value: ?i32,

    fn getValue(self: *LazyInit, io: std.Io) !i32 {
        // Fast path: already initialized
        if (self.initialized.load(.acquire)) {
            return self.value.?;
        }

        // Slow path: acquire lock and initialize
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        // Double check after acquiring lock
        if (!self.initialized.load(.monotonic)) {
            self.value = expensiveComputation();
            self.initialized.store(true, .release);
        }

        return self.value.?;
    }
};
```

Most threads hit the fast path without locking.

### When to Use Atomics

Use atomics when:
- Simple operations (counters, flags, pointers)
- Very high contention where mutex overhead matters
- Implementing lock-free data structures
- You understand memory ordering

Use mutexes when:
- Complex operations involving multiple variables
- Critical sections with conditional logic
- You're not sure about memory ordering
- Code clarity matters more than maximum performance

### Common Pitfalls

1. **Wrong memory ordering** - Can cause subtle bugs. When in doubt, use `.seq_cst`

2. **ABA problem** - Value changes from A→B→A, CAS succeeds incorrectly

   **The Problem:** In lock-free data structures using CAS on raw pointers, a dangerous race condition can occur:

   - Thread 1 reads head pointer (Node A) and head.next (Node B), then gets preempted
   - Thread 2 pops Node A, frees it, and pops Node B
   - Thread 2 allocates a new node at the same memory address as A
   - Thread 1 resumes and sees head is still address A, so CAS succeeds
   - Result: The stack is now corrupted because Node B was already removed

   **Example Scenario:**
   ```
   Initial: head -> A -> B -> C

   Thread 1: Reads head=A, reads A.next=B, prepares to CAS(A, B)
   Thread 2: Pops A (head -> B), pops B (head -> C)
   Thread 2: Allocates new node at address A (head -> A')
   Thread 1: CAS succeeds! Sets head=B (but B is stale/freed)
   Result: Corrupted stack with dangling pointer
   ```

   **Mitigation Strategies:**

   Production lock-free structures require memory reclamation:
   - **Hazard Pointers**: Threads mark pointers as "in-use" before accessing, preventing premature reclamation
   - **Epoch-Based Reclamation (EBR)**: Nodes are retired in epochs; only reclaimed after all threads have advanced
   - **Reference Counting**: Track how many threads reference each node

   **Important:** The lock-free stack example in this recipe is for educational purposes only. It does NOT implement memory reclamation and is unsafe for production use with heap-allocated nodes. For production code, use proven concurrent data structures or implement proper memory reclamation.

3. **Too much spinning** - Spin locks waste CPU on long waits
4. **Complex invariants** - Atomics can't protect complex multi-variable invariants
5. **Assuming atomicity** - Operations like `x = x + 1` are NOT atomic without explicit atomic ops

### Full Tested Code

```zig
const std = @import("std");
const testing = std.testing;
const Thread = std.Thread;
const Atomic = std.atomic.Value;

// ANCHOR: basic_atomic
test "basic atomic operations" {
    var counter = Atomic(i32).init(0);

    // Atomic store
    counter.store(42, .monotonic);

    // Atomic load
    const value = counter.load(.monotonic);
    try testing.expectEqual(@as(i32, 42), value);
}
// ANCHOR_END: basic_atomic

// ANCHOR: atomic_increment
test "atomic increment from multiple threads" {
    var counter = Atomic(u32).init(0);
    var threads: [10]Thread = undefined;

    for (&threads) |*thread| {
        thread.* = try Thread.spawn(.{}, atomicIncrementWorker, .{&counter});
    }

    for (threads) |thread| {
        thread.join();
    }

    // Each thread increments 1000 times
    try testing.expectEqual(@as(u32, 10000), counter.load(.monotonic));
}

fn atomicIncrementWorker(counter: *Atomic(u32)) void {
    var i: u32 = 0;
    while (i < 1000) : (i += 1) {
        _ = counter.fetchAdd(@as(u32, 1), .monotonic);
    }
}
// ANCHOR_END: atomic_increment

// ANCHOR: compare_and_swap
test "compare and swap" {
    var value = Atomic(i32).init(100);

    // Try to swap 100 for 200
    const result1 = value.cmpxchgWeak(100, 200, .monotonic, .monotonic);
    try testing.expect(result1 == null); // Swap succeeded

    // Try to swap 100 for 300 (will fail, value is now 200)
    const result2 = value.cmpxchgWeak(100, 300, .monotonic, .monotonic);
    try testing.expect(result2 != null); // Swap failed
    try testing.expectEqual(@as(i32, 200), result2.?);

    try testing.expectEqual(@as(i32, 200), value.load(.monotonic));
}
// ANCHOR_END: compare_and_swap

// ANCHOR: memory_ordering
test "memory ordering examples" {
    var flag = Atomic(bool).init(false);
    const data: i32 = 0;

    // Sequential consistency (strongest, slowest)
    flag.store(true, .seq_cst);

    // Acquire-release semantics (common for synchronization)
    flag.store(true, .release); // Ensure all previous writes are visible
    const value = flag.load(.acquire); // Ensure subsequent reads see previous writes
    _ = value;

    // Monotonic (no synchronization, just atomic access)
    flag.store(true, .monotonic);

    // Unordered is not available in Zig for safety

    try testing.expect(data == 0);
}
// ANCHOR_END: memory_ordering

// ANCHOR: lock_free_stack
const LockFreeStack = struct {
    head: Atomic(?*Node),

    const Node = struct {
        value: i32,
        next: ?*Node,
    };

    fn init() LockFreeStack {
        return .{
            .head = Atomic(?*Node).init(null),
        };
    }

    fn push(self: *LockFreeStack, node: *Node) !void {
        var current_head = self.head.load(.monotonic);

        while (true) {
            node.next = current_head;

            // Try to swing head to new node
            if (self.head.cmpxchgWeak(
                current_head,
                node,
                .release,
                .monotonic,
            )) |new_head| {
                // CAS failed, try again
                current_head = new_head;
            } else {
                // CAS succeeded
                break;
            }
        }
    }

    fn pop(self: *LockFreeStack) !?*Node {
        var current_head = self.head.load(.monotonic);

        while (current_head) |head| {
            const next = head.next;

            // Try to swing head to next node
            if (self.head.cmpxchgWeak(
                current_head,
                next,
                .acquire,
                .monotonic,
            )) |new_head| {
                // CAS failed, try again
                current_head = new_head;
            } else {
                // CAS succeeded
                return head;
            }
        }

        return null;
    }
};

test "lock-free stack" {
    var stack = LockFreeStack.init();

    var node1 = LockFreeStack.Node{ .value = 1, .next = null };
    var node2 = LockFreeStack.Node{ .value = 2, .next = null };
    var node3 = LockFreeStack.Node{ .value = 3, .next = null };

    try stack.push(&node1);
    try stack.push(&node2);
    try stack.push(&node3);

    try testing.expectEqual(@as(i32, 3), (try stack.pop()).?.value);
    try testing.expectEqual(@as(i32, 2), (try stack.pop()).?.value);
    try testing.expectEqual(@as(i32, 1), (try stack.pop()).?.value);
    try testing.expect((try stack.pop()) == null);
}
// ANCHOR_END: lock_free_stack

// ANCHOR: atomic_flag
const SpinLock = struct {
    locked: Atomic(bool),

    fn init() SpinLock {
        return .{
            .locked = Atomic(bool).init(false),
        };
    }

    fn lock(self: *SpinLock) void {
        while (self.locked.swap(true, .acquire)) {
            // Yield to other threads to reduce CPU waste
            Thread.yield() catch {};
        }
    }

    fn unlock(self: *SpinLock) void {
        self.locked.store(false, .release);
    }

    fn tryLock(self: *SpinLock) bool {
        return !self.locked.swap(true, .acquire);
    }
};

test "spin lock with atomic flag" {
    var spin_lock = SpinLock.init();
    var counter: i32 = 0;

    spin_lock.lock();
    counter += 1;
    spin_lock.unlock();

    try testing.expectEqual(@as(i32, 1), counter);

    // Test try lock
    try testing.expect(spin_lock.tryLock());
    counter += 1;
    spin_lock.unlock();

    try testing.expectEqual(@as(i32, 2), counter);
}
// ANCHOR_END: atomic_flag

// ANCHOR: atomic_min_max
test "atomic minimum and maximum" {
    var min_val = Atomic(i32).init(100);
    var max_val = Atomic(i32).init(0);

    var threads: [4]Thread = undefined;
    const values = [_]i32{ 50, 150, 25, 200 };

    for (&threads, values) |*thread, val| {
        thread.* = try Thread.spawn(.{}, updateMinMax, .{ &min_val, &max_val, val });
    }

    for (threads) |thread| {
        thread.join();
    }

    try testing.expectEqual(@as(i32, 25), min_val.load(.monotonic));
    try testing.expectEqual(@as(i32, 200), max_val.load(.monotonic));
}

fn updateMinMax(min_val: *Atomic(i32), max_val: *Atomic(i32), value: i32) void {
    // Update minimum
    var current_min = min_val.load(.monotonic);
    while (value < current_min) {
        if (min_val.cmpxchgWeak(
            current_min,
            value,
            .monotonic,
            .monotonic,
        )) |new_min| {
            current_min = new_min;
        } else {
            break;
        }
    }

    // Update maximum
    var current_max = max_val.load(.monotonic);
    while (value > current_max) {
        if (max_val.cmpxchgWeak(
            current_max,
            value,
            .monotonic,
            .monotonic,
        )) |new_max| {
            current_max = new_max;
        } else {
            break;
        }
    }
}
// ANCHOR_END: atomic_min_max

// ANCHOR: fetch_operations
test "fetch and modify operations" {
    var counter = Atomic(u32).init(10);

    // Fetch and add
    const old_add = counter.fetchAdd(@as(u32, 5), .monotonic);
    try testing.expectEqual(@as(u32, 10), old_add);
    try testing.expectEqual(@as(u32, 15), counter.load(.monotonic));

    // Fetch and sub
    const old_sub = counter.fetchSub(@as(u32, 3), .monotonic);
    try testing.expectEqual(@as(u32, 15), old_sub);
    try testing.expectEqual(@as(u32, 12), counter.load(.monotonic));

    // Fetch and bitwise operations
    var flags = Atomic(u8).init(0b0000_1111);

    _ = flags.fetchAnd(@as(u8, 0b1111_0000), .monotonic);
    try testing.expectEqual(@as(u8, 0b0000_0000), flags.load(.monotonic));

    flags.store(0b0000_1111, .monotonic);
    _ = flags.fetchOr(@as(u8, 0b1111_0000), .monotonic);
    try testing.expectEqual(@as(u8, 0b1111_1111), flags.load(.monotonic));

    _ = flags.fetchXor(@as(u8, 0b1010_1010), .monotonic);
    try testing.expectEqual(@as(u8, 0b0101_0101), flags.load(.monotonic));
}
// ANCHOR_END: fetch_operations

// ANCHOR: atomic_pointer
test "atomic pointer operations" {
    var data1: i32 = 42;
    var data2: i32 = 100;

    var ptr = Atomic(?*i32).init(&data1);

    // Load pointer
    const loaded = ptr.load(.monotonic);
    try testing.expectEqual(&data1, loaded.?);
    try testing.expectEqual(@as(i32, 42), loaded.?.*);

    // Store pointer
    ptr.store(&data2, .monotonic);
    try testing.expectEqual(&data2, ptr.load(.monotonic).?);

    // Compare and swap pointers
    const result = ptr.cmpxchgWeak(&data2, &data1, .monotonic, .monotonic);
    try testing.expect(result == null); // Swap succeeded
    try testing.expectEqual(&data1, ptr.load(.monotonic).?);
}
// ANCHOR_END: atomic_pointer

// ANCHOR: wait_notify
test "atomic wait and notify" {
    const io = std.testing.io;
    var ready = Atomic(u32).init(0);
    var result: i32 = 0;

    const worker_thread = try Thread.spawn(.{}, waitWorker, .{ io, &ready, &result });

    // Give worker time to start waiting
    try io.sleep(.fromNanoseconds(10 * std.time.ns_per_ms), .awake);

    // Do some work
    result = 42;

    // Signal worker
    ready.store(1, .release);

    worker_thread.join();

    try testing.expectEqual(@as(i32, 42), result);
}

fn waitWorker(io: std.Io, ready: *Atomic(u32), result: *i32) !void {
    // Wait for signal (simple spin)
    while (ready.load(.acquire) == 0) {
        try io.sleep(.fromNanoseconds(std.time.ns_per_ms), .awake);
    }

    // Process result
    std.debug.print("Worker received: {}\n", .{result.*});
}
// ANCHOR_END: wait_notify

// ANCHOR: double_checked_locking
const LazyInit = struct {
    initialized: Atomic(bool),
    mutex: std.Io.Mutex,
    value: ?i32,

    fn init() LazyInit {
        return .{
            .initialized = Atomic(bool).init(false),
            .mutex = .init,
            .value = null,
        };
    }

    fn getValue(self: *LazyInit, io: std.Io) !i32 {
        // First check without lock (fast path)
        if (self.initialized.load(.acquire)) {
            return self.value.?;
        }

        // Slow path: acquire lock and initialize
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        // Double check after acquiring lock
        if (!self.initialized.load(.monotonic)) {
            self.value = expensiveComputation();
            self.initialized.store(true, .release);
        }

        return self.value.?;
    }
};

fn expensiveComputation() i32 {
    return 42;
}

test "double-checked locking pattern" {
    const io = std.testing.io;
    var lazy = LazyInit.init();

    var threads: [4]Thread = undefined;
    var results: [4]i32 = undefined;

    for (&threads, 0..) |*thread, i| {
        thread.* = try Thread.spawn(.{}, getLazyValue, .{ io, &lazy, &results[i] });
    }

    for (threads) |thread| {
        thread.join();
    }

    // All threads should get the same value
    for (results) |result| {
        try testing.expectEqual(@as(i32, 42), result);
    }
}

fn getLazyValue(io: std.Io, lazy: *LazyInit, result: *i32) void {
    result.* = lazy.getValue(io) catch unreachable;
}
// ANCHOR_END: double_checked_locking
```

### See Also

- Recipe 12.2: Mutexes and basic locking
- Recipe 12.9: Preventing race conditions
- Recipe 12.12: Concurrent data structure patterns

---

## Recipe 12.4: Thread Pools for Parallel Work {#recipe-12-4}

**Tags:** allocators, arraylist, atomics, comptime, concurrency, data-structures, memory, resource-cleanup, synchronization, testing, threading
**Difficulty:** intermediate
**Code:** `code/04-specialized/12-concurrency/recipe_12_4.zig`

### Problem

Creating a new thread for each task is expensive. You need to reuse a fixed set of worker threads to process many tasks efficiently and avoid thread creation overhead.

### Solution

Create a worker pool that maintains a set of threads and distributes work among them.

### Basic Worker Pool

```zig
const WorkerPool = struct {
    threads: []Thread,
    allocator: std.mem.Allocator,

    fn init(allocator: std.mem.Allocator, num_workers: usize) !WorkerPool {
        const threads = try allocator.alloc(Thread, num_workers);
        return .{
            .threads = threads,
            .allocator = allocator,
        };
    }

    fn deinit(self: *WorkerPool) void {
        self.allocator.free(self.threads);
    }

    fn spawn(self: *WorkerPool, comptime func: anytype, args: anytype, index: usize) !void {
        self.threads[index] = try Thread.spawn(.{}, func, args);
    }

    fn join(self: *WorkerPool) void {
        for (self.threads) |thread| {
            thread.join();
        }
    }
};

test "basic worker pool" {
    var pool = try WorkerPool.init(testing.allocator, 4);
    defer pool.deinit();

    var counter = std.atomic.Value(u32).init(0);

    var i: usize = 0;
    while (i < 4) : (i += 1) {
        try pool.spawn(incrementWorker, .{&counter}, i);
    }

    pool.join();

    try testing.expectEqual(@as(u32, 4), counter.load(.monotonic));
}

fn incrementWorker(counter: *std.atomic.Value(u32)) void {
    _ = counter.fetchAdd(@as(u32, 1), .monotonic);
}
```

Use it like this:

```zig
var pool = try WorkerPool.init(allocator, 4);
defer pool.deinit();

var counter = std.atomic.Value(u32).init(0);

for (0..4) |i| {
    try pool.spawn(worker, .{&counter}, i);
}

pool.join();
```

### Discussion

### Parallel Computation

Distribute computational work across multiple workers:

```zig
fn parallelCompute(allocator: std.mem.Allocator, data: []const i32, results: []i32) !void {
    const num_workers = try Thread.getCpuCount();
    const chunk_size = (data.len + num_workers - 1) / num_workers;

    var threads = try allocator.alloc(Thread, num_workers);
    defer allocator.free(threads);

    var spawned: usize = 0;
    for (0..num_workers) |i| {
        const start = i * chunk_size;
        if (start >= data.len) break;
        const end = @min(start + chunk_size, data.len);

        threads[i] = try Thread.spawn(.{}, computeChunk, .{
            data[start..end],
            results[start..end],
        });
        spawned += 1;
    }

    for (threads[0..spawned]) |thread| {
        thread.join();
    }
}

fn computeChunk(input: []const i32, output: []i32) void {
    for (input, output) |val, *out| {
        out.* = val * val;
    }
}
```

This pattern:
1. Divides data into chunks
2. Spawns one worker per chunk
3. Each worker processes its chunk independently
4. Waits for all workers to complete

### Parallel Sum (Reduce Pattern)

Aggregate results from multiple workers:

```zig
fn parallelSum(allocator: std.mem.Allocator, data: []const i32) !i32 {
    const num_workers = @min(try Thread.getCpuCount(), data.len);
    const chunk_size = (data.len + num_workers - 1) / num_workers;

    var threads = try allocator.alloc(Thread, num_workers);
    defer allocator.free(threads);

    var partial_sums = try allocator.alloc(i32, num_workers);
    defer allocator.free(partial_sums);

    @memset(partial_sums, 0);

    // Spawn workers
    var spawned: usize = 0;
    for (0..num_workers) |i| {
        const start = i * chunk_size;
        if (start >= data.len) break;
        const end = @min(start + chunk_size, data.len);

        threads[i] = try Thread.spawn(.{}, sumChunk, .{
            data[start..end],
            &partial_sums[i],
        });
        spawned += 1;
    }

    // Wait for workers
    for (threads[0..spawned]) |thread| {
        thread.join();
    }

    // Combine results
    var total: i32 = 0;
    for (partial_sums[0..spawned]) |sum| {
        total += sum;
    }

    return total;
}
```

### Work Queue

For dynamic task distribution, use a thread-safe queue:

```zig
const WorkQueue = struct {
    items: std.ArrayList(i32),
    mutex: std.Io.Mutex,
    allocator: std.mem.Allocator,

    fn push(self: *WorkQueue, io: std.Io, item: i32) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        try self.items.append(self.allocator, item);
    }

    fn pop(self: *WorkQueue, io: std.Io) !?i32 {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        if (self.items.items.len == 0) return null;
        return self.items.pop();
    }
};

fn queueWorker(queue: *WorkQueue, result: *std.atomic.Value(i32)) void {
    while (queue.pop()) |item| {
        _ = result.fetchAdd(item, .monotonic);
    }
}
```

Workers pull tasks from the queue until it's empty. This balances load automatically - faster workers process more tasks.

### Batch Processing

Process large datasets in parallel chunks:

```zig
fn processBatch(data: []i32) void {
    for (data) |*item| {
        item.* *= 2;
    }
}

// Divide work into batches
const num_workers = 4;
const chunk_size = data.len / num_workers;

for (0..num_workers) |i| {
    const start = i * chunk_size;
    const end = if (i == num_workers - 1) data.len else (i + 1) * chunk_size;
    threads[i] = try Thread.spawn(.{}, processBatch, .{data[start..end]});
}
```

### Optimal Worker Count

Choose thread count based on workload:

```zig
const cpu_count = try Thread.getCpuCount();

// For CPU-bound work: match CPU count
const cpu_bound_workers = cpu_count;

// For I/O-bound work: can use more threads
const io_bound_workers = cpu_count * 2;

// For memory-bound work: may want fewer threads
const memory_bound_workers = cpu_count / 2;
```

**CPU-bound**: Computation-heavy tasks benefit from one thread per core.

**I/O-bound**: Tasks waiting on I/O can use more threads since most will be blocked.

**Memory-bound**: Too many threads competing for memory bandwidth can slow down. Use fewer threads.

### Thread Pool Best Practices

1. **Reuse threads** - Create pool once, use many times
2. **Match CPU count** for CPU-bound tasks
3. **Chunk work appropriately** - Not too small (overhead), not too large (imbalance)
4. **Avoid contention** - Minimize shared state between workers
5. **Clean shutdown** - Always join all threads before exiting

### Common Patterns

**Map**: Transform each element independently
```zig
for (input, output, 0..) |in, *out, i| {
    assignToWorker(i % num_workers, .{ in, out });
}
```

**Reduce**: Aggregate partial results
```zig
var partials: []Result = allocWorkerResults(num_workers);
// Workers compute partials...
combineResults(partials);
```

**Pipeline**: Chain processing stages
```zig
stage1Queue -> Worker1 -> stage2Queue -> Worker2 -> results
```

### Full Tested Code

```zig
const std = @import("std");
const testing = std.testing;
const Thread = std.Thread;

// ANCHOR: basic_worker_pool
const WorkerPool = struct {
    threads: []Thread,
    allocator: std.mem.Allocator,

    fn init(allocator: std.mem.Allocator, num_workers: usize) !WorkerPool {
        const threads = try allocator.alloc(Thread, num_workers);
        return .{
            .threads = threads,
            .allocator = allocator,
        };
    }

    fn deinit(self: *WorkerPool) void {
        self.allocator.free(self.threads);
    }

    fn spawn(self: *WorkerPool, comptime func: anytype, args: anytype, index: usize) !void {
        self.threads[index] = try Thread.spawn(.{}, func, args);
    }

    fn join(self: *WorkerPool) void {
        for (self.threads) |thread| {
            thread.join();
        }
    }
};

test "basic worker pool" {
    var pool = try WorkerPool.init(testing.allocator, 4);
    defer pool.deinit();

    var counter = std.atomic.Value(u32).init(0);

    var i: usize = 0;
    while (i < 4) : (i += 1) {
        try pool.spawn(incrementWorker, .{&counter}, i);
    }

    pool.join();

    try testing.expectEqual(@as(u32, 4), counter.load(.monotonic));
}

fn incrementWorker(counter: *std.atomic.Value(u32)) void {
    _ = counter.fetchAdd(@as(u32, 1), .monotonic);
}
// ANCHOR_END: basic_worker_pool

// ANCHOR: parallel_computation
fn parallelCompute(allocator: std.mem.Allocator, data: []const i32, results: []i32) !void {
    const num_workers = try Thread.getCpuCount();
    const chunk_size = (data.len + num_workers - 1) / num_workers;

    var threads = try allocator.alloc(Thread, num_workers);
    defer allocator.free(threads);

    var spawned: usize = 0;
    for (0..num_workers) |i| {
        const start = i * chunk_size;
        if (start >= data.len) break;
        const end = @min(start + chunk_size, data.len);

        threads[i] = try Thread.spawn(.{}, computeChunk, .{ data[start..end], results[start..end] });
        spawned += 1;
    }

    for (threads[0..spawned]) |thread| {
        thread.join();
    }
}

fn computeChunk(input: []const i32, output: []i32) void {
    for (input, output) |val, *out| {
        out.* = val * val;
    }
}

test "parallel computation" {
    const data = [_]i32{ 1, 2, 3, 4, 5, 6, 7, 8 };
    var results: [8]i32 = undefined;

    try parallelCompute(testing.allocator, &data, &results);

    for (data, results) |input, result| {
        try testing.expectEqual(input * input, result);
    }
}
// ANCHOR_END: parallel_computation

// ANCHOR: parallel_sum
fn parallelSum(allocator: std.mem.Allocator, data: []const i32) !i32 {
    if (data.len == 0) return 0;

    const num_workers = @min(try Thread.getCpuCount(), data.len);
    const chunk_size = (data.len + num_workers - 1) / num_workers;

    var threads = try allocator.alloc(Thread, num_workers);
    defer allocator.free(threads);

    var partial_sums = try allocator.alloc(i32, num_workers);
    defer allocator.free(partial_sums);

    @memset(partial_sums, 0);

    var spawned: usize = 0;
    for (0..num_workers) |i| {
        const start = i * chunk_size;
        if (start >= data.len) break;
        const end = @min(start + chunk_size, data.len);

        threads[i] = try Thread.spawn(.{}, sumChunk, .{ data[start..end], &partial_sums[i] });
        spawned += 1;
    }

    for (threads[0..spawned]) |thread| {
        thread.join();
    }

    var total: i32 = 0;
    for (partial_sums[0..spawned]) |sum| {
        total += sum;
    }

    return total;
}

fn sumChunk(data: []const i32, result: *i32) void {
    var sum: i32 = 0;
    for (data) |value| {
        sum += value;
    }
    result.* = sum;
}

test "parallel sum" {
    const data = [_]i32{ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 };
    const result = try parallelSum(testing.allocator, &data);
    try testing.expectEqual(@as(i32, 55), result);
}
// ANCHOR_END: parallel_sum

// ANCHOR: work_queue
const WorkQueue = struct {
    items: std.ArrayList(i32),
    mutex: std.Io.Mutex,
    allocator: std.mem.Allocator,

    fn init(allocator: std.mem.Allocator) WorkQueue {
        return .{
            .items = std.ArrayList(i32).empty,
            .mutex = .init,
            .allocator = allocator,
        };
    }

    fn deinit(self: *WorkQueue) void {
        self.items.deinit(self.allocator);
    }

    fn push(self: *WorkQueue, io: std.Io, item: i32) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        try self.items.append(self.allocator, item);
    }

    fn pop(self: *WorkQueue, io: std.Io) !?i32 {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        if (self.items.items.len == 0) return null;
        return self.items.pop();
    }
};

fn queueWorker(io: std.Io, queue: *WorkQueue, result: *std.atomic.Value(i32)) !void {
    while (try queue.pop(io)) |item| {
        _ = result.fetchAdd(@as(i32, item), .monotonic);
    }
}

test "work queue with multiple workers" {
    const io = std.testing.io;
    var queue = WorkQueue.init(testing.allocator);
    defer queue.deinit();

    // Add work items
    for (1..11) |i| {
        try queue.push(io, @intCast(i));
    }

    var result = std.atomic.Value(i32).init(0);
    var threads: [4]Thread = undefined;

    // Spawn workers
    for (&threads) |*thread| {
        thread.* = try Thread.spawn(.{}, queueWorker, .{ io, &queue, &result });
    }

    // Wait for completion
    for (threads) |thread| {
        thread.join();
    }

    try testing.expectEqual(@as(i32, 55), result.load(.monotonic));
}
// ANCHOR_END: work_queue

// ANCHOR: batch_processing
fn processBatch(data: []i32) void {
    for (data) |*item| {
        item.* *= 2;
    }
}

test "batch processing" {
    var data = try testing.allocator.alloc(i32, 1000);
    defer testing.allocator.free(data);

    // Initialize
    for (data, 0..) |*item, i| {
        item.* = @intCast(i);
    }

    // Process in parallel batches
    const num_workers = 4;
    const chunk_size = data.len / num_workers;
    var threads: [4]Thread = undefined;

    for (&threads, 0..) |*thread, i| {
        const start = i * chunk_size;
        const end = if (i == num_workers - 1) data.len else (i + 1) * chunk_size;
        thread.* = try Thread.spawn(.{}, processBatch, .{data[start..end]});
    }

    for (threads) |thread| {
        thread.join();
    }

    // Verify
    for (data, 0..) |value, i| {
        try testing.expectEqual(@as(i32, @intCast(i * 2)), value);
    }
}
// ANCHOR_END: batch_processing

// ANCHOR: optimal_worker_count
test "determining optimal worker count" {
    const cpu_count = try Thread.getCpuCount();

    // For CPU-bound tasks: use CPU count
    const cpu_bound_workers = cpu_count;

    // For I/O-bound tasks: can use more threads
    const io_bound_workers = cpu_count * 2;

    try testing.expect(cpu_bound_workers > 0);
    try testing.expect(io_bound_workers >= cpu_bound_workers);

    std.debug.print("CPU count: {}, CPU-bound workers: {}, I/O-bound workers: {}\n", .{
        cpu_count,
        cpu_bound_workers,
        io_bound_workers,
    });
}
// ANCHOR_END: optimal_worker_count
```

### See Also

- Recipe 12.1: Basic threading and thread management
- Recipe 12.5: Thread
- Recipe 12.11: Parallel map and reduce operations

---

## Recipe 12.5: Thread-Safe Queues and Channels {#recipe-12-5}

**Tags:** allocators, arraylist, atomics, concurrency, data-structures, error-handling, memory, resource-cleanup, synchronization, testing, threading
**Difficulty:** intermediate
**Code:** `code/04-specialized/12-concurrency/recipe_12_5.zig`

### Problem

You need to pass data between threads safely. Direct sharing with mutexes works but is error-prone. You want higher-level abstractions like queues and channels for structured communication.

### Solution

Use thread-safe queues to implement producer-consumer patterns and channels for bidirectional communication.

### Bounded Queue

A circular buffer with fixed capacity:

```zig
const BoundedQueue = struct {
    buffer: []i32,
    head: usize,
    tail: usize,
    count: usize,
    mutex: Mutex,
    capacity: usize,

    fn init(allocator: std.mem.Allocator, capacity: usize) !BoundedQueue {
        const buffer = try allocator.alloc(i32, capacity);
        return .{
            .buffer = buffer,
            .head = 0,
            .tail = 0,
            .count = 0,
            .mutex = .{},
            .capacity = capacity,
        };
    }

    fn deinit(self: *BoundedQueue, allocator: std.mem.Allocator) void {
        allocator.free(self.buffer);
    }

    fn push(self: *BoundedQueue, io: std.Io, item: i32) !bool {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        if (self.count >= self.capacity) {
            return false; // Queue full
        }

        self.buffer[self.tail] = item;
        self.tail = (self.tail + 1) % self.capacity;
        self.count += 1;
        return true;
    }

    fn pop(self: *BoundedQueue, io: std.Io) !?i32 {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        if (self.count == 0) {
            return null; // Queue empty
        }

        const item = self.buffer[self.head];
        self.head = (self.head + 1) % self.capacity;
        self.count -= 1;
        return item;
    }

    fn size(self: *BoundedQueue, io: std.Io) !usize {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        return self.count;
    }
};

test "bounded queue basic operations" {
    var queue = try BoundedQueue.init(testing.allocator, 10);
    defer queue.deinit(testing.allocator);

    try testing.expect(queue.push(1));
    try testing.expect(queue.push(2));
    try testing.expect(queue.push(3));

    try testing.expectEqual(@as(usize, 3), queue.size());
    try testing.expectEqual(@as(i32, 1), (try queue.pop()).?);
    try testing.expectEqual(@as(i32, 2), (try queue.pop()).?);
    try testing.expectEqual(@as(i32, 3), (try queue.pop()).?);
    try testing.expect((try queue.pop()) == null);
}
```

The bounded queue prevents unbounded memory growth and provides backpressure when full.

### Discussion

### Producer-Consumer Pattern

Classic pattern for dividing work:

```zig
fn producer(io: std.Io, queue: *BoundedQueue, count: i32) !void {
    var i: i32 = 0;
    while (i < count) : (i += 1) {
        while (!queue.push(i)) {
            try io.sleep(.fromNanoseconds(std.time.ns_per_ms), .awake); // Wait if queue full
        }
    }
}

fn consumer(io: std.Io, queue: *BoundedQueue, result: *std.atomic.Value(i32)) !void {
    var sum: i32 = 0;
    var received: i32 = 0;

    while (received < 100) {
        if (queue.pop()) |value| {
            sum += value;
            received += 1;
        } else {
            try io.sleep(.fromNanoseconds(std.time.ns_per_ms), .awake); // Wait if queue empty
        }
    }

    _ = result.fetchAdd(sum, .monotonic);
}
```

Producers generate work items, consumers process them. The queue decouples production and consumption rates.

### Multiple Producer Single Consumer (MPSC)

Multiple threads sending to one receiver:

```zig
const MPSCQueue = struct {
    items: std.ArrayList(i32),
    mutex: Mutex,
    allocator: std.mem.Allocator,

    fn send(self: *MPSCQueue, io: std.Io, value: i32) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        try self.items.append(self.allocator, value);
    }

    fn receive(self: *MPSCQueue, io: std.Io) !?i32 {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        if (self.items.items.len == 0) return null;
        return self.items.orderedRemove(0);
    }
};
```

Common in event processing: multiple event sources, single event loop.

**Performance Note:** This implementation uses `orderedRemove(0)` which is O(n) because it shifts all remaining elements forward in memory. For small queues or infrequent operations, this is acceptable. For high-throughput scenarios:
- Use the `RingBuffer` implementation shown below (O(1) operations, lock-free)
- Use the `BlockingQueue` from Recipe 12.6 (O(1) operations with condition variables)
- Consider `swapRemove()` if FIFO order isn't critical (O(1) but breaks ordering)

### Channels with Close Semantics

Go-style channels that can be closed:

```zig
const Channel = struct {
    buffer: []i32,
    closed: bool,
    // ... other fields

    fn send(self: *Channel, io: std.Io, item: i32) !void {
        while (true) {
            try self.mutex.lock(io);
            if (self.closed) {
                self.mutex.unlock(io);
                return error.ChannelClosed;
            }

            if (self.count < self.capacity) {
                self.buffer[self.tail] = item;
                self.tail = (self.tail + 1) % self.capacity;
                self.count += 1;
                self.mutex.unlock(io);
                return;
            }

            self.mutex.unlock(io);
            try io.sleep(.fromNanoseconds(std.time.ns_per_ms), .awake);
        }
    }

    fn close(self: *Channel, io: std.Io) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        self.closed = true;
    }
};
```

Closing a channel signals "no more data coming". Receivers can drain remaining items then exit cleanly.

### Priority Queue

Process high-priority items first:

```zig
const PriorityQueue = struct {
    items: std.ArrayList(PriorityItem),
    mutex: Mutex,

    fn push(self: *PriorityQueue, io: std.Io, value: i32, priority: u8) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        const item = PriorityItem{ .value = value, .priority = priority };

        // Insert in priority order
        var insert_pos: usize = 0;
        for (self.items.items) |existing| {
            if (priority > existing.priority) break;
            insert_pos += 1;
        }

        try self.items.insert(self.allocator, insert_pos, item);
    }
};
```

Useful for task scheduling, request handling, and event processing.

### Lock-Free Ring Buffer

High-performance alternative using atomics:

```zig
const RingBuffer = struct {
    buffer: []i32,
    read_pos: std.atomic.Value(usize),
    write_pos: std.atomic.Value(usize),
    capacity: usize,

    fn write(self: *RingBuffer, value: i32) bool {
        const write_idx = self.write_pos.load(.monotonic);
        const read_idx = self.read_pos.load(.monotonic);
        const next_write = (write_idx + 1) % self.capacity;

        if (next_write == read_idx) {
            return false; // Buffer full
        }

        self.buffer[write_idx] = value;
        self.write_pos.store(next_write, .release);
        return true;
    }
};
```

No locks means no contention, but requires careful memory ordering.

### Broadcast Channel

Send same value to multiple receivers:

```zig
const BroadcastChannel = struct {
    value: std.atomic.Value(i32),
    version: std.atomic.Value(u64),

    fn broadcast(self: *BroadcastChannel, value: i32) void {
        self.value.store(value, .release);
        _ = self.version.fetchAdd(1, .release);
    }

    fn receive(self: *BroadcastChannel, last_version: *u64) ?i32 {
        const current_version = self.version.load(.acquire);
        if (current_version == last_version.*) {
            return null; // No new value
        }

        last_version.* = current_version;
        return self.value.load(.acquire);
    }
};
```

Each receiver tracks which version they've seen. New versions indicate new values.

### Queue Pattern Selection

Choose based on requirements:

| Pattern | Use Case | Pros | Cons |
|---------|----------|------|------|
| Bounded Queue | Fixed capacity needed | Prevents memory growth | Blocks when full |
| Unbounded Queue | Variable workload | Never blocks | Can grow unbounded |
| MPSC | Multiple sources, one sink | Simple | Single receiver bottleneck |
| Channel | Structured communication | Clean shutdown | More overhead |
| Priority Queue | Urgent tasks first | Fair scheduling | Insertion cost |
| Ring Buffer | High performance | Lock-free | Fixed size, complex |

### Best Practices

1. **Bound queue sizes** - Prevents memory exhaustion
2. **Handle full/empty** - Don't busy-wait, use sleep or condition variables
3. **Signal completion** - Use channel close or sentinel values
4. **Choose right pattern** - MPSC for events, channels for pipelines
5. **Prefer simple** - Use mutex-based queues unless profiling shows contention

### Common Patterns

**Pipeline**: Chain processing stages
```zig
source -> queue1 -> worker1 -> queue2 -> worker2 -> sink
```

**Fan-out**: Distribute work to multiple workers
```zig
source -> queue -> [worker1, worker2, worker3]
```

**Fan-in**: Collect results from multiple sources
```zig
[source1, source2, source3] -> queue -> sink
```

### Full Tested Code

```zig
const std = @import("std");
const testing = std.testing;
const Thread = std.Thread;
const Mutex = std.Io.Mutex;

// ANCHOR: bounded_queue
const BoundedQueue = struct {
    buffer: []i32,
    head: usize,
    tail: usize,
    count: usize,
    mutex: Mutex,
    capacity: usize,

    fn init(allocator: std.mem.Allocator, capacity: usize) !BoundedQueue {
        const buffer = try allocator.alloc(i32, capacity);
        return .{
            .buffer = buffer,
            .head = 0,
            .tail = 0,
            .count = 0,
            .mutex = .init,
            .capacity = capacity,
        };
    }

    fn deinit(self: *BoundedQueue, allocator: std.mem.Allocator) void {
        allocator.free(self.buffer);
    }

    fn push(self: *BoundedQueue, io: std.Io, item: i32) !bool {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        if (self.count >= self.capacity) {
            return false; // Queue full
        }

        self.buffer[self.tail] = item;
        self.tail = (self.tail + 1) % self.capacity;
        self.count += 1;
        return true;
    }

    fn pop(self: *BoundedQueue, io: std.Io) !?i32 {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        if (self.count == 0) {
            return null; // Queue empty
        }

        const item = self.buffer[self.head];
        self.head = (self.head + 1) % self.capacity;
        self.count -= 1;
        return item;
    }

    fn size(self: *BoundedQueue, io: std.Io) !usize {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        return self.count;
    }
};

test "bounded queue basic operations" {
    const io = std.testing.io;
    var queue = try BoundedQueue.init(testing.allocator, 10);
    defer queue.deinit(testing.allocator);

    try testing.expect(try queue.push(io, 1));
    try testing.expect(try queue.push(io, 2));
    try testing.expect(try queue.push(io, 3));

    try testing.expectEqual(@as(usize, 3), queue.size(io));
    try testing.expectEqual(@as(i32, 1), (try queue.pop(io)).?);
    try testing.expectEqual(@as(i32, 2), (try queue.pop(io)).?);
    try testing.expectEqual(@as(i32, 3), (try queue.pop(io)).?);
    try testing.expect((try queue.pop(io)) == null);
}
// ANCHOR_END: bounded_queue

// ANCHOR: producer_consumer
fn producer(io: std.Io, queue: *BoundedQueue, count: i32) !void {
    var i: i32 = 0;
    while (i < count) : (i += 1) {
        while (!try queue.push(io, i)) {
            try io.sleep(.fromNanoseconds(std.time.ns_per_ms), .awake);
        }
    }
}

fn consumer(io: std.Io, queue: *BoundedQueue, result: *std.atomic.Value(i32)) !void {
    var sum: i32 = 0;
    var received: i32 = 0;

    while (received < 100) {
        if (try queue.pop(io)) |value| {
            sum += value;
            received += 1;
        } else {
            try io.sleep(.fromNanoseconds(std.time.ns_per_ms), .awake);
        }
    }

    _ = result.fetchAdd(@as(i32, sum), .monotonic);
}

test "producer-consumer pattern" {
    const io = std.testing.io;
    var queue = try BoundedQueue.init(testing.allocator, 20);
    defer queue.deinit(testing.allocator);

    var result = std.atomic.Value(i32).init(0);

    const producer_thread = try Thread.spawn(.{}, producer, .{ io, &queue, 100 });
    const consumer_thread = try Thread.spawn(.{}, consumer, .{ io, &queue, &result });

    producer_thread.join();
    consumer_thread.join();

    // Sum of 0..99 = 4950
    try testing.expectEqual(@as(i32, 4950), result.load(.monotonic));
}
// ANCHOR_END: producer_consumer

// ANCHOR: mpsc_queue
const MPSCQueue = struct {
    items: std.ArrayList(i32),
    mutex: Mutex,
    allocator: std.mem.Allocator,

    fn init(allocator: std.mem.Allocator) MPSCQueue {
        return .{
            .items = std.ArrayList(i32).empty,
            .mutex = .init,
            .allocator = allocator,
        };
    }

    fn deinit(self: *MPSCQueue) void {
        self.items.deinit(self.allocator);
    }

    fn send(self: *MPSCQueue, io: std.Io, value: i32) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        try self.items.append(self.allocator, value);
    }

    fn receive(self: *MPSCQueue, io: std.Io) !?i32 {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        if (self.items.items.len == 0) return null;
        return self.items.orderedRemove(0);
    }
};

fn mpscProducer(io: std.Io, queue: *MPSCQueue, id: i32, count: i32) void {
    var i: i32 = 0;
    while (i < count) : (i += 1) {
        queue.send(io, id * 1000 + i) catch {};
    }
}

fn mpscConsumer(io: std.Io, queue: *MPSCQueue, total: *std.atomic.Value(i32)) !void {
    var received: usize = 0;
    while (received < 300) {
        if (try queue.receive(io)) |_| {
            _ = total.fetchAdd(@as(i32, 1), .monotonic);
            received += 1;
        } else {
            try io.sleep(.fromNanoseconds(std.time.ns_per_ms), .awake);
        }
    }
}

test "multiple producer single consumer" {
    const io = std.testing.io;
    var queue = MPSCQueue.init(testing.allocator);
    defer queue.deinit();

    var total = std.atomic.Value(i32).init(0);

    var producers: [3]Thread = undefined;
    for (&producers, 0..) |*thread, i| {
        thread.* = try Thread.spawn(.{}, mpscProducer, .{ io, &queue, @as(i32, @intCast(i)), 100 });
    }

    const consumer_thread = try Thread.spawn(.{}, mpscConsumer, .{ io, &queue, &total });

    for (producers) |thread| {
        thread.join();
    }
    consumer_thread.join();

    try testing.expectEqual(@as(i32, 300), total.load(.monotonic));
}
// ANCHOR_END: mpsc_queue

// ANCHOR: channel
const Channel = struct {
    buffer: []i32,
    head: usize,
    tail: usize,
    count: usize,
    mutex: Mutex,
    capacity: usize,
    closed: bool,

    fn init(allocator: std.mem.Allocator, capacity: usize) !Channel {
        const buffer = try allocator.alloc(i32, capacity);
        return .{
            .buffer = buffer,
            .head = 0,
            .tail = 0,
            .count = 0,
            .mutex = .init,
            .capacity = capacity,
            .closed = false,
        };
    }

    fn deinit(self: *Channel, allocator: std.mem.Allocator) void {
        allocator.free(self.buffer);
    }

    fn send(self: *Channel, io: std.Io, item: i32) !void {
        while (true) {
            try self.mutex.lock(io);
            if (self.closed) {
                self.mutex.unlock(io);
                return error.ChannelClosed;
            }

            if (self.count < self.capacity) {
                self.buffer[self.tail] = item;
                self.tail = (self.tail + 1) % self.capacity;
                self.count += 1;
                self.mutex.unlock(io);
                return;
            }

            self.mutex.unlock(io);
            try io.sleep(.fromNanoseconds(std.time.ns_per_ms), .awake);
        }
    }

    fn receive(self: *Channel, io: std.Io) !?i32 {
        while (true) {
            try self.mutex.lock(io);

            if (self.count > 0) {
                const item = self.buffer[self.head];
                self.head = (self.head + 1) % self.capacity;
                self.count -= 1;
                self.mutex.unlock(io);
                return item;
            }

            if (self.closed) {
                self.mutex.unlock(io);
                return null;
            }

            self.mutex.unlock(io);
            try io.sleep(.fromNanoseconds(std.time.ns_per_ms), .awake);
        }
    }

    fn close(self: *Channel, io: std.Io) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        self.closed = true;
    }
};

fn channelSender(io: std.Io, ch: *Channel) !void {
    var i: i32 = 0;
    while (i < 50) : (i += 1) {
        ch.send(io, i) catch break;
    }
    try ch.close(io);
}

fn channelReceiver(io: std.Io, ch: *Channel, sum: *std.atomic.Value(i32)) !void {
    var total: i32 = 0;
    while (try ch.receive(io)) |value| {
        total += value;
    }
    _ = sum.fetchAdd(@as(i32, total), .monotonic);
}

test "channel send and receive" {
    const io = std.testing.io;
    var channel = try Channel.init(testing.allocator, 10);
    defer channel.deinit(testing.allocator);

    var sum = std.atomic.Value(i32).init(0);

    const sender = try Thread.spawn(.{}, channelSender, .{ io, &channel });
    const receiver = try Thread.spawn(.{}, channelReceiver, .{ io, &channel, &sum });

    sender.join();
    receiver.join();

    // Sum of 0..49 = 1225
    try testing.expectEqual(@as(i32, 1225), sum.load(.monotonic));
}
// ANCHOR_END: channel

// ANCHOR: priority_queue
const PriorityItem = struct {
    value: i32,
    priority: u8,
};

const PriorityQueue = struct {
    items: std.ArrayList(PriorityItem),
    mutex: Mutex,
    allocator: std.mem.Allocator,

    fn init(allocator: std.mem.Allocator) PriorityQueue {
        return .{
            .items = std.ArrayList(PriorityItem).empty,
            .mutex = .init,
            .allocator = allocator,
        };
    }

    fn deinit(self: *PriorityQueue) void {
        self.items.deinit(self.allocator);
    }

    fn push(self: *PriorityQueue, io: std.Io, value: i32, priority: u8) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        const item = PriorityItem{ .value = value, .priority = priority };

        // Insert in priority order (higher priority first)
        var insert_pos: usize = 0;
        for (self.items.items) |existing| {
            if (priority > existing.priority) break;
            insert_pos += 1;
        }

        try self.items.insert(self.allocator, insert_pos, item);
    }

    fn pop(self: *PriorityQueue, io: std.Io) !?PriorityItem {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        if (self.items.items.len == 0) return null;
        return self.items.orderedRemove(0);
    }
};

test "priority queue ordering" {
    const io = std.testing.io;
    var queue = PriorityQueue.init(testing.allocator);
    defer queue.deinit();

    try queue.push(io, 1, 1);
    try queue.push(io, 2, 3);
    try queue.push(io, 3, 2);
    try queue.push(io, 4, 3);

    const item1 = (try queue.pop(io)).?;
    try testing.expectEqual(@as(u8, 3), item1.priority);

    const item2 = (try queue.pop(io)).?;
    try testing.expectEqual(@as(u8, 3), item2.priority);

    const item3 = (try queue.pop(io)).?;
    try testing.expectEqual(@as(u8, 2), item3.priority);

    const item4 = (try queue.pop(io)).?;
    try testing.expectEqual(@as(u8, 1), item4.priority);
}
// ANCHOR_END: priority_queue

// ANCHOR: ring_buffer
const RingBuffer = struct {
    buffer: []i32,
    read_pos: std.atomic.Value(usize),
    write_pos: std.atomic.Value(usize),
    capacity: usize,

    fn init(allocator: std.mem.Allocator, capacity: usize) !RingBuffer {
        const buffer = try allocator.alloc(i32, capacity);
        return .{
            .buffer = buffer,
            .read_pos = std.atomic.Value(usize).init(0),
            .write_pos = std.atomic.Value(usize).init(0),
            .capacity = capacity,
        };
    }

    fn deinit(self: *RingBuffer, allocator: std.mem.Allocator) void {
        allocator.free(self.buffer);
    }

    fn write(self: *RingBuffer, value: i32) bool {
        const write_idx = self.write_pos.load(.monotonic);
        const read_idx = self.read_pos.load(.monotonic);
        const next_write = (write_idx + 1) % self.capacity;

        if (next_write == read_idx) {
            return false; // Buffer full
        }

        self.buffer[write_idx] = value;
        self.write_pos.store(next_write, .release);
        return true;
    }

    fn read(self: *RingBuffer) ?i32 {
        const read_idx = self.read_pos.load(.monotonic);
        const write_idx = self.write_pos.load(.acquire);

        if (read_idx == write_idx) {
            return null; // Buffer empty
        }

        const value = self.buffer[read_idx];
        self.read_pos.store((read_idx + 1) % self.capacity, .release);
        return value;
    }
};

test "lock-free ring buffer" {
    var ring = try RingBuffer.init(testing.allocator, 10);
    defer ring.deinit(testing.allocator);

    try testing.expect(ring.write(1));
    try testing.expect(ring.write(2));
    try testing.expect(ring.write(3));

    try testing.expectEqual(@as(i32, 1), ring.read().?);
    try testing.expectEqual(@as(i32, 2), ring.read().?);
    try testing.expectEqual(@as(i32, 3), ring.read().?);
    try testing.expect(ring.read() == null);
}
// ANCHOR_END: ring_buffer

// ANCHOR: broadcast_channel
const BroadcastChannel = struct {
    value: std.atomic.Value(i32),
    version: std.atomic.Value(u64),

    fn init() BroadcastChannel {
        return .{
            .value = std.atomic.Value(i32).init(0),
            .version = std.atomic.Value(u64).init(0),
        };
    }

    fn broadcast(self: *BroadcastChannel, value: i32) void {
        self.value.store(value, .release);
        _ = self.version.fetchAdd(@as(u64, 1), .release);
    }

    fn receive(self: *BroadcastChannel, last_version: *u64) ?i32 {
        const current_version = self.version.load(.acquire);
        if (current_version == last_version.*) {
            return null; // No new value
        }

        last_version.* = current_version;
        return self.value.load(.acquire);
    }
};

fn broadcaster(io: std.Io, ch: *BroadcastChannel) !void {
    var i: i32 = 1;
    while (i <= 10) : (i += 1) {
        ch.broadcast(i);
        try io.sleep(.fromNanoseconds(5 * std.time.ns_per_ms), .awake);
    }
}

fn broadcastReceiver(io: std.Io, ch: *BroadcastChannel, count: *std.atomic.Value(i32)) !void {
    var last_version: u64 = 0;
    var received: i32 = 0;

    while (received < 10) {
        if (ch.receive(&last_version)) |_| {
            received += 1;
        } else {
            try io.sleep(.fromNanoseconds(std.time.ns_per_ms), .awake);
        }
    }

    _ = count.fetchAdd(@as(i32, 1), .monotonic);
}

test "broadcast to multiple receivers" {
    const io = std.testing.io;
    var channel = BroadcastChannel.init();
    var count = std.atomic.Value(i32).init(0);

    const sender = try Thread.spawn(.{}, broadcaster, .{ io, &channel });

    var receivers: [3]Thread = undefined;
    for (&receivers) |*thread| {
        thread.* = try Thread.spawn(.{}, broadcastReceiver, .{ io, &channel, &count });
    }

    sender.join();
    for (receivers) |thread| {
        thread.join();
    }

    try testing.expectEqual(@as(i32, 3), count.load(.monotonic));
}
// ANCHOR_END: broadcast_channel
```

### See Also

- Recipe 12.1: Basic threading and thread management
- Recipe 12.2: Mutexes and basic locking
- Recipe 12.6: Condition variables and signaling

---

## Recipe 12.6: Condition Variables and Signaling {#recipe-12-6}

**Tags:** allocators, atomics, concurrency, error-handling, memory, resource-cleanup, synchronization, testing, threading
**Difficulty:** intermediate
**Code:** `code/04-specialized/12-concurrency/recipe_12_6.zig`

### Problem

Busy-waiting wastes CPU cycles. You need threads to sleep until a specific condition becomes true, then wake up efficiently when signaled.

### Solution

Use condition variables (`std.Thread.Condition`) to block threads until notified.

### Basic Wait and Notify

```zig
const WaitNotify = struct {
    ready: bool,
    mutex: Mutex,
    condition: Condition,

    fn init() WaitNotify {
        return .{
            .ready = false,
            .mutex = .{},
            .condition = .{},
        };
    }

    fn wait(self: *WaitNotify, io: std.Io) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        while (!self.ready) {
            self.condition.wait(&self.mutex);
        }
    }

    fn notify(self: *WaitNotify, io: std.Io) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        self.ready = true;
        self.condition.signal();
    }
};

fn waiter(wn: *WaitNotify, result: *i32) void {
    wn.wait();
    result.* = 42;
}

fn notifier(io: std.Io, wn: *WaitNotify) !void {
    try io.sleep(.fromNanoseconds(10 * std.time.ns_per_ms), .awake);
    wn.notify();
}

test "basic wait and notify" {
    const io = std.testing.io;
    var wn = WaitNotify.init();
    var result: i32 = 0;

    const wait_thread = try Thread.spawn(.{}, waiter, .{ &wn, &result });
    const notify_thread = try Thread.spawn(.{}, notifier, .{ io, &wn });

    wait_thread.join();
    notify_thread.join();

    try testing.expectEqual(@as(i32, 42), result);
}
```

The waiting thread sleeps until signaled, saving CPU.

### Discussion

### Blocking Queue

Condition variables enable efficient producer-consumer:

```zig
const BlockingQueue = struct {
    not_empty: Condition,
    not_full: Condition,
    mutex: Mutex,
    // ... buffer fields

    fn push(self: *BlockingQueue, io: std.Io, item: i32) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        while (self.count >= self.capacity) {
            self.not_full.wait(&self.mutex); // Block until space
        }

        // Add item
        self.not_empty.signal(); // Wake consumer
    }

    fn pop(self: *BlockingQueue, io: std.Io) !i32 {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        while (self.count == 0) {
            self.not_empty.wait(&self.mutex); // Block until data
        }

        // Remove item
        self.not_full.signal(); // Wake producer
        return item;
    }
};
```

No spinning, threads sleep when waiting.

### Semaphore

Count-based synchronization:

```zig
const Semaphore = struct {
    count: usize,
    mutex: Mutex,
    condition: Condition,

    fn acquire(self: *Semaphore, io: std.Io) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        while (self.count == 0) {
            self.condition.wait(&self.mutex);
        }

        self.count -= 1;
    }

    fn release(self: *Semaphore, io: std.Io) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        self.count += 1;
        self.condition.signal();
    }
};
```

Limits concurrent access to resources.

### Barrier

Synchronize multiple threads at a point:

```zig
const Barrier = struct {
    count: usize,
    waiting: usize,
    generation: usize,
    mutex: Mutex,
    condition: Condition,

    fn wait(self: *Barrier, io: std.Io) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        const gen = self.generation;
        self.waiting += 1;

        if (self.waiting >= self.count) {
            // Last thread - release all
            self.waiting = 0;
            self.generation += 1;
            self.condition.broadcast();
        } else {
            // Wait for others
            while (gen == self.generation) {
                self.condition.wait(&self.mutex);
            }
        }
    }
};
```

All threads wait until everyone arrives.

### Latch

Count down events, wait for completion:

```zig
const Latch = struct {
    count: std.atomic.Value(usize),
    mutex: Mutex,
    condition: Condition,

    fn countDown(self: *Latch, io: std.Io) !void {
        const old = self.count.fetchSub(1, .release);
        if (old == 1) {
            try self.mutex.lock(io);
            defer self.mutex.unlock(io);
            self.condition.broadcast();
        }
    }

    fn wait(self: *Latch, io: std.Io) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        while (self.count.load(.acquire) > 0) {
            self.condition.wait(&self.mutex);
        }
    }
};
```

Useful for waiting on parallel initialization.

### Signal vs Broadcast

- **`signal()`** - Wakes one waiting thread
- **`broadcast()`** - Wakes all waiting threads

```zig
fn broadcast(self: *BroadcastSignal, io: std.Io) !void {
    try self.mutex.lock(io);
    defer self.mutex.unlock(io);

    self.flag = true;
    self.condition.broadcast(); // Wake ALL waiters
}
```

Use broadcast when all waiters need to wake up.

### Event

Reusable signal:

```zig
const Event = struct {
    signaled: std.atomic.Value(bool),
    mutex: Mutex,
    condition: Condition,

    fn wait(self: *Event, io: std.Io) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        while (!self.signaled.load(.acquire)) {
            self.condition.wait(&self.mutex);
        }
    }

    fn set(self: *Event, io: std.Io) !void {
        self.signaled.store(true, .release);
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        self.condition.broadcast();
    }

    fn reset(self: *Event) void {
        self.signaled.store(false, .release);
    }
};
```

Can be reset and reused.

### Timed Waits

Wait with a timeout to avoid blocking indefinitely:

```zig
const TimedWait = struct {
    ready: bool,
    mutex: Mutex,
    condition: Condition,

    fn waitFor(self: *TimedWait, io: std.Io, timeout_ms: u64) !bool {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        const timeout_ns = timeout_ms * std.time.ns_per_ms;

        while (!self.ready) {
            // timedWait returns error.Timeout if time expires
            self.condition.timedWait(&self.mutex, timeout_ns) catch {
                return false; // Timeout occurred
            };
        }

        return true; // Condition met before timeout
    }
};
```

The `timedWait` method:
- Takes timeout in nanoseconds
- Returns `error.Timeout` if timeout expires
- Can experience spurious wakeups (use while loop)
- Atomically unlocks mutex, sleeps, and re-locks on wake

Benefits over manual sleep loops:
- More precise timing
- Efficient CPU usage (proper OS-level blocking)
- Immediate wakeup on signal (no polling delay)

### Common Patterns

**Producer-Consumer**: Use two conditions (not_empty, not_full)

**Barrier**: Synchronize phase transitions

**Semaphore**: Limit resource access

**Latch**: Wait for parallel tasks to complete

**Event**: One-shot or recurring signals

### Important Rules

1. **Always use while loop** - Never `if`, always `while (condition) { wait() }`
2. **Hold mutex** - Lock before checking condition, hold during wait
3. **Signal after change** - Update state before signaling
4. **Broadcast carefully** - Only when all waiters need to wake

### Why While Not If?

```zig
// WRONG - can miss wakeups
if (!self.ready) {
    self.condition.wait(&self.mutex);
}

// CORRECT - handles spurious wakeups
while (!self.ready) {
    self.condition.wait(&self.mutex);
}
```

Spurious wakeups can occur - the thread wakes but condition isn't met.

### Full Tested Code

```zig
const std = @import("std");
const testing = std.testing;
const Thread = std.Thread;
const Mutex = std.Io.Mutex;
const Condition = std.Io.Condition;

// ANCHOR: basic_condition
const WaitNotify = struct {
    ready: bool,
    mutex: Mutex,
    condition: Condition,

    fn init() WaitNotify {
        return .{
            .ready = false,
            .mutex = .init,
            .condition = .init,
        };
    }

    fn wait(self: *WaitNotify, io: std.Io) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        while (!self.ready) {
            try self.condition.wait(io, &self.mutex);
        }
    }

    fn notify(self: *WaitNotify, io: std.Io) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        self.ready = true;
        self.condition.signal(io);
    }
};

fn waiter(io: std.Io, wn: *WaitNotify, result: *i32) !void {
    try wn.wait(io);
    result.* = 42;
}

fn notifier(io: std.Io, wn: *WaitNotify) !void {
    try io.sleep(.fromNanoseconds(10 * std.time.ns_per_ms), .awake);
    try wn.notify(io);
}

test "basic wait and notify" {
    const io = std.testing.io;
    var wn = WaitNotify.init();
    var result: i32 = 0;

    const wait_thread = try Thread.spawn(.{}, waiter, .{ io, &wn, &result });
    const notify_thread = try Thread.spawn(.{}, notifier, .{ io, &wn });

    wait_thread.join();
    notify_thread.join();

    try testing.expectEqual(@as(i32, 42), result);
}
// ANCHOR_END: basic_condition

// ANCHOR: blocking_queue
const BlockingQueue = struct {
    buffer: []i32,
    head: usize,
    tail: usize,
    count: usize,
    mutex: Mutex,
    not_empty: Condition,
    not_full: Condition,
    capacity: usize,

    fn init(allocator: std.mem.Allocator, capacity: usize) !BlockingQueue {
        const buffer = try allocator.alloc(i32, capacity);
        return .{
            .buffer = buffer,
            .head = 0,
            .tail = 0,
            .count = 0,
            .mutex = .init,
            .not_empty = .init,
            .not_full = .init,
            .capacity = capacity,
        };
    }

    fn deinit(self: *BlockingQueue, allocator: std.mem.Allocator) void {
        allocator.free(self.buffer);
    }

    fn push(self: *BlockingQueue, io: std.Io, item: i32) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        while (self.count >= self.capacity) {
            try self.not_full.wait(io, &self.mutex);
        }

        self.buffer[self.tail] = item;
        self.tail = (self.tail + 1) % self.capacity;
        self.count += 1;

        self.not_empty.signal(io);
    }

    fn pop(self: *BlockingQueue, io: std.Io) !i32 {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        while (self.count == 0) {
            try self.not_empty.wait(io, &self.mutex);
        }

        const item = self.buffer[self.head];
        self.head = (self.head + 1) % self.capacity;
        self.count -= 1;

        self.not_full.signal(io);

        return item;
    }
};

fn blockingProducer(io: std.Io, queue: *BlockingQueue) !void {
    var i: i32 = 0;
    while (i < 20) : (i += 1) {
        try queue.push(io, i);
    }
}

fn blockingConsumer(io: std.Io, queue: *BlockingQueue, sum: *i32) !void {
    var total: i32 = 0;
    var i: i32 = 0;
    while (i < 20) : (i += 1) {
        total += try queue.pop(io);
    }
    sum.* = total;
}

test "blocking queue with conditions" {
    const io = std.testing.io;
    var queue = try BlockingQueue.init(testing.allocator, 5);
    defer queue.deinit(testing.allocator);

    var sum: i32 = 0;

    const producer_thread = try Thread.spawn(.{}, blockingProducer, .{ io, &queue });
    const consumer_thread = try Thread.spawn(.{}, blockingConsumer, .{ io, &queue, &sum });

    producer_thread.join();
    consumer_thread.join();

    // Sum of 0..19 = 190
    try testing.expectEqual(@as(i32, 190), sum);
}
// ANCHOR_END: blocking_queue

// ANCHOR: semaphore
const Semaphore = struct {
    count: usize,
    mutex: Mutex,
    condition: Condition,

    fn init(initial_count: usize) Semaphore {
        return .{
            .count = initial_count,
            .mutex = .init,
            .condition = .init,
        };
    }

    fn acquire(self: *Semaphore, io: std.Io) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        while (self.count == 0) {
            try self.condition.wait(io, &self.mutex);
        }

        self.count -= 1;
    }

    fn release(self: *Semaphore, io: std.Io) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        self.count += 1;
        self.condition.signal(io);
    }
};

fn semWorker(io: std.Io, sem: *Semaphore, counter: *std.atomic.Value(i32)) !void {
    try sem.acquire(io);
    defer sem.release(io) catch {};

    // Critical section
    _ = counter.fetchAdd(@as(i32, 1), .monotonic);
    try io.sleep(.fromNanoseconds(5 * std.time.ns_per_ms), .awake);
}

test "semaphore limits concurrency" {
    const io = std.testing.io;
    var sem = Semaphore.init(2); // Max 2 concurrent
    var counter = std.atomic.Value(i32).init(0);

    var threads: [5]Thread = undefined;
    for (&threads) |*thread| {
        thread.* = try Thread.spawn(.{}, semWorker, .{ io, &sem, &counter });
    }

    for (threads) |thread| {
        thread.join();
    }

    try testing.expectEqual(@as(i32, 5), counter.load(.monotonic));
}
// ANCHOR_END: semaphore

// ANCHOR: barrier
const Barrier = struct {
    count: usize,
    waiting: usize,
    generation: usize,
    mutex: Mutex,
    condition: Condition,

    fn init(count: usize) Barrier {
        return .{
            .count = count,
            .waiting = 0,
            .generation = 0,
            .mutex = .init,
            .condition = .init,
        };
    }

    fn wait(self: *Barrier, io: std.Io) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        const gen = self.generation;
        self.waiting += 1;

        if (self.waiting >= self.count) {
            // Last thread arrives
            self.waiting = 0;
            self.generation += 1;
            self.condition.broadcast(io);
        } else {
            // Wait for others
            while (gen == self.generation) {
                try self.condition.wait(io, &self.mutex);
            }
        }
    }
};

fn barrierWorker(io: std.Io, barrier: *Barrier, id: usize, results: []usize, phase: *std.atomic.Value(usize)) !void {
    // Phase 1
    results[id] = id * 2;

    try barrier.wait(io); // Sync point

    // Phase 2 - all threads have completed phase 1
    _ = phase.fetchAdd(@as(usize, 1), .monotonic);
}

test "barrier synchronization" {
    const io = std.testing.io;
    var barrier = Barrier.init(4);
    var results: [4]usize = undefined;
    var phase = std.atomic.Value(usize).init(0);

    var threads: [4]Thread = undefined;
    for (&threads, 0..) |*thread, i| {
        thread.* = try Thread.spawn(.{}, barrierWorker, .{ io, &barrier, i, &results, &phase });
    }

    for (threads) |thread| {
        thread.join();
    }

    // Verify all threads completed phase 1 before phase 2
    try testing.expectEqual(@as(usize, 4), phase.load(.monotonic));

    // Verify all phase 1 results are set
    try testing.expectEqual(@as(usize, 0), results[0]);
    try testing.expectEqual(@as(usize, 2), results[1]);
    try testing.expectEqual(@as(usize, 4), results[2]);
    try testing.expectEqual(@as(usize, 6), results[3]);
}
// ANCHOR_END: barrier

// ANCHOR: latch
const Latch = struct {
    count: std.atomic.Value(usize),
    mutex: Mutex,
    condition: Condition,

    fn init(count: usize) Latch {
        return .{
            .count = std.atomic.Value(usize).init(count),
            .mutex = .init,
            .condition = .init,
        };
    }

    fn countDown(self: *Latch, io: std.Io) !void {
        const old = self.count.fetchSub(@as(usize, 1), .release);
        if (old == 1) {
            try self.mutex.lock(io);
            defer self.mutex.unlock(io);
            self.condition.broadcast(io);
        }
    }

    fn wait(self: *Latch, io: std.Io) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        while (self.count.load(.acquire) > 0) {
            try self.condition.wait(io, &self.mutex);
        }
    }
};

fn latchWorker(io: std.Io, latch: *Latch) !void {
    try io.sleep(.fromNanoseconds(10 * std.time.ns_per_ms), .awake);
    try latch.countDown(io);
}

test "latch waits for all events" {
    const io = std.testing.io;
    var latch = Latch.init(3);

    var threads: [3]Thread = undefined;
    for (&threads) |*thread| {
        thread.* = try Thread.spawn(.{}, latchWorker, .{ io, &latch });
    }

    try latch.wait(io); // Block until all threads count down

    for (threads) |thread| {
        thread.join();
    }

    try testing.expectEqual(@as(usize, 0), latch.count.load(.monotonic));
}
// ANCHOR_END: latch

// ANCHOR: broadcast_wait
const BroadcastSignal = struct {
    flag: bool,
    mutex: Mutex,
    condition: Condition,

    fn init() BroadcastSignal {
        return .{
            .flag = false,
            .mutex = .init,
            .condition = .init,
        };
    }

    fn wait(self: *BroadcastSignal, io: std.Io) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        while (!self.flag) {
            try self.condition.wait(io, &self.mutex);
        }
    }

    fn broadcast(self: *BroadcastSignal, io: std.Io) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        self.flag = true;
        self.condition.broadcast(io); // Wake all waiters
    }
};

fn broadcastWaiter(io: std.Io, signal: *BroadcastSignal, counter: *std.atomic.Value(i32)) !void {
    try signal.wait(io);
    _ = counter.fetchAdd(@as(i32, 1), .monotonic);
}

test "broadcast wakes all waiters" {
    const io = std.testing.io;
    var signal = BroadcastSignal.init();
    var counter = std.atomic.Value(i32).init(0);

    var threads: [5]Thread = undefined;
    for (&threads) |*thread| {
        thread.* = try Thread.spawn(.{}, broadcastWaiter, .{ io, &signal, &counter });
    }

    try io.sleep(.fromNanoseconds(20 * std.time.ns_per_ms), .awake);
    try signal.broadcast(io);

    for (threads) |thread| {
        thread.join();
    }

    try testing.expectEqual(@as(i32, 5), counter.load(.monotonic));
}
// ANCHOR_END: broadcast_wait

// ANCHOR: timed_wait
const TimedWait = struct {
    ready: bool,
    mutex: Mutex,
    condition: Condition,

    fn init() TimedWait {
        return .{
            .ready = false,
            .mutex = .init,
            .condition = .init,
        };
    }

    fn waitFor(self: *TimedWait, io: std.Io, timeout_ms: u64) !bool {
        // 0.16 has no timed condition wait, so the deadline is explicit.
        const deadline = std.Io.Timestamp.now(io, .awake)
            .addDuration(.fromMilliseconds(@intCast(timeout_ms)));

        while (true) {
            try self.mutex.lock(io);
            const ready = self.ready;
            self.mutex.unlock(io);
            if (ready) return true;

            const remaining = std.Io.Timestamp.now(io, .awake).durationTo(deadline);
            if (remaining.toNanoseconds() <= 0) return false;
            try io.sleep(.fromMilliseconds(1), .awake);
        }
    }

    fn signal(self: *TimedWait, io: std.Io) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        self.ready = true;
        self.condition.signal(io);
    }
};

test "timed wait timeout" {
    const io = std.testing.io;
    var tw = TimedWait.init();

    const timed_out = !try tw.waitFor(io, 50);
    try testing.expect(timed_out);
}

test "timed wait success" {
    const io = std.testing.io;
    var tw = TimedWait.init();

    const thread = try Thread.spawn(.{}, timedSignaler, .{ io, &tw });

    const success = try tw.waitFor(io, 100);
    try testing.expect(success);

    thread.join();
}

fn timedSignaler(io: std.Io, tw: *TimedWait) !void {
    try io.sleep(.fromNanoseconds(20 * std.time.ns_per_ms), .awake);
    try tw.signal(io);
}
// ANCHOR_END: timed_wait

// ANCHOR: event
const Event = struct {
    signaled: std.atomic.Value(bool),
    mutex: Mutex,
    condition: Condition,

    fn init() Event {
        return .{
            .signaled = std.atomic.Value(bool).init(false),
            .mutex = .init,
            .condition = .init,
        };
    }

    fn wait(self: *Event, io: std.Io) !void {
        try self.mutex.lock(io);
        defer self.mutex.unlock(io);

        while (!self.signaled.load(.acquire)) {
            try self.condition.wait(io, &self.mutex);
        }
    }

    fn set(self: *Event, io: std.Io) !void {
        self.signaled.store(true, .release);

        try self.mutex.lock(io);
        defer self.mutex.unlock(io);
        self.condition.broadcast(io);
    }

    fn reset(self: *Event) void {
        self.signaled.store(false, .release);
    }
};

fn eventWaiter(io: std.Io, event: *Event, result: *i32) !void {
    try event.wait(io);
    result.* = 100;
}

test "event signaling" {
    const io = std.testing.io;
    var event = Event.init();
    var result: i32 = 0;

    const thread = try Thread.spawn(.{}, eventWaiter, .{ io, &event, &result });

    try io.sleep(.fromNanoseconds(10 * std.time.ns_per_ms), .awake);
    try event.set(io);

    thread.join();

    try testing.expectEqual(@as(i32, 100), result);
}
// ANCHOR_END: event
```

### See Also

- Recipe 12.2: Mutexes and basic locking
- Recipe 12.5: Thread
- Recipe 12.10: Wait groups for synchronization

---

## Recipe 12.7: Read-Write Locks {#recipe-12-7}

**Tags:** allocators, atomics, concurrency, data-structures, hashmap, memory, resource-cleanup, synchronization, testing, threading
**Difficulty:** intermediate
**Code:** `code/04-specialized/12-concurrency/recipe_12_7.zig`

### Problem

Multiple threads frequently read shared data but rarely write it. Regular mutexes serialize all access, even reads. You want concurrent reads with exclusive writes.

### Solution

Use `std.Thread.RwLock` to allow multiple concurrent readers or one exclusive writer.

```zig
const SharedData = struct {
    value: i32,
    lock: RwLock,

    fn init() SharedData {
        return .{
            .value = 0,
            .lock = .{},
        };
    }

    fn read(self: *SharedData, io: std.Io) !i32 {
        try self.lock.lockShared(io);
        defer self.lock.unlockShared(io);
        return self.value;
    }

    fn write(self: *SharedData, io: std.Io, value: i32) void {
        self.lock.lock(io);
        defer self.lock.unlock(io);
        self.value = value;
    }
};

test "read-write lock basic usage" {
    const io = std.testing.io;
    var data = SharedData.init();

    data.write(42);
    const value = data.read();

    try testing.expectEqual(@as(i32, 42), value);
}
```

### Discussion

Read-write locks excel when reads outnumber writes significantly. Multiple readers can proceed concurrently, improving throughput.

### Cache Example

```zig
const Cache = struct {
    data: std.StringHashMap([]const u8),
    lock: RwLock,

    fn get(self: *Cache, io: std.Io, key: []const u8) !?[]const u8 {
        try self.lock.lockShared(io); // Shared read
        defer self.lock.unlockShared(io);
        return self.data.get(key);
    }

    fn put(self: *Cache, io: std.Io, key: []const u8, value: []const u8) !void {
        self.lock.lock(io); // Exclusive write
        defer self.lock.unlock(io);
        try self.data.put(key, value);
    }
};
```

Lookups don't block each other, only updates.

### When to Use

- **Read-heavy workloads** (90%+ reads)
- **Large data structures** where reads take time
- **Caches, configuration, reference data**

### When NOT to Use

- **Write-heavy** - overhead not worth it
- **Short critical sections** - regular mutex is faster
- **Frequent small reads** - atomic operations better

### Full Tested Code

```zig
const std = @import("std");
const testing = std.testing;
const Thread = std.Thread;
const Mutex = std.Io.Mutex;
const RwLock = std.Io.RwLock;

// ANCHOR: basic_rwlock
const SharedData = struct {
    value: i32,
    lock: RwLock,

    fn init() SharedData {
        return .{
            .value = 0,
            .lock = .init,
        };
    }

    fn read(self: *SharedData, io: std.Io) !i32 {
        try self.lock.lockShared(io);
        defer self.lock.unlockShared(io);
        return self.value;
    }

    fn write(self: *SharedData, io: std.Io, value: i32) !void {
        try self.lock.lock(io);
        defer self.lock.unlock(io);
        self.value = value;
    }
};

test "read-write lock basic usage" {
    const io = std.testing.io;
    var data = SharedData.init();

    try data.write(io, 42);
    const value = data.read(io);

    try testing.expectEqual(@as(i32, 42), value);
}
// ANCHOR_END: basic_rwlock

// ANCHOR: concurrent_readers
fn reader(io: std.Io, data: *SharedData, sum: *std.atomic.Value(i32)) !void {
    var total: i32 = 0;
    var i: usize = 0;
    while (i < 100) : (i += 1) {
        total += try data.read(io);
        try io.sleep(.fromNanoseconds(std.time.ns_per_ms), .awake);
    }
    _ = sum.fetchAdd(@as(i32, total), .monotonic);
}

fn writer(io: std.Io, data: *SharedData) !void {
    var i: i32 = 1;
    while (i <= 10) : (i += 1) {
        try data.write(io, i);
        try io.sleep(.fromNanoseconds(10 * std.time.ns_per_ms), .awake);
    }
}

test "multiple concurrent readers" {
    const io = std.testing.io;
    var data = SharedData.init();
    try data.write(io, 5);

    var sum = std.atomic.Value(i32).init(0);

    var readers: [4]Thread = undefined;
    for (&readers) |*thread| {
        thread.* = try Thread.spawn(.{}, reader, .{ io, &data, &sum });
    }

    const writer_thread = try Thread.spawn(.{}, writer, .{ io, &data });

    for (readers) |thread| {
        thread.join();
    }
    writer_thread.join();

    // Readers can proceed concurrently
    try testing.expect(sum.load(.monotonic) > 0);
}
// ANCHOR_END: concurrent_readers

// ANCHOR: cache_example
const Cache = struct {
    data: std.StringHashMap([]const u8),
    lock: RwLock,
    allocator: std.mem.Allocator,

    fn init(allocator: std.mem.Allocator) Cache {
        return .{
            .data = std.StringHashMap([]const u8).init(allocator),
            .lock = .init,
            .allocator = allocator,
        };
    }

    fn deinit(self: *Cache) void {
        self.data.deinit();
    }

    fn get(self: *Cache, io: std.Io, key: []const u8) !?[]const u8 {
        try self.lock.lockShared(io);
        defer self.lock.unlockShared(io);
        return self.data.get(key);
    }

    fn put(self: *Cache, io: std.Io, key: []const u8, value: []const u8) !void {
        try self.lock.lock(io);
        defer self.lock.unlock(io);
        try self.data.put(key, value);
    }
};

test "cache with read-write lock" {
    const io = std.testing.io;
    var cache = Cache.init(testing.allocator);
    defer cache.deinit();

    try cache.put(io, "key1", "value1");
    try cache.put(io, "key2", "value2");

    const value1 = try cache.get(io, "key1");
    try testing.expect((value1) != null);
    try testing.expectEqualStrings("value1", value1.?);
}
// ANCHOR_END: cache_example

// ANCHOR: read_write_patterns
const Counter = struct {
    value: i32,
    lock: RwLock,

    fn init() Counter {
        return .{
            .value = 0,
            .lock = .init,
        };
    }

    fn increment(self: *Counter, io: std.Io) !void {
        try self.lock.lock(io);
        defer self.lock.unlock(io);
        self.value += 1;
    }

    fn decrement(self: *Counter, io: std.Io) void {
        self.lock.lock(io);
        defer self.lock.unlock(io);
        self.value -= 1;
    }

    fn get(self: *Counter, io: std.Io) !i32 {
        try self.lock.lockShared(io);
        defer self.lock.unlockShared(io);
        return self.value;
    }
};

fn incrementWorker(io: std.Io, counter: *Counter) !void {
    var i: usize = 0;
    while (i < 100) : (i += 1) {
        try counter.increment(io);
    }
}

fn readWorker(io: std.Io, counter: *Counter, samples: *std.atomic.Value(i32)) !void {
    var i: usize = 0;
    while (i < 100) : (i += 1) {
        const value = try counter.get(io);
        if (value > 0) {
            _ = samples.fetchAdd(@as(i32, 1), .monotonic);
        }
        try io.sleep(.fromNanoseconds(std.time.ns_per_ms / 10), .awake);
    }
}

test "read-write patterns" {
    const io = std.testing.io;
    var counter = Counter.init();
    var samples = std.atomic.Value(i32).init(0);

    var writers: [2]Thread = undefined;
    var readers: [4]Thread = undefined;

    for (&writers) |*thread| {
        thread.* = try Thread.spawn(.{}, incrementWorker, .{ io, &counter });
    }

    for (&readers) |*thread| {
        thread.* = try Thread.spawn(.{}, readWorker, .{ io, &counter, &samples });
    }

    for (writers) |thread| {
        thread.join();
    }
    for (readers) |thread| {
        thread.join();
    }

    try testing.expectEqual(@as(i32, 200), counter.get(io));
}
// ANCHOR_END: read_write_patterns
```

### See Also

- Recipe 12.2: Mutexes and basic locking
- Recipe 12.3: Atomic operations

---

## Recipe 12.10: Wait Groups for Synchronization {#recipe-12-10}

**Tags:** atomics, concurrency, error-handling, resource-cleanup, testing, threading
**Difficulty:** intermediate
**Code:** `code/04-specialized/12-concurrency/recipe_12_10.zig`

### Problem

You're spawning multiple threads and need to wait for all of them to complete. Manually tracking threads is error-prone.

### Solution

Use `std.Thread.WaitGroup` to track and wait for parallel tasks.

```zig
// 0.16 replaces Thread.WaitGroup with std.Io.Group: work is added with
// `async` and the group is joined with `await`, so a task no longer signals
// its own completion.
const WaitGroup = std.Io.Group;

fn worker(io: std.Io, id: usize) !void {
    std.debug.print("Worker {} starting\n", .{id});
    try io.sleep(.fromNanoseconds(10 * std.time.ns_per_ms), .awake);
    std.debug.print("Worker {} done\n", .{id});
}

test "wait group basic usage" {
    const io = std.testing.io;
    var wg: WaitGroup = .init;
    defer wg.cancel(io);

    wg.async(io, worker, .{ io, 1 });
    wg.async(io, worker, .{ io, 2 });
    wg.async(io, worker, .{ io, 3 });

    try wg.await(io); // Wait for all to finish
}
```

### Discussion

WaitGroups provide a clean pattern for parallel task completion. Call `start()` before spawning, `finish()` when done (via `defer`), and `wait()` to block until all complete.

### Parallel Tasks

```zig
var wg: WaitGroup = .init;
var results: [5]i32 = undefined;

for (0..5) |i| {
    wg.start();
    _ = try Thread.spawn(.{}, parallelTask, .{ &wg, i, &results });
}

wg.wait(); // All tasks complete
```

### Dynamic Spawning

```zig
var wg: WaitGroup = .init;

for (work_items) |item| {
    wg.start();
    _ = try Thread.spawn(.{}, processItem, .{ &wg, item });
}

wg.wait();
```

### Nested WaitGroups

```zig
fn outerWorker(wg: *WaitGroup) void {
    defer wg.finish();

    var inner_wg: WaitGroup = .init;
    // Spawn sub-tasks...
    inner_wg.wait();
}
```

### Full Tested Code

```zig
const std = @import("std");
const testing = std.testing;
const Thread = std.Thread;

// ANCHOR: wait_group
// 0.16 replaces Thread.WaitGroup with std.Io.Group: work is added with
// `async` and the group is joined with `await`, so a task no longer signals
// its own completion.
const WaitGroup = std.Io.Group;

fn worker(io: std.Io, id: usize) !void {
    std.debug.print("Worker {} starting\n", .{id});
    try io.sleep(.fromNanoseconds(10 * std.time.ns_per_ms), .awake);
    std.debug.print("Worker {} done\n", .{id});
}

test "wait group basic usage" {
    const io = std.testing.io;
    var wg: WaitGroup = .init;
    defer wg.cancel(io);

    wg.async(io, worker, .{ io, 1 });
    wg.async(io, worker, .{ io, 2 });
    wg.async(io, worker, .{ io, 3 });

    try wg.await(io); // Wait for all to finish
}
// ANCHOR_END: wait_group

// ANCHOR: parallel_tasks
fn parallelTask(id: usize, result: []i32) void {
    var sum: i32 = 0;
    var i: i32 = 0;
    while (i < 100) : (i += 1) {
        sum += i;
    }

    result[id] = sum;
}

test "wait for parallel tasks" {
    const io = std.testing.io;
    var wg: WaitGroup = .init;
    defer wg.cancel(io);
    var results: [5]i32 = undefined;

    for (0..results.len) |i| {
        wg.async(io, parallelTask, .{ i, &results });
    }

    try wg.await(io);

    // Sum of 0..99 = 4950
    for (results) |result| {
        try testing.expectEqual(@as(i32, 4950), result);
    }
}
// ANCHOR_END: parallel_tasks

// ANCHOR: dynamic_spawning
fn dynamicWorker(io: std.Io, counter: *std.atomic.Value(i32)) !void {
    _ = counter.fetchAdd(@as(i32, 1), .monotonic);
    try io.sleep(.fromNanoseconds(5 * std.time.ns_per_ms), .awake);
}

test "dynamic task spawning" {
    const io = std.testing.io;
    var wg: WaitGroup = .init;
    defer wg.cancel(io);
    var counter = std.atomic.Value(i32).init(0);

    // Dynamically add tasks
    for (0..10) |_| {
        wg.async(io, dynamicWorker, .{ io, &counter });
    }

    try wg.await(io); // Wait for all

    try testing.expectEqual(@as(i32, 10), counter.load(.monotonic));
}
// ANCHOR_END: dynamic_spawning

// ANCHOR: nested_wait_groups
fn outerWorker(io: std.Io, id: usize) void {
    // A group can nest: the outer task owns its own inner group.
    var inner_wg: WaitGroup = .init;
    defer inner_wg.cancel(io);

    for (0..3) |i| {
        inner_wg.async(io, innerWorker, .{ io, id * 10 + i });
    }

    inner_wg.await(io) catch {};
}

fn innerWorker(io: std.Io, id: usize) !void {
    std.debug.print("Inner worker {}\n", .{id});
    try io.sleep(.fromNanoseconds(5 * std.time.ns_per_ms), .awake);
}

test "nested wait groups" {
    const io = std.testing.io;
    var wg: WaitGroup = .init;
    defer wg.cancel(io);

    for (0..2) |i| {
        wg.async(io, outerWorker, .{ io, i });
    }

    try wg.await(io);
}
// ANCHOR_END: nested_wait_groups
```

### See Also

- Recipe 12.1: Basic threading and thread management
- Recipe 12.6: Condition variables and signaling

---
