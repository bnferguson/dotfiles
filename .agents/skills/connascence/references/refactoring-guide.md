# Connascence Refactoring Guide

## Core Principles

1. **Weaken** — convert stronger connascence to weaker forms
2. **Reduce degree** — minimize the number of components involved
3. **Localize** — move coupled components closer together
4. **Convert dynamic to static** — make runtime coupling visible in source code

The acceptable strength of connascence decreases as distance increases:

| Boundary | Acceptable Strength |
|---|---|
| Within a function | Any static form; weak dynamic |
| Within a class/module | CoN, CoT, CoM, CoP; avoid CoA |
| Across modules | CoN, CoT only |
| Across services/repos | CoN only (via shared contracts) |

---

## Transformation Patterns

### CoM (Meaning) → CoN (Name)

**Problem:** Magic values whose meaning is implicit.

**Pattern:** Extract named constants, enums, or types.

```ruby
# Before: CoM — callers must know 2 means admin
user.update(role: 2)

# After: CoN — callers reference a name
user.update(role: Roles::ADMIN)
```

```go
// Before: CoM
SetLogLevel(3) // what is 3?

// After: CoN
type LogLevel int
const (
    Debug LogLevel = iota
    Info
    Warn
    Error
)
SetLogLevel(Warn)
```

```zig
// Before: CoM — sentinel value
fn find(haystack: []const u8, needle: u8) i32 { ... } // -1 = not found

// After: CoT — optional type encodes the meaning
fn find(haystack: []const u8, needle: u8) ?usize { ... } // null = not found
```

```typescript
// Before: CoM
fetch("/api/users", { method: "POST" }) // string convention

// After: CoT
type HttpMethod = "GET" | "POST" | "PUT" | "DELETE"
function apiFetch(url: string, method: HttpMethod) { ... }
```

---

### CoP (Position) → CoN (Name)

**Problem:** Callers must remember argument/element order.

**Pattern:** Use keyword arguments, named structs, or objects.

```ruby
# Before: CoP — 6 positional args
send_email("user@example.com", "admin@co.com", "Alert", "Body", nil, nil)

# After: CoN — keyword args
send_email(to: "user@example.com", from: "admin@co.com", subject: "Alert", body: "Body")
```

```go
// Before: CoP — positional returns
func ParseAddr(s string) (string, int, bool, error) { ... }
host, port, tls, err := ParseAddr(addr) // must match order

// After: CoN — named struct
type Addr struct { Host string; Port int; TLS bool }
func ParseAddr(s string) (Addr, error) { ... }
addr, err := ParseAddr(s)
fmt.Println(addr.Host) // access by name
```

```zig
// Before: CoP — anonymous struct return
fn parseEndpoint(raw: []const u8) struct { []const u8, u16 } { ... }

// After: CoN — named struct
const Endpoint = struct { host: []const u8, port: u16 };
fn parseEndpoint(raw: []const u8) Endpoint { ... }
```

```typescript
// Before: CoP — tuple return
function useForm(): [string, (v: string) => void, () => void] { ... }

// After: CoN — object return
function useForm(): { value: string; setValue: (v: string) => void; reset: () => void } { ... }
```

---

### CoA (Algorithm) → Single Source of Truth

**Problem:** The same algorithm is implemented independently in multiple places.

**Pattern:** Extract the shared logic into one location. Both sides call it.

```ruby
# Before: CoA — serialization duplicated
class Writer
  def save(data) = Redis.set(key, Marshal.dump(data)) end
end
class Reader
  def load = Marshal.load(Redis.get(key)) end
end

# After: shared codec
module Codec
  def self.encode(data) = Marshal.dump(data)
  def self.decode(raw)  = Marshal.load(raw)
end
```

```go
// Before: CoA — HMAC logic in two places
func sign(body, secret []byte) string { /* sha256 HMAC */ }
func verify(body, secret []byte, sig string) bool { /* sha256 HMAC again */ }

// After: sign once, compare
func verify(body, secret []byte, sig string) bool {
    return hmac.Equal([]byte(sign(body, secret)), []byte(sig))
}
```

```zig
// Before: CoA — encode/decode must agree on byte order
fn encode(val: u32, buf: *[4]u8) void { std.mem.writeInt(u32, buf, val, .big); }
fn decode(buf: *const [4]u8) u32 { return std.mem.readInt(u32, buf, .big); }

// After: shared constant
const byte_order: std.builtin.Endian = .big;
fn encode(val: u32, buf: *[4]u8) void { std.mem.writeInt(u32, buf, val, byte_order); }
fn decode(buf: *const [4]u8) u32 { return std.mem.readInt(u32, buf, byte_order); }
```

```typescript
// Before: CoA — token format in frontend and backend
// frontend: btoa(JSON.stringify({sub, iat}))
// backend: Buffer.from(token, 'base64').toString()

// After: shared module
export const Token = {
  encode: (payload: TokenPayload) => btoa(JSON.stringify(payload)),
  decode: (token: string): TokenPayload => JSON.parse(atob(token)),
}
```

---

### CoE (Execution Order) → Builder / State Machine

**Problem:** Methods must be called in a specific order, but nothing enforces it.

**Pattern:** Use a builder that enforces the sequence through types, or a state machine that rejects invalid transitions.

```ruby
# Before: CoE — must call in order
email = Mail.new
email.to = "user@example.com"
email.subject = "Hello"
email.deliver!

# After: builder enforces required fields
Mail.deliver(to: "user@example.com", subject: "Hello", body: "...")
```

```go
// Before: CoE — must register before listen
http.HandleFunc("/health", handler)
srv.ListenAndServe()

// After: constructor takes complete config
func NewServer(routes map[string]http.Handler) *http.Server { ... }
```

```typescript
// Before: CoE — middleware order matters
app.use(cors())
app.use(auth())
app.use(routes)

// After: framework enforces phases
createApp({ middleware: [cors(), auth()], routes })
```

---

### CoTm (Timing) → Synchronization / Message Passing

**Problem:** Correctness depends on when operations happen relative to each other.

**Pattern:** Replace shared mutable state with synchronization primitives, channels, or immutable message passing.

```go
// Before: CoTm — race condition
var balance int64
go func() { balance += 100 }()
go func() { balance -= 50 }()

// After: channel-based coordination
func updateBalance(ch chan int64, delta int64) { ch <- delta }
```

```zig
// Before: CoTm — unsynchronized shared state
var shared: u64 = 0;
// threads racing on shared

// After: atomic or mutex
var shared = std.atomic.Value(u64).init(0);
```

---

### CoI (Identity) → Dependency Injection / Interface

**Problem:** Components must reference the exact same instance.

**Pattern:** Make the shared identity explicit through DI, or decouple via interfaces so components don't need the same instance.

```ruby
# Before: CoI — must be the same logger instance
OrderService.new(logger)
AuditService.new(logger)

# After: interface — any conforming logger works
class OrderService
  def initialize(logger:) # accepts anything that responds to :info, :error
    @logger = logger
  end
end
```

```go
// Before: CoI — must share exact *sql.DB
NewOrderRepo(db)
NewAuditRepo(db)

// After: interface decouples identity requirement
type Querier interface { QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) }
func NewOrderRepo(q Querier) *OrderRepo { ... }
```

---

## Decision Heuristic

When you find connascence, ask:

1. **Is it crossing a boundary?** If it is within a single function or small class, it may be fine regardless of strength.
2. **What is the degree?** Two components sharing CoA is manageable; twenty sharing it is urgent.
3. **Can I weaken it?** Look one or two steps down the strength ladder. CoA → extract shared code. CoP → use named args. CoM → introduce constants.
4. **Can I localize it?** If weakening isn't practical, move the coupled components closer together — same module, same package.
5. **Is it dynamic?** Dynamic connascence crossing boundaries is the highest-priority target. Convert to static forms where possible.

Not every instance needs fixing. The framework is for prioritization, not elimination.
