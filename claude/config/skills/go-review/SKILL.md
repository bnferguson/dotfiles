---
name: go-review
description: "Go-focused code review checking idioms, patterns, and best practices. Use when reviewing Go code changes on the current branch or when the user asks for a Go code review."
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

2. **Analyze Against Go Best Practices:** Load the relevant reference files based on what the code touches. You don't need all of them for every review — pick what's relevant.

### Reference Files

| File | When to load |
|------|-------------|
| `references/code-organization-errors.md` | Variable shadowing, nesting, init functions, functional options, error handling |
| `references/data-types-control.md` | Slices, maps, range loops, defer, string handling |
| `references/concurrency.md` | Goroutines, channels, mutexes, race conditions, context, HTTP clients, resource cleanup |
| `references/interfaces-packages.md` | Interface design, package naming, dependency direction |
| `references/testing.md` | Table-driven tests, test helpers, mocking, race detection, benchmarks, fuzzing |
| `references/performance-security.md` | Preallocation, string building, struct alignment, escape analysis, SQL injection, path traversal |

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
