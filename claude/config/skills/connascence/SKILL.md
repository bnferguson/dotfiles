---
name: connascence
description: Assess coupling in code using the connascence taxonomy. Use when reviewing code for coupling issues, planning refactors, evaluating design decisions, or when the user mentions "connascence", "coupling", or asks about dependencies between components. Focused on Ruby, Go, Zig, and TypeScript but applicable to any language.
---

# Connascence Analysis

## Overview

This skill applies the connascence framework to assess coupling in code. Connascence gives a precise vocabulary for different kinds of coupling, ordered by strength, so you can make informed decisions about what to refactor and what to leave alone.

## When to Use This Skill

- User explicitly asks for connascence analysis
- User asks about coupling, dependencies, or why something is hard to change
- During code review when coupling patterns affect maintainability
- When planning a refactor and you need to prioritize what to address
- When evaluating a design decision that introduces new coupling

## Setup

Load the reference material before analysis:

```
Read references/taxonomy.md
Read references/refactoring-guide.md
```

## Analysis Workflow

### 1. Identify the Scope

Determine what you are analyzing:
- A single file or class — look for internal connascence and connascence with direct dependencies
- A module boundary or API surface — focus on what crosses the boundary
- A PR diff — assess whether changes introduce stronger connascence or increase degree
- A design proposal — evaluate what connascence the design would create

### 2. Scan for Connascence

Work from strongest to weakest — strong connascence crossing wide boundaries is the highest-value finding.

**Priority order for findings:**

| Priority | What to look for |
|---|---|
| Critical | Dynamic connascence (CoE, CoTm, CoV, CoI) crossing module/service boundaries |
| High | CoA (Algorithm) duplicated across modules or languages |
| High | CoP (Position) in public APIs with many callers |
| Medium | CoM (Meaning) — magic values, sentinel returns, implicit conventions |
| Low | CoT, CoN within a module — usually acceptable |

**Do not flag:**
- CoN (Name) unless renaming would cascade across an unusual number of files
- Any connascence that is purely internal to a small function or method
- Connascence that is an inherent consequence of the language or framework (e.g., positional args in a language without keyword support)

### 3. Measure with LSP

When an LSP is available, use it to quantify degree and locality before assessing findings. This turns gut-feel estimates into concrete numbers.

**Degree measurement:**
- Use "Find all references" on the coupled symbol (method, constant, type) to count how many components depend on it. A function with CoP and 3 callers is different from one with 34 callers across 8 packages.
- Use "Type hierarchy" to see how many implementations exist for an interface — this is the degree of CoN/CoT on that contract.

**Locality measurement:**
- Use "Call hierarchy" (incoming) to see where callers live. If all callers are in the same package, locality is tight and the finding is less urgent. If they span modules or services, it's a boundary-crossing problem.

**Rename testability:**
- Use "Rename symbol" as a probe. If the LSP can handle the rename cleanly, CoN is mechanical and well-managed. If it can't (cross-language refs, string-based lookups, generated code), that signals the coupling is worse than it appears structurally.

Skip this step when reviewing a single small file or a design proposal where the code doesn't exist yet.

### 4. Assess Each Finding

For each instance worth reporting, note:

- **Type** — which of the 9 forms (use the abbreviation: CoN, CoT, CoM, CoP, CoA, CoE, CoTm, CoV, CoI)
- **Locality** — where the coupled components are relative to each other (same function, same class, same module, cross-module, cross-service). Use LSP call hierarchy data when available.
- **Degree** — how many components are involved. Use LSP reference counts when available.
- **Verdict** — acceptable (and why) or worth addressing (and why)

### 5. Suggest Transformations

For findings worth addressing, consult `references/refactoring-guide.md` and suggest a specific transformation:

- Name the target form (e.g., "convert CoP → CoN by using keyword arguments")
- Show a concrete before/after
- Note if the transformation has tradeoffs (e.g., introducing a struct to eliminate CoP adds a type to maintain)

### 6. Prioritize

Order recommendations by impact:
1. Strong connascence crossing wide boundaries (fix first)
2. High-degree connascence regardless of strength (many components affected)
3. Connascence that is likely to cause bugs (especially dynamic forms)
4. Connascence that makes the code hard to change (affects velocity)

## Reporting Format

Structure findings as:

```
## Connascence Assessment: [scope]

### Findings

#### [Finding title]
- **Type:** CoX (Connascence of X)
- **Strength:** [weak/medium/strong]
- **Locality:** [within function / within class / cross-module / cross-service]
- **Degree:** [number of components involved]
- **Assessment:** [acceptable / worth addressing]

[Brief explanation of what is coupled and why it matters or doesn't]

[If worth addressing: suggested transformation with before/after]

### Summary

[1-2 sentences: overall coupling health and top recommendation]
```

## Things to Remember

- Connascence is a lens for prioritization, not a score to minimize. Some coupling is necessary and fine.
- The locality corollary: acceptable strength decreases as distance increases. CoA within a class may be fine; CoA across services is a problem.
- Dynamic connascence (CoE, CoTm, CoV, CoI) is inherently harder to reason about than static. Flag it even at close locality.
- When analyzing a PR diff, focus on *changes* to connascence — did the PR introduce stronger coupling? Did it increase degree? That matters more than pre-existing coupling.
- Be honest about the limits of static analysis for dynamic connascence types. You can identify *likely* CoTm from shared mutable state + concurrency, but you cannot be certain without runtime analysis.
