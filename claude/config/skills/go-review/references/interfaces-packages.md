# Interface & Package Design

## Interface Design

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

## Package Design

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
