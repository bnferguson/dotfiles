# Performance & Security

## Performance

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

## Security

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
