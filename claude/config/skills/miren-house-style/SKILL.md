---
name: miren-house-style
description: Write Go that is indistinguishable from the Miren runtime team's house style, and review code/PRs the way Miren maintainers phinze and evanphx do — the substantive code adjustments they request and how the house style turns into review findings (not just comment tone). Use when writing, editing, or reviewing Go in the mirendev/runtime codebase (or any Miren repo), when a change needs to "look like Miren wrote it," when deciding what to flag or request in a Miren PR review, or when drafting review comments and replies to suggestions. Built from an evidence-backed survey of the codebase and ~1,600 real review comments.
---

# Miren House Style

## Overview

This skill captures how the Miren team actually writes and reviews Go — derived from reading the `mirendev/runtime` codebase and 1,119 inline review comments, 302 PR review summaries, and 234 conversation comments by **phinze** (Paul Hinze) and **evanphx** (Evan Phoenix). It has two modes: **writing** Go that passes as Miren-authored, and **reviewing** the way they do.

Two deep references back this skill — load the relevant one before doing substantial work:
- `references/writing-go.md` — the full Go house-style profile, 8 dimensions, with `file:line` evidence and called-out inconsistencies.
- `references/reviewing.md` — phinze & evanphx review values, blocking calculus, suggestion-reply taxonomy, and per-reviewer voice, every claim quoted with a PR number.

## The meta-rule

Everything reduces to one principle the team states for itself: **comment the non-obvious, keep wiring terse, and let verbosity scale with subtlety.** Density tracks complexity, not a fixed ratio. When unsure, match the surrounding file.

---

## Mode 1: Writing Go like Miren

### The LLM "tells" to eliminate

These are the giveaways that make Go read as AI-generated rather than Miren-authored. Hunt them down:

1. **Free-floating file-overview prose blocks.** A narrative paragraph after the imports explaining "what this file does" is the #1 tell — **zero of the 147 `cli/commands` files have one.** File-level docs, when they exist at all (~3% of files), are a standard godoc `// Package ...` block directly above the `package` clause. Relocate the genuine "why" into the nearest function/type doc comment; never leave an essay header.
2. **Essayistic comment register.** Miren's why-comments are clipped constraint notes, not teaching paragraphs. Cut multi-clause parentheticals and "which keeps it unit-testable"-style asides down to the load-bearing clause. Compare: house style writes `// the default route has no host`, not a three-line explanation of routing.
3. **Reflexive doc comments on trivial wiring.** Command handlers (`func AppList(...)`) are *normally left undocumented* — they are framework wiring dispatched by reflection. Don't add `// AppList lists apps` that just restates the name. (Documenting a non-obvious helper, by contrast, is correct and common.) **Exception — match the sibling family:** if a command's siblings are already documented (e.g. the `logs.go` `LogsApp`/`LogsSandbox`/`LogsBuild`/`LogsSystem` family all carry one-line name-restating docs), keep the new one documented too. Consistency within the file beats the bare-handler default, and stripping the doc from one of three identical siblings reads *more* like an LLM touched it, not less.
4. **`_ struct{}` for a no-flag command.** House style is a named `opts struct{}` (e.g. `func Server(ctx *Context, opts struct{}) error`).
5. **Over-uniform comment density.** Real Miren ranges from `route_list.go` (118 lines, 0 comments) to orchestration files at ~17%. A flat, evenly-narrated file looks generated; vary density by how subtle the code is.

### What is already house style — do NOT "fix" these

Stripping these makes code *less* like Miren. The team explicitly praises why-comments ("Real love for the comments throughout... 'Explain the constraint, not the code' ages well").
- Why-comments on non-obvious unexported helpers and on subtle struct fields / const entries (including trailing line comments).
- Best-effort error handling that returns `nil`/empty on failure where a degraded path is correct (e.g. completion, background work) — with a one-line note saying so.
- A size-1 buffered result/error channel plus a comment explaining why a goroutine isn't a leak.
- Two-group imports (stdlib, then one merged block), unaliased `*_v1alpha` packages, table-driven `tests` slices with testify `require`/`assert`.

### Quick checklist (the universal conventions)

- **Commands:** `func PascalCasePath(ctx *Context, opts struct{ ... }) error` with an **inline anonymous** opts struct; name = command path words concatenated (`env set` → `EnvSet`); register in `commands.go RegisterAll` via `d.Dispatch(path, Infer(...))`. Compose options by embedding `FormatOptions`/`ConfigCentric`/`AppCentric`. Flags via mflags struct tags.
- **Errors:** wrap with `fmt.Errorf("verb noun: %w", err)`; in CLI handlers return bare `err` and let `printError` format it. Guard-clause early returns. Domain errors that cross RPC use `pkg/cond`. Never `github.com/pkg/errors.Wrap` in new code. slog error key is `"error"`.
- **Naming:** single-letter receivers, same name across a type's methods; terse conventional abbreviations (`ctx`, `cfg`, `opts`, `eac`, `ic`); `NewX`/`newX` constructors; no `Get-` on pure accessors. All-caps acronyms in hand-written code (`URL`, `JSON`, `WAF`) — **but** generated entity code uses title-case-per-segment (`Id`, `Http`, `WafProfile`) and the accessor is `Id()`, never `ID()`. `ID` vs `Id` is genuinely mixed; match the file.
- **Tests:** table-driven `tests` slice (`name`/`want`/`wantXxx`), `t.Run(tt.name, ...)`, no loop-var rebind (Go 1.25). Prefer testify (`require` to halt, `assert` to keep going) but plain `t.Errorf`/`t.Fatalf` is equally house style for pure-function tables. Hand-write fakes; no gomock; no golden files. `t.TempDir`/`t.Setenv`/`t.Cleanup`.
- **Concurrency:** entrypoints own an `errgroup.WithContext`; components own their goroutines (`ctx` child + `WaitGroup`, prefer `wg.Go`). Every long-lived loop selects on `ctx.Done()`. Pair `context.WithTimeout`/`WithCancel` with immediate `defer cancel()`.
- **Imports/layout:** stdlib group first; default two groups (three in `controllers/`). Exported entry point first, unexported helpers below; one command per `<noun>_<verb>.go`.

The reference file has the evidence, prevalence, and the documented inconsistencies (acronym casing, two-vs-three import groups, testify-vs-plain, `interface{}` vs `any`, timeout literals vs consts). Read `references/writing-go.md` before non-trivial work.

---

## Mode 2: Reviewing like Miren

This is about the **substance of the review** — what to change and why — not the comment tone. A Miren review is a trace that produces concrete adjustments. Mode 1 (writing-go) IS the review rubric: a deviation from a universal convention is a finding; a sanctioned inconsistency is not. Read `references/reviewing.md` for the evidenced detail.

### The substantive adjustments to look for (most → least common)
1. **Reuse over reinvention** — the single most common note. A new helper/type that duplicates an existing one gets sent back to it (and often promoted to `pkg/ui`/`pkg/*`). Grep for an existing helper before accepting a new one; flag re-implemented stdlib (`url.JoinPath`, `net.JoinHostPort`).
2. **Delete, don't comment out; cut the unneeded.** Dead code, commented-out blocks, unused helpers/params, and speculative machinery get a delete request ("nuke the TTL stuff for now").
3. **Scope error handling; fail closed.** A blanket `if err != nil { return nil }` that meant *not-found* should be `errors.Is(err, cond.ErrNotFound{})`. Auth/security paths must fail closed.
4. **Concurrency:** every server call time-bounded; every goroutine has a `ctx.Done()` arm and can't leak (size-1 buffered result channel); read-modify-write on shared/etcd state is transactional or justified; no nil-deref on a hot path.
5. **State machines / event handling:** transitions match their guards; handlers branch on operation/type, not on a proxy like "entity is nil."
6. **Lifecycle:** anything with a TTL/expiry has a traced renewal path and sane post-expiry behavior.
7. **Security:** no host-FS leakage into containers; no injection/redirect on user-controlled strings; auth headers stripped/set at the boundary.
8. **Scope discipline:** split a PR that's "actually 3 things"; defer gold-plating orthogonal to the goal.
9. **Data-model / abstraction pressure:** when `if x == ""` guards pile up or a bool is copied onto a sub-entity, propose the entity/interface reshape, not the local patch.
10. **Backward compat:** removed flags/fields degrade to no-ops so upgrades don't break.
11. **Tooling:** new checks go into the existing `golangci-lint` pipeline, not a bolted-on step.

### Enforce the house style — writing-go → findings
**Flag (universal):** free-floating file-overview comment block; command handler not `func Name(ctx *Context, opts struct{…}) error` with inline named opts; re-declared flags instead of `FormatOptions`/`ConfigCentric` embeds; list command not branching on `opts.IsJSON()` or serializing an internal type instead of a command-local JSON struct; missing `ctx.RPCClient`+`defer Close`; `pkg/errors.Wrap` in new code (→ `fmt.Errorf … %w`); printing an error instead of returning it; slog key `"err"` (→ `"error"`); a function-dispatch map in `cli/commands`; `tt := tt` loop rebind; `assert` where `require` is needed; gomock/golden files; `context.WithTimeout` without `defer cancel`; lowercase acronyms in hand-written identifiers.

**Do NOT flag (sanctioned inconsistencies — nitpicking these is itself off-house-style):** `ID` vs `Id` (and never generated casing like `WafProfile`/`Id()`); documented-vs-bare command handler (only for sibling consistency); two- vs three-group imports; `interface{}` vs `any`; inline timeout literal vs named const; testify vs plain `t.Errorf`. When unsure, check the prevalence label in `writing-go.md` — universal → flag, mixed → leave it.

### Method & verdict
- **Trace every claim end-to-end before approving** ("unless I'm misreading…" if you can't); **run it** in dev when feasible and report what you saw; **diff the PR description against the implementation** (flag undisclosed feature-flag flips); **praise the specific mechanism** that's load-bearing.
- **Label every note blocking or not.** Reserve the block for correctness/safety/merge-safety; `CHANGES_REQUESTED` is a scoped hold-for-discussion (green-light the rest); **defer by filing a `MIR-xxxx` ticket**, not hand-waving. evanphx decides borderline merges on blast radius and says so.
- **Replying to suggestions (accept/defer/reject):** grade on merits; **a rejection always carries a one-line technical reason** citing the file/feature that makes it wrong; tag false positives.
- **Tone** (secondary): phinze leads with "Short version:" then bulleted findings with `file.go:line`; evanphx is terse and declarative; disclose AI assistance up front.

---

## When applying this skill

- **Writing/editing in a Miren repo:** match the surrounding file first; run the Mode 1 "tells" pass over anything new before considering it done; keep `make lint` green.
- **Reviewing a Miren PR:** trace the change end-to-end first, then work the Mode 2 substantive checklist (reuse/dead-code/error-scope/concurrency/lifecycle/security/scope/data-model) and the writing-go → findings rubric — flag universal-convention deviations, skip the sanctioned inconsistencies. Label each note's blocking-ness, file deferrals as tickets, and never reject a suggestion without a one-line reason. Pick the voice last (phinze for feature/design, evanphx-terse for quick correctness calls).
- **Per the user's global instruction:** when posting on GitHub on the user's behalf, still prefix AI-authored text to identify the assistant — which dovetails with Miren's own disclosure norm.
