---
name: go-review
description: "Perform a Go focused code review checking idioms, patterns, and best practices"
---

Perform a Go focused code review of changes on the current branch.

Based on "100 Go Mistakes and How to Avoid Them" (https://100go.co/) and Go best practices.

## Analysis Scope

Review Go files in the following changes:
1. **Uncommitted changes** (staged and unstaged)
2. **Recent commits** on the current branch that differ from main

Focus on `*.go` files and Go-specific concerns.

## Instructions

1. **Identify Go Changes:**
   - Use `git diff origin/main...HEAD --name-only -- '*.go'` to find changed files
   - Use `git diff HEAD -- '*.go'` to see uncommitted changes
   - Read each changed file completely to understand context

2. **Analyze Against Go Best Practices:**

### Code Organization

**Variable Shadowing (#1):**
```go
// BAD: Shadowed variable in inner block
var client *http.Client
if tracing {
    client, err := createTracingClient()  // Shadows outer client!
    if err != nil {
        return err
    }
    _ = client  // Inner client used, outer remains nil
}
client.Do(req)  // Panic: outer client is nil

// GOOD: Use assignment, not declaration
var client *http.Client
if tracing {
    var err error
    client, err = createTracingClient()  // Assigns to outer
    if err != nil {
        return err
    }
}
```

**Unnecessary Nesting (#2):**
```go
// BAD: Deep nesting
func Process(data []byte) error {
    if data != nil {
        if len(data) > 0 {
            if isValid(data) {
                return process(data)
            } else {
                return ErrInvalid
            }
        }
    }
    return ErrEmpty
}

// GOOD: Early returns, happy path aligned left
func Process(data []byte) error {
    if data == nil || len(data) == 0 {
        return ErrEmpty
    }
    if !isValid(data) {
        return ErrInvalid
    }
    return process(data)
}
```

**Init Function Misuse (#3):**
```go
// BAD: Init functions hide errors
func init() {
    db, _ = sql.Open("postgres", connStr)  // Ignored error!
}

// GOOD: Explicit initialization with error handling
func NewApp() (*App, error) {
    db, err := sql.Open("postgres", connStr)
    if err != nil {
        return nil, fmt.Errorf("opening database: %w", err)
    }
    return &App{db: db}, nil
}
```

**Functional Options Pattern (#11):**
```go
// GOOD: Flexible, extensible configuration
type Option func(*Server)

func WithPort(port int) Option {
    return func(s *Server) { s.port = port }
}

func WithTimeout(d time.Duration) Option {
    return func(s *Server) { s.timeout = d }
}

func NewServer(opts ...Option) *Server {
    s := &Server{port: 8080, timeout: 30 * time.Second}  // Defaults
    for _, opt := range opts {
        opt(s)
    }
    return s
}

// Usage: NewServer(WithPort(9000), WithTimeout(time.Minute))
```

### Error Handling (CRITICAL)

**Never Ignore Errors:**
```go
// BAD: Ignored error
result, _ := SomeFunction()

// BAD: Silent error
if err != nil {
    return // Caller has no idea something failed
}

// GOOD: Handle or propagate
result, err := SomeFunction()
if err != nil {
    return fmt.Errorf("failed to do something: %w", err)
}

// GOOD: Wrap with context
if err != nil {
    return fmt.Errorf("processing user %d: %w", userID, err)
}
```

**Error Wrapping:**
```go
// BAD: Lost error chain
if err != nil {
    return errors.New("operation failed")
}

// GOOD: Preserve error chain with %w
if err != nil {
    return fmt.Errorf("operation failed: %w", err)
}

// GOOD: Check wrapped errors
if errors.Is(err, sql.ErrNoRows) {
    return nil, ErrNotFound
}

// GOOD: Extract error types
var pathErr *os.PathError
if errors.As(err, &pathErr) {
    log.Printf("path error on: %s", pathErr.Path)
}
```

**Sentinel Errors:**
```go
// GOOD: Package-level sentinel errors
var (
    ErrNotFound     = errors.New("not found")
    ErrUnauthorized = errors.New("unauthorized")
)

// GOOD: Custom error types for rich errors
type ValidationError struct {
    Field   string
    Message string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation failed on %s: %s", e.Field, e.Message)
}
```

**Don't Panic (#48):**
```go
// BAD: Panic for recoverable errors
func GetUser(id int) *User {
    user, err := db.Find(id)
    if err != nil {
        panic(err)  // Crashes entire program!
    }
    return user
}

// GOOD: Return error, let caller decide
func GetUser(id int) (*User, error) {
    return db.Find(id)
}

// Panic is only appropriate for:
// - Programmer errors (invalid state that should never happen)
// - Unrecoverable initialization failures
```

**Handle Errors Once (#52):**
```go
// BAD: Logged AND returned (handled twice)
if err != nil {
    log.Printf("error: %v", err)
    return err  // Caller might log again!
}

// GOOD: Either log OR return (not both)
if err != nil {
    return fmt.Errorf("processing request: %w", err)  // Caller handles
}

// OR at top level only:
if err != nil {
    log.Printf("error: %v", err)
    return  // Don't return error, this is the handler
}
```

**Handle Defer Errors (#54):**
```go
// BAD: Deferred Close error ignored
func WriteFile(path string, data []byte) error {
    f, err := os.Create(path)
    if err != nil {
        return err
    }
    defer f.Close()  // Error silently ignored!
    _, err = f.Write(data)
    return err
}

// GOOD: Capture defer error
func WriteFile(path string, data []byte) (err error) {
    f, err := os.Create(path)
    if err != nil {
        return err
    }
    defer func() {
        if cerr := f.Close(); cerr != nil && err == nil {
            err = cerr
        }
    }()
    _, err = f.Write(data)
    return err
}
```

### Data Types

**Slice Length vs Capacity (#20-21):**
```go
// BAD: Growing slice repeatedly (O(n) allocations)
var result []Item
for _, v := range input {
    result = append(result, transform(v))
}

// GOOD: Preallocate when size known
result := make([]Item, 0, len(input))  // len=0, cap=len(input)
for _, v := range input {
    result = append(result, transform(v))
}

// GOOD: Direct assignment when exact size known
result := make([]Item, len(input))  // len=cap=len(input)
for i, v := range input {
    result[i] = transform(v)
}
```

**Nil vs Empty Slice (#22-23):**
```go
// Nil slice: var s []int      → s == nil, len(s) == 0
// Empty slice: s := []int{}   → s != nil, len(s) == 0
// Empty slice: s := make([]int, 0) → s != nil, len(s) == 0

// BAD: Checking for nil when you mean empty
if s == nil {  // Misses empty slices!
    return ErrEmpty
}

// GOOD: Check length for emptiness
if len(s) == 0 {
    return ErrEmpty
}

// Note: JSON marshal differs:
// nil slice   → null
// empty slice → []
```

**Slice Append Side Effects (#25):**
```go
// BAD: Append may mutate original backing array
func AddElement(s []int, elem int) []int {
    return append(s, elem)  // May modify original if capacity allows!
}

// GOOD: Use full slice expression to limit capacity
func AddElement(s []int, elem int) []int {
    s = s[:len(s):len(s)]  // s[low:high:max] limits capacity
    return append(s, elem)  // Forces new allocation
}

// GOOD: Or copy explicitly
func AddElement(s []int, elem int) []int {
    result := make([]int, len(s)+1)
    copy(result, s)
    result[len(s)] = elem
    return result
}
```

**Map Initialization (#27):**
```go
// BAD: Growing map repeatedly
m := make(map[string]int)
for _, item := range items {  // 1000 items = many rehashes
    m[item.Key] = item.Value
}

// GOOD: Preallocate with known size
m := make(map[string]int, len(items))
for _, item := range items {
    m[item.Key] = item.Value
}
```

**Maps and Memory (#28):**
```go
// Maps grow but never shrink! Buckets stay allocated.

// BAD: Long-lived map with transient keys
var cache = make(map[string][]byte)  // Grows forever

// GOOD: Recreate map periodically
func (c *Cache) Compact() {
    newCache := make(map[string][]byte, len(c.data))
    for k, v := range c.data {
        newCache[k] = v
    }
    c.data = newCache  // Old map garbage collected
}

// GOOD: Or use pointer values (map stores pointers, not data)
var cache = make(map[string]*LargeStruct)
```

### Control Structures

**Range Loop Copies (#30):**
```go
// BAD: Modifying copy, not original
for _, item := range items {
    item.Count++  // Modifies copy only!
}

// GOOD: Use index to modify
for i := range items {
    items[i].Count++
}

// GOOD: Use pointer slice
items := []*Item{...}
for _, item := range items {
    item.Count++  // Modifying via pointer works
}
```

**Break in Switch/Select (#34):**
```go
// BAD: Break only exits switch, not loop
for {
    switch state {
    case done:
        break  // Only exits switch, loop continues!
    }
}

// GOOD: Labeled break
loop:
for {
    switch state {
    case done:
        break loop  // Exits the for loop
    }
}
```

**Defer in Loops (#35):**
```go
// BAD: Defers accumulate until function returns
func ProcessFiles(paths []string) error {
    for _, path := range paths {
        f, _ := os.Open(path)
        defer f.Close()  // ALL files stay open until function ends!
    }
    return nil
}

// GOOD: Extract to function so defer runs each iteration
func ProcessFiles(paths []string) error {
    for _, path := range paths {
        if err := processFile(path); err != nil {
            return err
        }
    }
    return nil
}

func processFile(path string) error {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    defer f.Close()  // Closes when this function returns
    return process(f)
}
```

### Strings

**Runes and String Iteration (#36-37):**
```go
// len() returns bytes, not characters!
s := "café"
len(s)           // 5 (bytes: c-a-f-é where é is 2 bytes)
utf8.RuneCountInString(s)  // 4 (runes/characters)

// BAD: Indexing by byte position
char := s[3]  // Gets byte, not rune

// GOOD: Range iterates by rune
for i, r := range s {
    fmt.Printf("index %d, rune %c\n", i, r)
}

// GOOD: Convert to rune slice for random access
runes := []rune(s)
char := runes[3]  // Gets actual character
```

**Trim Functions (#38):**
```go
// TrimRight/TrimLeft remove SET of runes
// TrimSuffix/TrimPrefix remove exact string

s := "oxoxo"
strings.TrimRight(s, "ox")   // "" (removes any o or x from right)
strings.TrimSuffix(s, "ox")  // "oxo" (removes exact "ox" suffix once)

s2 := "123oxo"
strings.TrimLeft(s2, "123")  // "oxo" (removes any 1, 2, or 3)
strings.TrimPrefix(s2, "123") // "oxo" (removes exact "123" prefix)
```

**Substring Memory Leaks (#41):**
```go
// BAD: Substring shares backing array
func ExtractID(msg string) string {
    // msg is 1MB, but we only want first 36 chars
    return msg[:36]  // Keeps entire 1MB in memory!
}

// GOOD: Copy to release backing array
func ExtractID(msg string) string {
    return strings.Clone(msg[:36])  // Go 1.20+
}

// Pre-1.20:
func ExtractID(msg string) string {
    return string([]byte(msg[:36]))
}
```

### Concurrency

**Goroutine Leaks (CRITICAL):**
```go
// BAD: Goroutine leak - channel never read
go func() {
    result := expensiveOperation()
    ch <- result  // Blocks forever if no reader
}()

// GOOD: Buffered channel or select with context
ch := make(chan Result, 1)
go func() {
    ch <- expensiveOperation()
}()

// GOOD: Context cancellation
go func() {
    select {
    case ch <- expensiveOperation():
    case <-ctx.Done():
        return
    }
}()
```

**Channel Patterns:**
```go
// BAD: Closing channel from receiver (panic)
go func() {
    for v := range ch {
        process(v)
    }
    close(ch)  // WRONG: sender should close
}()

// GOOD: Sender closes, receiver ranges
go func() {
    defer close(ch)
    for _, item := range items {
        ch <- item
    }
}()

// GOOD: Done channel for shutdown
done := make(chan struct{})
go func() {
    defer close(done)
    // work
}()
<-done
```

**Mutex Usage:**
```go
// BAD: Forgetting to unlock
func (s *Service) Update() {
    s.mu.Lock()
    if condition {
        return  // DEADLOCK: mutex not unlocked
    }
    s.mu.Unlock()
}

// GOOD: Defer unlock immediately
func (s *Service) Update() {
    s.mu.Lock()
    defer s.mu.Unlock()
    if condition {
        return  // Safe: deferred unlock runs
    }
}

// BAD: Lock held during slow operation
func (s *Service) Process() {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.data = expensiveHTTPCall()  // Blocks all other access
}

// GOOD: Minimize lock scope
func (s *Service) Process() {
    result := expensiveHTTPCall()  // No lock held
    s.mu.Lock()
    s.data = result
    s.mu.Unlock()
}
```

**Race Conditions:**
```go
// BAD: Unsynchronized map access
var cache = make(map[string]Value)

func Get(key string) Value {
    return cache[key]  // Race if concurrent writes
}

// GOOD: sync.RWMutex for read-heavy
var (
    cache   = make(map[string]Value)
    cacheMu sync.RWMutex
)

func Get(key string) Value {
    cacheMu.RLock()
    defer cacheMu.RUnlock()
    return cache[key]
}

// GOOD: sync.Map for simple cases
var cache sync.Map

func Get(key string) (Value, bool) {
    v, ok := cache.Load(key)
    if !ok {
        return Value{}, false
    }
    return v.(Value), true
}
```

**Channels vs Mutexes (#57):**
```go
// Use CHANNELS for: communication, ownership transfer, signaling
// Use MUTEXES for: protecting shared state

// GOOD: Channel for signaling
done := make(chan struct{})
go func() {
    defer close(done)
    work()
}()
<-done

// GOOD: Mutex for shared state
type Counter struct {
    mu    sync.Mutex
    count int
}

func (c *Counter) Inc() {
    c.mu.Lock()
    c.count++
    c.mu.Unlock()
}
```

**Select Non-Determinism (#64):**
```go
// BAD: Assuming select order when multiple cases ready
select {
case <-urgent:
    // You might expect this runs first, but...
case <-normal:
    // This has equal chance of being selected!
}

// GOOD: Check priority explicitly
select {
case <-urgent:
    handleUrgent()
default:
    select {
    case <-urgent:
        handleUrgent()
    case <-normal:
        handleNormal()
    }
}
```

**Notification Channels (#65):**
```go
// GOOD: Use empty struct for signals (zero memory)
done := make(chan struct{})
go func() {
    defer close(done)
    work()
}()

// Wait for completion
<-done

// BAD: Using bool or other types for pure signaling
done := make(chan bool)  // Wastes memory, unclear semantics
```

**Nil Channels (#66):**
```go
// Nil channel operations block forever - use for control flow

// GOOD: Disable channel case dynamically
func merge(ch1, ch2 <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for ch1 != nil || ch2 != nil {
            select {
            case v, ok := <-ch1:
                if !ok {
                    ch1 = nil  // Disable this case
                    continue
                }
                out <- v
            case v, ok := <-ch2:
                if !ok {
                    ch2 = nil  // Disable this case
                    continue
                }
                out <- v
            }
        }
    }()
    return out
}
```

**sync.WaitGroup Misuse (#71):**
```go
// BAD: Add inside goroutine (race condition)
var wg sync.WaitGroup
for i := 0; i < n; i++ {
    go func() {
        wg.Add(1)  // Race! May not run before Wait()
        defer wg.Done()
        work()
    }()
}
wg.Wait()

// GOOD: Add before spawning goroutine
var wg sync.WaitGroup
for i := 0; i < n; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        work()
    }()
}
wg.Wait()
```

**Use errgroup (#73):**
```go
// GOOD: errgroup for concurrent operations with error handling
import "golang.org/x/sync/errgroup"

g, ctx := errgroup.WithContext(ctx)

for _, url := range urls {
    url := url  // Capture for goroutine
    g.Go(func() error {
        return fetch(ctx, url)
    })
}

if err := g.Wait(); err != nil {
    return err  // First error cancels others via context
}
```

**Never Copy sync Types (#74):**
```go
// BAD: Copying mutex
type Service struct {
    mu sync.Mutex
}

func (s Service) DoWork() {  // Receiver is copied!
    s.mu.Lock()  // Different mutex each call!
    defer s.mu.Unlock()
}

// GOOD: Pointer receiver
func (s *Service) DoWork() {
    s.mu.Lock()
    defer s.mu.Unlock()
}

// Also applies to: sync.RWMutex, sync.Cond, sync.WaitGroup, sync.Once
```

### Resource Management

**Defer for Cleanup:**
```go
// BAD: Manual cleanup (easy to miss)
file, err := os.Open(path)
if err != nil {
    return err
}
// ... lots of code
file.Close()  // Might not run if early return

// GOOD: Defer immediately after acquiring
file, err := os.Open(path)
if err != nil {
    return err
}
defer file.Close()

// GOOD: Check error from Close
defer func() {
    if cerr := file.Close(); cerr != nil && err == nil {
        err = cerr
    }
}()
```

**Context Usage:**
```go
// BAD: No context = no cancellation
func Fetch(url string) ([]byte, error) {
    resp, err := http.Get(url)  // Could hang forever
}

// GOOD: Accept context
func Fetch(ctx context.Context, url string) ([]byte, error) {
    req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
    resp, err := http.DefaultClient.Do(req)
}

// GOOD: Respect context cancellation
func Process(ctx context.Context, items []Item) error {
    for _, item := range items {
        select {
        case <-ctx.Done():
            return ctx.Err()
        default:
            process(item)
        }
    }
    return nil
}
```

**HTTP Client:**
```go
// BAD: Default client (no timeouts)
resp, err := http.Get(url)

// GOOD: Custom client with timeouts
var httpClient = &http.Client{
    Timeout: 30 * time.Second,
    Transport: &http.Transport{
        MaxIdleConns:        100,
        MaxIdleConnsPerHost: 10,
        IdleConnTimeout:     90 * time.Second,
    },
}
```

**time.After Memory Leaks (#76):**
```go
// BAD: time.After in loop leaks until timers fire
for {
    select {
    case <-ch:
        handle()
    case <-time.After(time.Second):  // New timer each iteration!
        timeout()
    }
}

// GOOD: Reusable timer
timer := time.NewTimer(time.Second)
defer timer.Stop()

for {
    select {
    case <-ch:
        if !timer.Stop() {
            <-timer.C
        }
        timer.Reset(time.Second)
        handle()
    case <-timer.C:
        timer.Reset(time.Second)
        timeout()
    }
}
```

**Close Transient Resources (#79):**
```go
// BAD: HTTP body not closed
resp, err := http.Get(url)
if err != nil {
    return err
}
body, _ := io.ReadAll(resp.Body)  // Body leaked!

// GOOD: Always close response body
resp, err := http.Get(url)
if err != nil {
    return err
}
defer resp.Body.Close()
body, _ := io.ReadAll(resp.Body)

// Also close: sql.Rows, os.File, net.Conn, etc.
```

**Return After HTTP Reply (#80):**
```go
// BAD: Continues after writing response
func handler(w http.ResponseWriter, r *http.Request) {
    if !authorized(r) {
        http.Error(w, "forbidden", http.StatusForbidden)
        // Falls through! May write again below.
    }
    w.Write([]byte("secret data"))  // Double write!
}

// GOOD: Return after responding
func handler(w http.ResponseWriter, r *http.Request) {
    if !authorized(r) {
        http.Error(w, "forbidden", http.StatusForbidden)
        return  // Stop processing
    }
    w.Write([]byte("secret data"))
}
```

**JSON Handling (#77):**
```go
// Watch for nil vs empty in JSON
type Response struct {
    Items []Item `json:"items"`
}

// var items []Item  → "items": null
// items := []Item{} → "items": []

// Watch for number precision
// JSON numbers → float64 by default
var data map[string]interface{}
json.Unmarshal(body, &data)
id := data["id"].(float64)  // May lose precision for int64!

// GOOD: Use typed struct or json.Number
type Data struct {
    ID int64 `json:"id"`
}
```

### Interface Design

**Accept Interfaces, Return Structs (#6-7):**
```go
// BAD: Concrete parameter limits flexibility
func Process(file *os.File) error

// GOOD: Interface parameter
func Process(r io.Reader) error

// BAD: Interface return (hides concrete type)
func NewService() ServiceInterface

// GOOD: Concrete return
func NewService() *Service
```

**Interface Pollution (#5):**
```go
// BAD: Premature interface (no second implementation)
type UserRepository interface {
    Find(id int) (*User, error)
    Save(u *User) error
}

type userRepo struct { db *sql.DB }
func (r *userRepo) Find(id int) (*User, error) { ... }

// Why? Only one implementation. Interface adds indirection with no benefit.

// GOOD: Start with concrete type
type UserRepository struct { db *sql.DB }
func (r *UserRepository) Find(id int) (*User, error) { ... }

// Add interface WHEN you need a second implementation (testing, different backend)
// or when client needs to define behavior it requires
```

**Consumer-Side Interfaces (#6):**
```go
// BAD: Producer defines interface (anticipating all uses)
// package database
type Store interface {
    Get(key string) ([]byte, error)
    Put(key string, value []byte) error
    Delete(key string) error
    List(prefix string) ([]string, error)
    // ... more methods
}

// GOOD: Consumer defines interface (only what it needs)
// package myservice
type KeyGetter interface {
    Get(key string) ([]byte, error)
}

func NewService(store KeyGetter) *Service {
    // Only depends on Get, easy to test/mock
}
```

**Small Interfaces:**
```go
// BAD: Large interface
type Repository interface {
    Create(item Item) error
    Read(id string) (Item, error)
    Update(item Item) error
    Delete(id string) error
    List() ([]Item, error)
    Search(query string) ([]Item, error)
    // ... 10 more methods
}

// GOOD: Small, focused interfaces
type Reader interface {
    Read(id string) (Item, error)
}

type Writer interface {
    Write(item Item) error
}

// Compose as needed
type ReadWriter interface {
    Reader
    Writer
}
```

**Filename as Input (#46):**
```go
// BAD: Accepts filename (hard to test)
func ProcessFile(filename string) error {
    data, err := os.ReadFile(filename)
    if err != nil {
        return err
    }
    return process(data)
}

// GOOD: Accept io.Reader (easy to test, flexible)
func Process(r io.Reader) error {
    data, err := io.ReadAll(r)
    if err != nil {
        return err
    }
    return process(data)
}

// Tests can use strings.Reader, bytes.Buffer, etc.
```

### Package Design

**Package Naming:**
```go
// BAD: Stutter
package user
type UserService struct{}  // user.UserService

// GOOD: No stutter
package user
type Service struct{}  // user.Service

// BAD: Generic names
package util
package common
package helpers

// GOOD: Specific names
package validation
package httputil
package auth
```

**Dependency Direction:**
```go
// BAD: Circular dependencies
// package a imports package b
// package b imports package a

// GOOD: Dependency inversion
// package a defines interface
// package b implements interface
// package main wires them together
```

### Testing

**Table-Driven Tests:**
```go
func TestAdd(t *testing.T) {
    tests := []struct {
        name     string
        a, b     int
        expected int
    }{
        {"positive", 1, 2, 3},
        {"negative", -1, -2, -3},
        {"zero", 0, 0, 0},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            result := Add(tt.a, tt.b)
            if result != tt.expected {
                t.Errorf("Add(%d, %d) = %d, want %d",
                    tt.a, tt.b, result, tt.expected)
            }
        })
    }
}
```

**Test Helpers:**
```go
// GOOD: Helper with t.Helper()
func assertNoError(t *testing.T, err error) {
    t.Helper()  // Reports caller's line, not this line
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
}

// GOOD: Cleanup with t.Cleanup
func setupTestDB(t *testing.T) *DB {
    db := createDB()
    t.Cleanup(func() {
        db.Close()
    })
    return db
}
```

**Avoid Mocks When Possible:**
```go
// BAD: Over-mocking
type MockDB struct {
    mock.Mock
}
// 50 lines of mock setup...

// GOOD: Use real implementations or fakes
func TestWithRealDB(t *testing.T) {
    db := setupTestDB(t)  // Real SQLite or test container
    // Test against real behavior
}

// GOOD: Simple fake for unit tests
type FakeCache struct {
    data map[string]string
}

func (f *FakeCache) Get(key string) string {
    return f.data[key]
}
```

**Enable Race Detection (#83):**
```bash
# ALWAYS run tests with race detector during development
go test -race ./...

# Race detector adds ~2-10x overhead, but catches data races
```

**Use Test Execution Modes (#84):**
```bash
# Parallel tests (default in Go 1.20+)
go test -parallel 4 ./...

# Shuffle to catch order dependencies
go test -shuffle on ./...

# Both for CI
go test -race -shuffle on ./...
```

**Don't Sleep in Tests (#86):**
```go
// BAD: Sleeping to wait for async operation
func TestAsync(t *testing.T) {
    go startWorker()
    time.Sleep(100 * time.Millisecond)  // Flaky! May not be enough.
    assertResult()
}

// GOOD: Use synchronization
func TestAsync(t *testing.T) {
    done := make(chan struct{})
    go func() {
        defer close(done)
        startWorker()
    }()

    select {
    case <-done:
        assertResult()
    case <-time.After(time.Second):
        t.Fatal("timeout waiting for worker")
    }
}

// GOOD: Use channels or WaitGroups for coordination
```

**Mock Time Properly (#87):**
```go
// BAD: Using real time (slow, flaky tests)
func TestExpiry(t *testing.T) {
    cache.Set("key", "value", 1*time.Hour)
    time.Sleep(1 * time.Hour)  // Tests take forever!
    if cache.Get("key") != "" {
        t.Error("expected expired")
    }
}

// GOOD: Inject time source
type Cache struct {
    now func() time.Time  // Injected
}

func TestExpiry(t *testing.T) {
    fakeNow := time.Now()
    cache := &Cache{now: func() time.Time { return fakeNow }}

    cache.Set("key", "value", 1*time.Hour)
    fakeNow = fakeNow.Add(2 * time.Hour)  // Time travel!

    if cache.Get("key") != "" {
        t.Error("expected expired")
    }
}
```

**Use httptest (#88):**
```go
// GOOD: Test HTTP handlers without network
func TestHandler(t *testing.T) {
    req := httptest.NewRequest("GET", "/users/123", nil)
    rec := httptest.NewRecorder()

    handler.ServeHTTP(rec, req)

    if rec.Code != http.StatusOK {
        t.Errorf("got %d, want %d", rec.Code, http.StatusOK)
    }
}

// GOOD: Test HTTP clients with mock server
func TestClient(t *testing.T) {
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(http.StatusOK)
        w.Write([]byte(`{"id": 1}`))
    }))
    defer srv.Close()

    client := NewClient(srv.URL)
    result, err := client.GetUser(1)
    // assertions...
}
```

**Write Good Benchmarks (#89):**
```go
// BAD: Compiler may optimize away
func BenchmarkBad(b *testing.B) {
    for i := 0; i < b.N; i++ {
        Calculate(i)  // Result unused, may be optimized away!
    }
}

// GOOD: Prevent optimization
var result int

func BenchmarkGood(b *testing.B) {
    var r int
    for i := 0; i < b.N; i++ {
        r = Calculate(i)
    }
    result = r  // Assign to package-level var
}

// GOOD: Reset timer after setup
func BenchmarkWithSetup(b *testing.B) {
    data := expensiveSetup()  // Not part of benchmark
    b.ResetTimer()

    for i := 0; i < b.N; i++ {
        Process(data)
    }
}
```

**Use Fuzzing (#91):**
```go
// GOOD: Fuzz tests find edge cases
func FuzzParse(f *testing.F) {
    // Seed corpus
    f.Add("valid input")
    f.Add("")
    f.Add("special\x00chars")

    f.Fuzz(func(t *testing.T, input string) {
        result, err := Parse(input)
        if err == nil {
            // If no error, result should be usable
            _ = result.String()
        }
    })
}

// Run with: go test -fuzz=FuzzParse
```

### Performance

**Preallocate Slices:**
```go
// BAD: Growing slice repeatedly
var result []Item
for _, v := range input {
    result = append(result, transform(v))
}

// GOOD: Preallocate when size is known
result := make([]Item, 0, len(input))
for _, v := range input {
    result = append(result, transform(v))
}

// GOOD: Direct assignment when exact size known
result := make([]Item, len(input))
for i, v := range input {
    result[i] = transform(v)
}
```

**String Building:**
```go
// BAD: String concatenation in loop
var result string
for _, s := range strings {
    result += s  // O(n²) allocations
}

// GOOD: strings.Builder
var b strings.Builder
for _, s := range strings {
    b.WriteString(s)
}
result := b.String()

// GOOD: strings.Join for simple cases
result := strings.Join(strings, "")
```

**Avoid Unnecessary Allocations:**
```go
// BAD: Converting to string just to compare
if string(byteSlice) == "expected" {

// GOOD: Compare bytes directly
if bytes.Equal(byteSlice, []byte("expected")) {

// BAD: Unnecessary slice copy
func Process(data []byte) {
    copy := append([]byte{}, data...)  // Often unnecessary
}
```

**Data Alignment (#95):**
```go
// BAD: Poor struct layout wastes memory (padding)
type BadStruct struct {
    a bool   // 1 byte + 7 padding
    b int64  // 8 bytes
    c bool   // 1 byte + 7 padding
}  // Total: 24 bytes

// GOOD: Order by size descending
type GoodStruct struct {
    b int64  // 8 bytes
    a bool   // 1 byte
    c bool   // 1 byte + 6 padding
}  // Total: 16 bytes

// Use: go vet -fieldalignment ./...
```

**Stack vs Heap (#96):**
```go
// Heap allocations are slower, trigger GC

// GOOD: Let compiler keep on stack when possible
func Process() {
    data := make([]byte, 64)  // Small, stays on stack
    // use data locally
}

// BAD: Escapes to heap
func Process() *Data {
    d := Data{}
    return &d  // Pointer escapes, forces heap allocation
}

// Check with: go build -gcflags="-m" ./...
```

**Use sync.Pool (#97):**
```go
// GOOD: Reuse allocations for temporary objects
var bufferPool = sync.Pool{
    New: func() interface{} {
        return new(bytes.Buffer)
    },
}

func Process(data []byte) {
    buf := bufferPool.Get().(*bytes.Buffer)
    defer func() {
        buf.Reset()
        bufferPool.Put(buf)
    }()

    buf.Write(data)
    // process...
}
```

**Use Go Diagnostics (#99):**
```bash
# CPU profiling
go test -cpuprofile cpu.prof -bench .
go tool pprof cpu.prof

# Memory profiling
go test -memprofile mem.prof -bench .
go tool pprof -alloc_space mem.prof

# Trace for latency
go test -trace trace.out
go tool trace trace.out

# Escape analysis
go build -gcflags="-m -m" ./...
```

### Security

**SQL Injection:**
```go
// BAD: String interpolation
query := fmt.Sprintf("SELECT * FROM users WHERE name = '%s'", name)
db.Query(query)

// GOOD: Parameterized queries
db.Query("SELECT * FROM users WHERE name = ?", name)
```

**Path Traversal:**
```go
// BAD: Direct path join
path := filepath.Join(baseDir, userInput)

// GOOD: Validate path stays within base
path := filepath.Join(baseDir, userInput)
if !strings.HasPrefix(filepath.Clean(path), filepath.Clean(baseDir)) {
    return ErrInvalidPath
}

// Also check for symlinks
resolved, err := filepath.EvalSymlinks(path)
```

## Report Format

### 🔴 Critical Issues
- Goroutine leaks (#62)
- Race conditions (#58, #69-70)
- Ignored errors (#53)
- Security vulnerabilities (SQL injection, path traversal)
- Resource leaks (#79)
- Panic misuse (#48)

### 🟡 High Priority
- Variable shadowing (#1)
- Missing context support (#60-61)
- Error handling issues (#49-54)
- Concurrency bugs (#55-74)
- Defer in loops (#35)
- sync type copying (#74)
- Test gaps (no race detection #83)

### 🟢 Medium Priority
- Slice/map inefficiency (#20-21, #27-28)
- Interface pollution (#5-7)
- Package structure (#12-13)
- String handling (#36-41)
- Performance optimizations (#92-101)

### 🔵 Suggestions
- Functional options pattern (#11)
- Small interfaces
- Table-driven tests (#85)
- Fuzzing (#91)
- Use errgroup (#73)
- Data alignment (#95)

### ✅ Good Practices Observed
Clean error handling, proper concurrency, well-tested code, idiomatic Go.

For each issue:
- **Location**: File:line
- **Issue**: What's wrong (reference 100go.co mistake number if applicable)
- **Impact**: Why it matters
- **Fix**: Code example

## When to Use

- Reviewing Go code before PR
- After implementing Go services
- When refactoring Go code
- Learning Go best practices

## Quick Reference (100 Go Mistakes)

Numbers reference https://100go.co/ for detailed explanations:

| Category | Key Mistakes |
|----------|--------------|
| Code Organization | #1 shadowing, #2 nesting, #3 init, #5-7 interfaces, #11 options |
| Data Types | #20-21 slices, #22-23 nil/empty, #25 append, #27-28 maps |
| Control Structures | #30 range copy, #34 break, #35 defer loop |
| Strings | #36-37 runes, #38 trim, #41 substring leak |
| Errors | #48 panic, #49-51 wrapping, #52 handle once, #54 defer err |
| Concurrency | #57 chan/mutex, #62 goroutine leak, #64 select, #71 WaitGroup, #73 errgroup, #74 sync copy |
| Std Library | #76 time.After, #77 JSON, #79 close resources, #80 HTTP return |
| Testing | #83 race flag, #85 table tests, #86 sleep, #87 time mock, #91 fuzz |
| Performance | #95 alignment, #96 stack/heap, #97 sync.Pool, #99 diagnostics |
