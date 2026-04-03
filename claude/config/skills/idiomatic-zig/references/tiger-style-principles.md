# Tiger Style Principles

Core philosophy from TigerBeetle's
[TIGER_STYLE.md](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md).
This is a distillation of the most broadly applicable principles — the full document is worth
reading in its entirety.

## Design Goals

**Safety, performance, developer experience — in that order.**

All three are important. Good style advances these goals simultaneously. The question is always:
does the code make for more or less safety, performance, or developer experience?

## On Simplicity

Simplicity is not a free pass. It's not the first attempt but the hardest revision:

> "Simplicity and elegance are unpopular because they require hard work and discipline to achieve"
> — Edsger Dijkstra

The "super idea" that solves safety, performance, and DX simultaneously is what you're looking for.
Multiple passes, many sketches, and you may still have to "throw one away."

An hour or day of design is worth weeks or months in production.

## Zero Technical Debt

Do it right the first time. Don't allow potential memcpy latency spikes or exponential complexity
to slip through. The second time may not come.

> "You shall not pass!" — Gandalf

What you ship is solid. You may lack crucial features, but what you have meets your design goals.
This is the only way to make steady progress.

## Safety (NASA Power of Ten, Adapted)

1. **Simple, explicit control flow.** No recursion. Minimum of excellent abstractions. Abstractions
   are [never zero cost](https://isaacfreund.com/blog/2022-05/).

2. **Limit everything.** All loops and queues have fixed upper bounds. Fail-fast on violations.

3. **Explicitly-sized types.** `u32` over `usize`.

4. **Assert everything.** Minimum two per function. Pair assertions. Assert positive and negative
   space. Split compound assertions. Assert compile-time constants.

5. **Static memory.** All memory allocated at startup. No dynamic allocation after init.

6. **Smallest possible scope.** Minimize variables in scope.

7. **70-line function limit.** Hard limit. Split by centralizing control flow in the parent and
   moving non-branchy logic to helpers.

8. **All compiler warnings.** From day one, at the strictest setting.

9. **Run at your own pace.** Don't react to external events directly. Batch, don't context-switch.

## Function Splitting Rules

When a function exceeds 70 lines:

- **Centralize control flow.** Keep all `switch`/`if` in the parent function. Move non-branchy logic
  fragments to helper functions.
- **Centralize state manipulation.** Parent keeps state in locals. Helpers compute what needs to
  change, but don't apply changes directly.
- **Keep leaf functions pure.**
- **Push `if`s up and `for`s down.**

Good function shape: few parameters, simple return type, lots of meaty logic between the braces.
Inverse hourglass.

## Performance Philosophy

> "The lack of back-of-the-envelope performance sketches is the root of all evil."

- Think performance from the outset. The 1000x wins are in the design phase.
- Back-of-the-envelope: network, disk, memory, CPU × bandwidth, latency.
- Optimize for slowest resources first, adjusted for frequency.
- Distinguish control plane vs data plane. Batch data plane operations.
- Be explicit. Don't depend on compiler optimizations.
- Let the CPU sprint. Give it large chunks of predictable work.

## Naming

- **Get nouns and verbs just right.** Great names capture what a thing is or does.
- **snake_case** for functions, variables, files. Not CamelCase.zig.
- **No abbreviations** (except `i`, `j` in sort/matrix code).
- **Units/qualifiers last**, sorted by descending significance: `latency_ms_max`.
- **Same-length related names**: `source`/`target` over `src`/`dest`.
- **Proper acronym capitalization**: `VSRState` not `VsrState`.
- **Infuse meaning**: `gpa: Allocator` and `arena: Allocator` over `allocator: Allocator`.
- **Nouns over adjectives**: `replica.pipeline` not `replica.preparing`.
- **Helper prefix**: `read_sector()` and `read_sector_callback()`.

## Code Organization

- **Important things near the top.** `main` goes first.
- **Struct order**: fields, then types, then methods.
- **Comments are sentences.** Capital letter, full stop, space after `//`.
- **Always say why.** Code alone is not documentation.
- **Don't duplicate variables or alias them.** Reduces probability of stale state.
- **Declare at smallest scope.** Don't introduce variables before they're needed.

## Style Numbers

- `zig fmt`
- 4 spaces indentation
- Hard 100-column limit
- Braces on `if` (unless single-line)
- 70-line function limit

## Dependencies

Zero-dependencies policy. Dependencies lead to supply chain attacks, safety risk, and slow installs.
For foundational infrastructure, the cost is amplified throughout the stack.

## Tooling

Standardize on Zig. `scripts/*.zig` instead of `scripts/*.sh`. Type safety, cross-platform,
single toolchain.

> "The right tool for the job is often the tool you are already using — adding new tools has a
> higher cost than many people appreciate" — John Carmack

## The Deeper Point

Style is design. Design is how it works. The thinking behind the code matters as much as the code
itself. Spend mental energy upfront. The best is yet to come.
