# Connascence Taxonomy

Connascence is a software quality metric and taxonomy for coupling. Two components are **connascent** if a change in one requires a change in the other to maintain correctness.

Every instance has three properties:

- **Strength** — how hard it is to discover and refactor. Stronger = worse.
- **Degree** — how many components are involved. Higher = worse.
- **Locality** — how close the coupled components are. Farther apart = worse.

These interact: strong connascence within a single function is often fine; the same form crossing a module boundary is a problem.

---

## Strength Ordering (Weakest to Strongest)

### Static (visible in source code)

1. **Name** (CoN) — weakest
2. **Type** (CoT)
3. **Meaning** (CoM)
4. **Position** (CoP)
5. **Algorithm** (CoA)

### Dynamic (only apparent at runtime)

6. **Execution** (CoE)
7. **Timing** (CoTm)
8. **Value** (CoV)
9. **Identity** (CoI) — strongest

---

## Static Connascence Types

### Connascence of Name (CoN)

Multiple components must agree on the name of an entity. Renaming a method, class, or variable requires updating every reference. This is the weakest form — unavoidable and easily handled by tooling (rename refactors, LSP).

**Ruby:**
```ruby
class OrderProcessor
  def process(order)
    validate(order)        # CoN: must match method name
    charge(order.total)    # CoN: must match attribute name
  end
end
```

**Go:**
```go
func (s *Service) HandleRequest(w http.ResponseWriter, r *http.Request) {
    user := s.repo.FindByID(r.Context(), userID) // CoN: FindByID must match repo method
    s.logger.Info("handled", "user", user.Name)  // CoN: Name must match field
}
```

**Zig:**
```zig
const allocator = std.heap.page_allocator;
var list = std.ArrayList(u8).init(allocator); // CoN: init must match ArrayList's API
try list.append(42);                          // CoN: append must match method name
```

**TypeScript:**
```typescript
interface User { name: string; email: string }
function greet(user: User) {
  return `Hello ${user.name}`  // CoN: must match interface field
}
```

---

### Connascence of Type (CoT)

Multiple components must agree on the type of an entity. In statically typed languages the compiler enforces this; in dynamic languages the contract is implicit.

**Ruby (implicit — no compiler to help):**
```ruby
def calculate_age(birth_year)
  # Caller could pass "1984", 1984, or Time.new(1984)
  # The implicit contract is that birth_year is an Integer
  Time.now.year - birth_year
end
```

**Go (explicit — compiler enforces):**
```go
func ProcessPayment(amount float64, currency string) error {
    // Every caller must pass float64 and string — compiler enforced
    return nil
}
```

**Zig (explicit — compiler enforces):**
```zig
fn processPayment(amount: f64, currency: []const u8) !void {
    // Zig's type system enforces this at compile time
}
```

**TypeScript (structural typing — partially enforced):**
```typescript
function processPayment(amount: number, currency: string): void {
  // TypeScript checks at compile time, but `any` escapes the contract
}
```

---

### Connascence of Meaning (CoM)

Multiple components must agree on the meaning of particular values. Also called Connascence of Convention. Magic numbers, sentinel values, and implicit status codes are the classic symptoms.

**Ruby:**
```ruby
# Bad: magic value convention
def user_role(code)
  case code
  when 0 then :guest      # every caller must know 0 = guest
  when 1 then :member
  when 2 then :admin
  end
end

# Better: named constants reduce to CoN
module Roles
  GUEST  = 0
  MEMBER = 1
  ADMIN  = 2
end
```

**Go:**
```go
// Bad: bare int convention
func SetPermission(level int) { /* 0=none, 1=read, 2=write, 3=admin */ }

// Better: named type + constants
type Permission int
const (
    PermNone  Permission = iota
    PermRead
    PermWrite
    PermAdmin
)
func SetPermission(level Permission) {}
```

**Zig:**
```zig
// Bad: magic sentinel
fn find(haystack: []const u8, needle: u8) i32 {
    // returns -1 for "not found" — every caller must know this
}

// Better: optional type eliminates the convention
fn find(haystack: []const u8, needle: u8) ?usize {
    // null means not found — the type system encodes the meaning
}
```

**TypeScript:**
```typescript
// Bad: string convention
function setStatus(status: string) { /* "active", "inactive", "banned" */ }

// Better: union type reduces to CoT
type Status = "active" | "inactive" | "banned"
function setStatus(status: Status) {}
```

---

### Connascence of Position (CoP)

Multiple components must agree on the order of values. Reordering parameters, tuple elements, or array indices breaks all dependent code.

**Ruby:**
```ruby
# Bad: positional — caller must remember order
def send_email(to, from, subject, body, cc, bcc)
end

# Better: keyword arguments reduce to CoN
def send_email(to:, from:, subject:, body:, cc: nil, bcc: nil)
end
```

**Go:**
```go
// Bad: positional return values
func ParseConfig(path string) (string, int, bool, error) {
    // caller must destructure in exact order
    return host, port, tls, nil
}

// Better: return a struct (reduces to CoN)
type Config struct {
    Host string
    Port int
    TLS  bool
}
func ParseConfig(path string) (Config, error) { ... }
```

**Zig:**
```zig
// Bad: positional tuple
fn parseEndpoint(raw: []const u8) struct { []const u8, u16 } { ... }

// Better: named struct fields
const Endpoint = struct {
    host: []const u8,
    port: u16,
};
fn parseEndpoint(raw: []const u8) Endpoint { ... }
```

**TypeScript:**
```typescript
// Bad: positional destructuring
function useForm(): [string, (v: string) => void, () => void] { ... }
const [value, setValue, reset] = useForm() // position-dependent

// Better: return an object (reduces to CoN)
function useForm(): { value: string; setValue: (v: string) => void; reset: () => void } { ... }
const { value, setValue, reset } = useForm()
```

---

### Connascence of Algorithm (CoA)

Multiple components must independently implement the same algorithm. If the algorithm changes in one place, it must change everywhere — but there is no compiler or type system to enforce this.

**Ruby:**
```ruby
# Writer and reader must agree on serialization format
class CacheWriter
  def write(key, data)
    Redis.set(key, Marshal.dump(data))
  end
end

class CacheReader
  def read(key)
    Marshal.load(Redis.get(key))  # must use same serialization
  end
end
```

**Go:**
```go
// Client and server must agree on HMAC algorithm
func signRequest(body []byte, secret []byte) string {
    mac := hmac.New(sha256.New, secret)
    mac.Write(body)
    return hex.EncodeToString(mac.Sum(nil))
}

func verifyRequest(body []byte, secret []byte, signature string) bool {
    expected := signRequest(body, secret) // shares the algorithm
    return hmac.Equal([]byte(expected), []byte(signature))
}
```

**Zig:**
```zig
// Encoder and decoder must agree on byte order
fn encode(value: u32, buf: []u8) void {
    std.mem.writeInt(u32, buf[0..4], value, .big);
}

fn decode(buf: []const u8) u32 {
    return std.mem.readInt(u32, buf[0..4], .big); // must match .big
}
```

**TypeScript:**
```typescript
// Frontend and backend must agree on token format
function generateToken(userId: string, secret: string): string {
  return btoa(JSON.stringify({ sub: userId, iat: Date.now() }))
}

function parseToken(token: string): { sub: string; iat: number } {
  return JSON.parse(atob(token))  // must match encoding scheme
}
```

---

## Dynamic Connascence Types

Dynamic connascences are only apparent at runtime. They are harder to reason about and harder to refactor than static forms.

### Connascence of Execution (CoE)

The order of execution of multiple components is important. Calling operations out of sequence produces incorrect behavior.

**Ruby:**
```ruby
email = Mail.new
email.to = "user@example.com"
email.subject = "Hello"
email.deliver!
# email.body = "Oops"  # too late — already sent
```

**Go:**
```go
srv := &http.Server{Addr: ":8080"}
// Must register handlers BEFORE calling ListenAndServe
http.HandleFunc("/health", healthHandler)
srv.ListenAndServe() // blocks — anything after this won't register
```

**Zig:**
```zig
var gpa = std.heap.GeneralPurposeAllocator(.{}){};
defer _ = gpa.deinit();  // must deinit after all allocations freed
const allocator = gpa.allocator();
// If you deinit the GPA before freeing allocated memory, you leak
```

**TypeScript:**
```typescript
const app = express()
app.use(authMiddleware)    // must come before routes
app.get("/api/data", handler)
app.listen(3000)           // must come after route registration
```

---

### Connascence of Timing (CoTm)

The timing of execution matters — not just order, but when operations happen relative to each other. Race conditions are the canonical example.

**Ruby:**
```ruby
# Two threads updating a shared counter without synchronization
counter = 0
threads = 10.times.map do
  Thread.new { 1000.times { counter += 1 } }  # race condition
end
threads.each(&:join)
# counter may not be 10_000
```

**Go:**
```go
// Classic race: two goroutines, no synchronization
var balance int64
go func() { balance += 100 }()
go func() { balance -= 50 }()
// Result depends on timing — use atomic or mutex
```

**Zig:**
```zig
// Threads sharing mutable state without synchronization
var shared: u64 = 0;
// Two threads incrementing `shared` without a mutex
// Result depends on scheduling — classic CoTm
```

**TypeScript:**
```typescript
// Race between two async operations writing to the same resource
let cache: Record<string, string> = {}
async function refresh(key: string) {
  const value = await fetchRemote(key)  // timing-dependent
  cache[key] = value                     // last write wins
}
// Two concurrent refresh() calls for the same key = race condition
```

---

### Connascence of Value (CoV)

Multiple values must change together to maintain correctness. The values are semantically linked but nothing in the system enforces their coordination.

**Ruby:**
```ruby
# Rectangle invariant: opposite corners must be consistent
class Rectangle
  attr_accessor :x1, :y1, :x2, :y2
  # Changing x1 without updating x2 can violate width constraints
end
```

**Go:**
```go
// Pagination: offset and limit must be coordinated
type Page struct {
    Offset int  // if Offset changes, Limit may need to as well
    Limit  int
    Total  int  // must reflect actual count
}
```

**Zig:**
```zig
// Slice and length must stay in sync
const Buffer = struct {
    data: [*]u8,
    len: usize,
    cap: usize,
    // len must never exceed cap; data must point to at least cap bytes
};
```

**TypeScript:**
```typescript
// Form state: values and validation errors must correspond
interface FormState {
  values: Record<string, string>
  errors: Record<string, string>  // keys must match `values` keys
  touched: Set<string>            // members must be valid field names
}
```

---

### Connascence of Identity (CoI)

Multiple components must reference the same entity — not an equivalent one, but the identical instance. This is the strongest form: hardest to discover, hardest to refactor.

**Ruby:**
```ruby
# Two objects must share the exact same logger instance (not a copy)
class OrderService
  def initialize(logger)
    @logger = logger  # must be the SAME object as AuditService's logger
  end
end

class AuditService
  def initialize(logger)
    @logger = logger  # same instance — not Logger.new with same config
  end
end
```

**Go:**
```go
// Both handlers must reference the same *sql.DB connection pool
func NewOrderHandler(db *sql.DB) *OrderHandler { return &OrderHandler{db: db} }
func NewAuditHandler(db *sql.DB) *AuditHandler { return &AuditHandler{db: db} }
// If they get different pools, transaction isolation breaks
```

**Zig:**
```zig
// Two subsystems must share the same allocator instance
// (not just the same type — the same runtime state)
var gpa = std.heap.GeneralPurposeAllocator(.{}){};
const allocator = gpa.allocator();
// If subsystem A and B get different allocators, memory accounting diverges
```

**TypeScript:**
```typescript
// React context: consumers must reference the same context object
const ThemeContext = createContext<Theme>(defaultTheme)
// If two files import different context objects (even with identical types),
// useContext(ThemeContext) returns the wrong value
```

---

## Source

Based on the connascence framework by Meilir Page-Jones, expanded by Jim Weirich. Reference: https://connascence.io/
