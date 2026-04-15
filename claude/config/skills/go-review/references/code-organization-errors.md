# Code Organization & Error Handling

## Code Organization

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

## Error Handling (CRITICAL)

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
