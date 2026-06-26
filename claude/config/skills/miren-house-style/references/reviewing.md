# Review Like Miren — substance of the review

How phinze (Paul Hinze) and evanphx (Evan Phoenix) review code in `mirendev/runtime`: **what they change, and how the writing-go house style becomes review findings.** This is the review-side mirror of `writing-go.md` — the *substance* of the adjustments, not the comment tone (tone is summarized at the end). Built from 1,119 inline comments, 302 PR review summaries, and 234 conversation comments; quotes are verbatim with PR/author.

---

## 1. The substantive adjustment catalog (what a Miren review actually changes)

These are the recurring code-level changes they request. Treat each as a thing to *look for* and the corrected shape to *ask for*.

### Reuse over reinvention — the most common substantive note
A new helper that duplicates an existing one gets sent back to the existing one, often with a request to promote it to a shared package.
- "There's a helper nearly identical to this in `sandbox_list.go` called `humanFriendlyTimestamp` - it should be in scope to call directly from this file, and ideally we could move it to `pkg/ui`." — phinze
- "There's a [helper function for waiting for service readiness] you can use instead of [this]." — phinze
- "I added an interface for this pattern so you just have to implement `Reconcile` instead of wiring all the ~meaningless verbs." — phinze
- "The `decodeEntity` helper and `rpcEntityWrapper` type aren't needed here. The entity response already provides direct access to the underlying `*entity.Entity` (which implements `AttrGetter`)." — phinze

**Review action:** before accepting a new helper/type, grep for an existing one; if it exists, ask the author to call it (and consider promoting it to `pkg/ui`, `pkg/*`). Flag accidental re-implementations of stdlib too: "Consider `url.JoinPath(...)` instead of TrimSuffix + concatenation … handles edge cases like double slashes" (phinze); "Need to use `net.JoinHostPort`" (evanphx).

### Delete, don't comment out; cut the unneeded
- "IMHO delete instead of comment here." — phinze
- "I think this should be deleted." — evanphx
- "Just nuke the TTL stuff for now." — evanphx (cut premature complexity)

**Review action:** dead code, commented-out blocks, and speculative machinery get a delete request, not a "maybe keep it." Unused helpers/types/parameters → remove.

### Scope error handling narrowly; never fail open
- "Any way to scope this to a not found error? I'm considering the scenario where containerd gets borked somehow. We wouldn't want this to cruise through pretending things were cleaned up." — phinze (don't swallow *all* errors when you mean *not-found*)
- "a fail-open path in the password middleware … those need fixing regardless." — phinze
- "Auth chain is solid, fails closed everywhere." — phinze (the praise version of the same value)

**Review action:** a bare `if err != nil { return nil }` that should be `errors.Is(err, cond.ErrNotFound{})` is a finding. Security/auth paths must fail closed.

### Concurrency: races, bounds, leaks
- Get-then-put races: "Wondering how much we can push down transactional operations to protect against race conditions on 'get, then put' type situations." / "I bet this races with the new version coming in." — phinze
- Missing bounds: "Everything else here bounds itself with `remoteTokenTimeout`, but this one rides the raw runner ctx, so a hung coordinator just stalls startup. That's the one worth fixing here." — phinze
- Panics on the hot path: "The activator nil-derefs any non-delete op that carries no entity → panic on the routing hot path." — phinze

**Review action:** every server call should be time-bounded; every goroutine needs a `ctx.Done()` arm and a non-leak story (size-1 buffered result channel so it can always send and exit); read-modify-write on shared/etcd state needs a transaction or an explicit justification.

### Correctness of state machines and event handling
- "check the operation type instead of assuming a delete when the entity is gone." — phinze (the op-type-vs-absence bug class)
- "we should only progress from PENDING->RUNNING if there hasn't been an update in N minutes … This is the state transition of last resort and we don't want to [trigger it casually]." — phinze

**Review action:** verify state transitions against their guards; verify event handlers branch on the operation/type, not on a proxy like "entity is nil."

### Cert / credential lifecycle
- "this PR adds a cert with no `http_route` entity, and on the DNS-01/lego path nothing renews it … the cert expires at ~90 days and handshakes then hard-fail until a restart." — phinze
- "this logic reads like we're giving a grace period *after* expiry for regen, which implies we're okay loading a cert that expired up to 47h [ago]." — phinze

**Review action:** for anything with a TTL/expiry, trace the renewal path and the post-expiry behavior.

### Security
- "Drop this, so the host file system isn't directly leaked into the container." — evanphx
- "an XSS + open redirect on `returnPath` … agreed on all of them." — phinze

**Review action:** check for host-FS leakage, injection/redirect on user-controlled strings, and that auth headers are stripped/set at the boundary.

### Scope discipline — split, and cut gold-plating
- "After digging in, I think this PR is actually 3 things interleaved." — phinze
- "I'd like to finish this rename operation, and sprucing up these scripts is orthogonal to that, so calling this gold plating for now." — phinze

**Review action:** if a PR mixes concerns, ask to split; if it adds machinery beyond the stated goal, call it gold-plating and defer.

### Data-model / abstraction pressure (not just local bugs)
- "The guards added throughout (`if image == ""`) are handling this, but it reveals that we're stretching AppVersion beyond its original design … it's time to split out **ConfigVersion** as a first-class entity." — phinze
- "The cleaner shape uses an abstraction already in the codebase: route ephemeral through the strategy interface." — phinze

**Review action:** when guard clauses pile up around one field, or a new bool is copied onto a sub-entity, propose the entity/abstraction reshape instead of accepting the patch.

### Backward compatibility
- "we need to accept `--start-tls` as a noop (maybe mark it hidden), so that upgrades don't break." — evanphx

**Review action:** removed flags/fields that clients may still send should degrade to no-ops; check the upgrade path.

### Tooling / lint wiring
- "can we wire it through `golangci-lint` (already in the lint job, bundles the same `exhaustive` analyzer) instead of a standalone `go vet` step? We'd get the shared single load, parallelism, and caching for free." — phinze

**Review action:** new checks belong in the existing lint pipeline, not bolted on.

---

## 2. Enforcing the house style in review (writing-go → review findings)

This is how `writing-go.md` operationalizes during review. The rule: **deviation from a *universal* convention is a request-change; a *mixed/sanctioned* inconsistency is never flagged.** Nitpicking the sanctioned ones is itself an anti-pattern — it's noise the Miren reviewers don't generate.

### Flag these (universal conventions — request the conventional form)
- **Free-floating file-overview prose block** after the imports → remove it; fold any real "why" into the nearest function/type doc comment. (No `cli/commands` file has one.)
- **Command handler not shaped `func Name(ctx *Context, opts struct{ ... }) error`** with an *inline anonymous* opts struct (named `opts`, even if empty/unused — not `_`). Also flag a separate named opts type for a normal command.
- **Re-declared flags** instead of embedding `FormatOptions` / `ConfigCentric` / `AppCentric`.
- **List/table command** that doesn't branch on `opts.IsJSON()` before rendering, or that serializes an internal/RPC type instead of a **command-local JSON struct** with `json:"snake_case"` tags and raw values.
- **RPC client** not obtained via `cl, err := ctx.RPCClient(svc)` + immediate err return + `defer cl.Close()`.
- **`github.com/pkg/errors.Wrap` in new code** → `fmt.Errorf("verb noun: %w", err)`.
- **Printing an error and returning nil** from a handler instead of returning the error up (except deliberate expected-empty/not-configured states).
- **slog error key `"err"`** → `"error"`.
- **A function-dispatch registry map** in `cli/commands` → use the explicit `d.Dispatch(...)` sequence; package-level maps there are value lookups only.
- **Loop-variable rebind `tt := tt`** in tests → remove (repo is Go 1.25).
- **`assert` where `require` is needed** (e.g. before dereferencing a result); **gomock/mockgen or golden files** → hand-write fakes; no golden files exist in the repo.
- **Goroutine with no `ctx.Done()` arm / unbounded work / leak risk**; **`context.WithTimeout`/`WithCancel` without an immediate `defer cancel()`**.
- **Acronym casing in *hand-written* identifiers** that isn't all-caps (`url`/`Json` → `URL`/`JSON`).

### Do NOT flag these (genuine, sanctioned house inconsistencies — flagging them is the anti-pattern)
- **`ID` vs `Id`** — both exist in hand-written code; and **never** flag generated entity casing (`WafProfile`, `HttpRoute`, `Id()`), which is schemagen's convention.
- **Doc comment on a command handler** — both bare and one-line-documented are house style; only raise it for *consistency* (match the sibling family, e.g. all of `logs.go`'s `Logs*`).
- **Two-group vs three-group imports** — both pass the linter; three-group is normal in `controllers/`.
- **`interface{}` vs `any`** — mid-migration; prefer `any` in new code but don't treat `interface{}` as a defect.
- **Inline `time.Duration` literal vs named const** for a timeout — name it only when reused/semantic.
- **testify vs plain `t.Errorf`/`t.Fatalf`** — ~50/50 in `cli/commands`; both are house style.

When unsure whether something is sanctioned, check its prevalence label in `writing-go.md` (universal → flag; mixed → leave it).

---

## 3. Review method (how the verdict is earned)

The substance of *how* they review, not just what they write:
1. **Trace every claim end-to-end through the code before approving.** Don't accept "looks plausible." "We traced the lease lookup through all three `requestPoolCapacity` branches … read the watch and recovery paths until we were satisfied the re-sync is safe … then went grepping through garden's journal to watch the bug actually happen." — phinze, PR#837. If you can't confirm a path, say "unless I'm misreading…" and ask.
2. **Run it, don't just read it.** Deploy to dev and exercise the change; report what you saw, including where it fell short. "deployed a 1s ping app to a dev cluster and watched it live." — phinze, PR#845.
3. **Diff the PR description against the implementation.** Flag undisclosed behavior changes — especially feature-flag flips. "This flips the addons feature flag from `default: false` to `default: true` … the PR description doesn't mention this." — phinze, PR#688.
4. **Audit dense factual claims** (docs, comments) against the code. "every runtime claim on the page, traced back to the code." — phinze, PR#831.
5. **Praise specific mechanisms** so the author knows what's load-bearing — name the technique (streaming tokenizer, O(1) cursor, fail-closed chain).

---

## 4. Blocking calculus (which substance blocks)

- **Label every note blocking or not** — "(not blocking)" / "neither blocking" vs "the one worth fixing here." Most substantive notes are non-blocking improvements; reserve the block for correctness/safety/merge-safety.
- **CHANGES_REQUESTED is a hold for discussion** — say so, scope the block to the specific slice, and green-light the rest to land as-is. "Going to request-changes on the `pool.Ephemeral` field specifically. The incident pieces themselves look right and should land as-is." — phinze, PR#821.
- **Defer by filing, not hand-waving.** "Later" = a `MIR-xxxx` ticket or a named follow-up so it doesn't slip. "Filed MIR-1227 for the renewal follow-up. Nothing blocking." — phinze, PR#848.
- **evanphx decides borderline merges on blast radius** and states it: "Since the blast radius for DevPrev is minimal (new code is guarded behind new config checks) fine to merge!" — PR#384.

---

## 5. Replying to suggestions (substance first)

Grade every bot/human suggestion on the merits; **a rejection always carries a one-line technical reason**, ideally citing the file/feature that makes it wrong.
- **Accept:** fix it, link the commit. "Good catch! Fixed in `<sha>`."
- **Defer:** name and file it. "Reasonable, will cover in MIR-173."
- **Reject (never bare):** "These are declared in sibling file `opts.go` which builds on every platform." / "`Decode` does not return an error." / "You're thinking of golangci-lint v1 config; this is v2." Tag false positives explicitly: "the credential-encoding flag is a false positive — `url.UserPassword` already handles that."

---

## 6. Tone & voice (secondary — the substance above carries the review)

The register is real but it sits on top of the rigor; it never substitutes for the trace. Short version:
- **phinze:** lead with a "Short version:" / "The headline:", then bullet findings with `file.go:line` + backticked symbols; emoji severity taxonomy (💡 idea, ⚠️ problem, ❓ question, 💭 musing, 🧹 nit); themed personas are welcome *when the analysis underneath is real*; self-deprecating and collaborative.
- **evanphx:** terse and declarative — open "Looks good!", name the single load-bearing fix in one sentence, correct wrong suggestions flatly, stop.
- **Disclose AI assistance up front, and disclose when the AI was wrong** ("Claude and I traced…", "Boo for the bad test plan, Claude!"). It signals real work was done.
