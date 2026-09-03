# Concurrency & Resource Management

## Concurrency

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

## Resource Management

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
