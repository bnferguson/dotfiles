# Testing

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
