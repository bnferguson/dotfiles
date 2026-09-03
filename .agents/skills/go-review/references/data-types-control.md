# Data Types, Control Structures & Strings

## Data Types

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

## Control Structures

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

## Strings

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
