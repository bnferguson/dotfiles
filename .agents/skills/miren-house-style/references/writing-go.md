# Miren Go House Style Profile

A definitive guide to writing and reviewing code indistinguishable from Miren's. Rules are imperative; prevalence and real inconsistencies are called out. Citations are `file:line`.

---

## 1. Comments & Verbosity (priority dimension)

Miren runs a deliberate **two-tier** comment system. The governing principle is **comment-the-non-obvious** (codified in the repo's own CLAUDE.md). Density tracks complexity, not a fixed ratio.

**The two tiers:**
- **Library/foundational packages** (`pkg/`, parts of `components/`, `api/`) are godoc-grade: package-doc blocks, every exported type/const/field documented, often exhaustive field comments. Measured density: `pkg/saga/types.go` ~38%.
- **CLI, services, controllers** are terse-to-moderate: command entry-point handlers usually carry **no** doc comment; simple list/table commands are effectively comment-free; complex orchestration (deploy, sagas, controllers) earns moderate density that strongly favors "why" over "what." Measured density: `route_list.go` ~0%, `deploy.go`/`logs.go` ~10%, `scheduler.go` ~17%.

### Rules

**No free-floating file-overview prose blocks.** File-level documentation, when present at all, is a standard godoc `// Package ...` block placed directly above the `package` clause — never an ad-hoc header narrative after the imports. This is **rare**: only ~23 of 718 non-test/non-generated files (~3%) carry a `// Package` comment; **zero** of the 147 `cli/commands` files do. Most files jump straight from `package` to imports to code. (`pkg/saga/types.go:1-7`, `pkg/logfilter/filter.go:1-17`)

**Document exported symbols selectively, not reflexively.** In `pkg/` library packages, document every exported type, function, const, and usually struct fields. In the CLI, the verb-noun command handlers (`Deploy`, `RouteList`, `EnvSet`, `App`, `ClusterAdd`) are **normally left with no doc comment** — they are framework wiring dispatched by reflection (`infer.go`), and their user-facing help lives in mflags tags. Prevalence: **mixed**. This is a genuine inconsistency even inside the CLI: exported helpers and some subcommand families *do* get docs (`cli/commands/env.go:24` `// ParseEnvVarSpecs...`, the entire `LogsApp/LogsSandbox/LogsBuild/LogsSystem` family in `logs.go:65-145`). (`deploy.go:46`, `route_list.go:13` vs `pkg/saga/types.go:19-37`)

**Exportedness does NOT gate doc comments.** Document unexported helpers liberally when their purpose or contract isn't obvious; lowercase helpers in CLI/controller/server code routinely carry name-prefixed doc comments. **Common.** (`logs.go:26-28` `// buildFilterWithService...`, `cluster_add.go:288-289` `// extractTLSCertificate...`). Counter: trivial helpers stay bare (`deploy.go:1215` `buildStepsSummary` has none).

**Begin doc comments with the symbol name** (`// Foo does X`) — Go standard, enforced in spirit by `make lint`/golangci-lint. Keep them one line when behavior is simple, but **length scales with subtlety**: write multi-sentence or multi-paragraph comments when there's real rationale, a concurrency contract, or a non-obvious algorithm. One-liners and multi-paragraph docs coexist freely. (Long: `deploy.go:962-974`, `scheduler.go:14-21`, `deploy.go:1057-1060` documenting a mutex contract. Short: `scheduler.go:27` `// NewController creates a new scheduler controller`.)

**Inline comments: explain WHY, not WHAT.** Leave simple list/table/marshalling code essentially comment-free. In long orchestration functions, use frequent inline comments — both short section-header markers that structure the function and "why" comments justifying non-obvious decisions. **Common.** Not purely why-only: short structural "what" markers appear too (`deploy.go:128` `// Handle --analyze flag...`). The terse extreme is `route_list.go` (118 lines, 0 comments — a JSON+table command judged self-explanatory). Strong examples of "why": `scheduler.go:62-66`, `logs.go:234-239`, `deploy.go:346-348`.

**Comment struct fields and const blocks when meaning isn't self-evident.** Both full-line doc comments above the field and trailing line comments after it are accepted and common. Library packages comment fields exhaustively (`pkg/saga/types.go:40-52`); CLI/runtime structs comment only the subtle fields (`global.go:36-43`); trailing line comments are idiomatic (`pkg/logfilter/filter.go:38-43`). Self-describing structs are left fully uncommented (`route_list.go:41-48` inline `RouteInfo`).

---

## 2. cli/commands Conventions

A flat, convention-heavy command layer. The shape is mandated by the reflection-based `Infer` registrar — deviating breaks the dispatcher.

**Every command is `func Name(ctx *Context, opts struct{ ... }) error` with an INLINE anonymous opts struct** declared in the signature, not a separate named type. **Universal.** `Infer()` panics unless the signature is exactly `(*Context, struct) error` (`infer.go:80-89`). Rare exceptions use a named opts type (4 of ~150): `Version`, `PerformDownloadRelease`, `Register`/`RegisterStandalone`. (`route_list.go:13-16`, `sandbox_list.go:15-20`)

**Name handlers in PascalCase by concatenating the command path words** — `app list` → `AppList`, `env set` → `EnvSet`. **Universal.** Keeps the registration table word-for-word scannable. (`commands.go:220`, `commands.go:368`)

**Compose options by embedding shared mixins**, never re-declaring flags: `FormatOptions` (JSON output), `ConfigCentric` (cluster/`--cluster`/`-C` selection), `AppCentric` (resolves app from working dir; itself embeds `ConfigCentric`). **Universal.** `setup()` type-asserts opts for `LoadConfig`/`LoadCluster`, so embedding auto-wires config loading (`global.go:105-126`). (`app_list.go:16-19`, `env.go:247-250`, `app.go:26-31`)

**Declare flags with mflags struct tags:** `short`/`long`/`description`/`default`/`env` for options; `position:"N"` (or `rest:"true"` for variadic) with `usage` and `required` for positionals; repeated `choice` tags for constrained values. **Universal.** (`cluster_add.go:30-33`, `env.go:346-350`, `logs.go:96`)

**Register everything in one place** — `commands.go RegisterAll(d *mflags.Dispatcher)` — as a flat sequence of `d.Dispatch(path, Infer(name, synopsis, Handler, opts...))` calls. Use `Section(...)` for handler-less grouping nodes; attach metadata via functional options (`WithExample`, `WithDescription`, `WithGroup`, `WithSectionGroup`, `WithLabsFeature`). **Universal.** (`commands.go:201-205`, `commands.go:308`)

**Do NOT introduce a function-dispatch registry map.** Dispatch is the explicit linear sequence of `d.Dispatch` calls plus `switch`/`if` inside handlers (feature flags like `if labs.DistributedRunners()` gate whole blocks). Package-level maps here are pure value lookups (string→bool/string/struct), never function tables. **Universal.** (`commands.go:8-10`; value maps: `logs.go:264-269`, `cluster_add.go:21-27`)

**Use the string group constants** from `help_groups.go` (`GroupGettingStarted`, `GroupMonitoring`, `GroupConfiguring`, `GroupClient`, `GroupServer`, `GroupHidden`). Tag the top-level command/section, not every leaf. `GroupHidden` filters a command out of help. **Common.** A test (`TestAllTopLevelCommandsHaveKnownGroup`) catches drift. (`help_groups.go:8-17`, `help_render.go:18`)

**Treat `*Context` as the I/O + dependency hub.** Write user output through `ctx.Printf` / `ctx.Info` / `ctx.Completed` / `ctx.Warn` / `ctx.Begin` (Stdout, prefixed with checkmark/play glyphs). **Return errors up the stack rather than printing them** — the Invoke runner converts a returned error into the process exit and `wrapRPCError` turns 401s into friendly `ErrAccessDenied`. Print-and-return-nil is reserved for expected empty/not-configured states. **Universal.** (`global.go:213-219`, `route_list.go:105-108`)

**For list/table commands, branch on `opts.IsJSON()` BEFORE table rendering.** Build a **command-local JSON struct** (usually declared inline inside the handler) with `json:"snake_case"` tags and raw/machine values, then `return PrintJSON(items)`. This is the documented house pattern; `route_list.go` is the cited reference. `IsJSON()` honors both `--json` and `--format json`. **Common.** (`route_list.go:40-66`, `format.go:11-19`, `app_list.go:58-108`)

**Get RPC clients with `cl, err := ctx.RPCClient(service)`** (return err immediately, `defer cl.Close()`), then wrap in the typed API constructor (`app_v1alpha.NewCrudClient`, `entityserver_v1alpha.NewEntityAccessClient`, `ingress.NewClient(ctx.Log, cl)`). Enumerate entities via `eac.LookupKind(ctx, kind)` then `eac.List(ctx, attr)`. **Universal.** Service names are bare string literals (`"entities"`, `"dev.miren.runtime/app"`); there is no shared registry — only `rpcAppStatus` is hoisted to a const (`activation_poller.go:13`). (`app_list.go:35-42`, `sandbox_list.go:21-38`)

**File layout: one command per `<noun>_<verb>.go`** (`app_list.go`, `cluster_add.go`), exported entry function first, unexported camelCase helpers below in the same file. Promote a helper to package scope only when genuinely shared. **Exception:** tightly-related subcommand families share one file (`logs.go` holds `LogsApp/LogsSandbox/LogsBuild/LogsSystem`; `env.go` holds `EnvSet/EnvGet/EnvList/EnvDelete`). **Common.** (`sandbox_list.go:307-308`, `cluster_add.go:45`)

---

## 3. Error Handling

Almost entirely standard library. `github.com/pkg/errors` is a legacy holdout.

**Wrap propagated errors with `fmt.Errorf(... %w)`** and a short lowercase operation prefix (often `"<verb> <noun>: %w"`). **Do not use `github.com/pkg/errors.Wrap` in new code** — it survives only in containerd/buildkit-adjacent code (`pkg/containerdx/opts.go`, `controllers/sandbox/sandbox.go:1021`, `pkg/units/data.go:187`). The ratio is decisive: ~1650 `fmt.Errorf`+`%w` sites vs 13 `errors.Wrap`. **Universal.** (`disk_lease_controller.go:100-103`, `file_store.go:96`)

**In CLI handlers, return the error bare** (`return err`); let the top-level `printError` format it. Add `fmt.Errorf` context only when the call site adds information the user needs. **Common.** Re-wrapping every RPC error would just add noise. (`app_list.go:35-45`, `cli.go:100-108`)

**Declare package-level sentinels with `var ErrX = errors.New(...)`.** Export `ErrXxx` when callers match across packages; keep unexported `errXxx` (with a doc comment) for package-local matching. **Common.** (`pkg/entity/entity.go:22-28`, `servers/build/build.go:178-179`)

**Model domain errors as typed structs in `pkg/cond`** (`ErrNotFound`, `ErrConflict`, `ErrCorruption`, `ErrValidationFailure`) carrying `ErrorCategory()`/`ErrorCode()` and a custom `Is()` that matches by type; construct via `cond.NotFound`, `cond.Conflict`, `cond.Errorf`. **Use this family for anything that crosses the RPC boundary** — the category/code are reflected over RPC so a typed error survives the round-trip and stays `errors.Is`-matchable on the client. **Common.** (`pkg/cond/errors.go:10-38`, `pkg/rpc/error.go:27-52`)

**Inspect with `errors.Is` (sentinels/cond) and `errors.As` (typed extraction).** Match cond errors against an empty struct literal: `errors.Is(err, cond.ErrNotFound{})` — its custom `Is()` compares by dynamic type. Reserve `errors.As` for places needing fields (status codes, terminal rendering). **Common.** (`disk_lease_controller.go:119-130`, `global.go:431-442`)

**Use guard-clause early returns:** `if err != nil { return ... }` immediately after the call; prefer inline `if x, err := f(); err != nil` when the result is block-local. Treat empty/not-found as a normal `nil` return with a friendly message, not an error. **Universal.** (`app_list.go:177-180`, `disk_lease_controller.go:93-98`)

**Signpost deliberate error swallowing** — a comment explaining best-effort, `//nolint:errcheck` on deferred Close/cleanup, or a `_ =` assignment. Best-effort failures in background work downgrade to Warn/Debug and continue. **Common.** (`disk_lease_controller.go:78-83`, `otelproxy/proxy.go:22-50`, `disk_migrate.go:28`)

**Decide log-vs-return by layer:** leaf/reconcile functions wrap-and-return so the caller decides; long-lived loops and per-item iterations log (slog) and `continue`/skip so one failure doesn't abort the batch. Log messages are lowercase `"failed to ..."` fragments. **Common.** (`sandboxpool/manager.go:587-601`, `certificate/controller.go:138`)

**slog key for errors is `"error"`, not `"err"`** (~603 vs ~48). **Common**, with a real minority using `"err"`. (`sandboxpool/manager.go:558-562`)

**Name the error variable `err`.** When two+ errors are simultaneously live, give secondaries a `<verb>Err` name (`patchErr`, `getErr`, `saveErr`, `lastErr`) rather than shadowing. **Universal.** (`disk_lease_controller.go:142-149`)

---

## 4. Naming

Standard Go idioms for hand-written code; generated code diverges on acronym casing (see below).

**Short receivers** — almost always a single lowercase letter from the type's first letter; 2-letter initials only to disambiguate (`gr` for `GlobalRouter`, `pm` for `PortMonitor`). Same receiver name across all methods of a type. **Universal** (~2330 single-letter vs ~228 two-letter). (`pkg/rpc/client.go:80-110`, `controllers/sandbox/sandbox.go` — all 55 methods use `c`)

**Terse conventional abbreviations for locals/params:** `err`, `ctx`, `cfg`, `opts`, `args`, `buf`, `req`/`resp`, `enc`/`dec`, `fs`, `res`/`result`, plus domain abbreviations (`eac` = EntityAccessClient, `ic` = ingress client, `cv` = current version). **Universal.** (`route_list.go:22-24`, `oidcauth/authenticator.go:53`)

**`ctx` is overloaded by layer** — in `cli/commands` it is the Miren `*Context` (the handler's first param); in `pkg/` it is stdlib `context.Context`. Do not assume `ctx` means `context.Context` inside `cli/commands`. **Common** (~241 `ctx *Context` signatures in the CLI). (`route_list.go:13` vs `pkg/rpc/client.go:30-31`)

**Constructors: `NewX` for exported, `newX` for unexported**, returning the constructed value/interface; functional-options constructors take variadic `XxxOption`. **Universal** (~157 `NewX`, ~38 `newX`). (`pkg/saga/action.go:43`, `app_list.go:41`)

**No `Get-` prefix on pure accessors** (`Name()`, `Value()`, `String()`, `Id()`). Reserve `Get` for methods that fetch/do work on stores/clients/repos (`GetEntity`, `GetAll`, `GetCurrentVersion`); map-style `(value, ok)` lookups may use `Get`. **Common**, with sanctioned exceptions where a stdlib callback demands it (`certificate/controller.go:362` `GetCertificate` for `tls.Config`). (`pkg/entity/store.go:374`, `pkg/entity/types/types.go:15-30`)

**Acronym casing — the biggest inconsistency in the codebase:**
- **Hand-written code: all-caps acronyms** at word boundaries (`URL`, `HTTP`, `JSON`, `TLS`, `OID`, `WAF`, `API`), lowercased inside compound lowercase identifiers (`tlsCfg`). Counts favor all-caps decisively: URL 897 vs Url 25, JSON 491 vs Json 9, TLS 322 vs Tls 12. `HTTP` is the least consistent (`Http` 84×), largely because generated names like `HttpRoute` leak into call sites. **Common.** (`route_list.go:33`, `rpc/client.go:48-61`)
- **`ID` is genuinely inconsistent — expect both ways.** Standalone fields lean `ID` (`ParentExecutionID`); compounds lean `Id` (`NodeId`, `WorkerId`, `ClusterId`), mirroring the core type `entity.Id`. Counts: `NodeId` 169 vs `NodeID` 17. Same concept is spelled both ways across hand-written packages (`saga.Execution.ID` vs `controller.Event.Id`/`WorkerId`). **Mixed.** (`pkg/saga/types.go:57-79`, `controllers/sandbox/sandbox.go:96`, `pkg/controller/controller.go:30-56`)
- **Generated entity code uses title-case-per-segment acronyms** — `Id`, `Ip`, `Cpu`, `Waf`, `Http`, `ClusterId`, `ShortId`. The identity accessor is **`Id()`, never `ID()`** (33 vs 0). Optional fields get a `Has`-prefixed companion (`HasShortId`, `HasCurrentVersion`). This is `schemagen`'s naive per-underscore title-casing (`generator.go:266-290`) and **directly contradicts** hand-written all-caps. **Universal in generated code.** When reviewing, the cased form tells you whether a symbol is generated (`WafProfile`) or hand-written (`resolveWAFLevel`). (`pkg/entity/types/types.go:8-11`, `app_list.go:92-122`)

**Constants in PascalCase, never SCREAMING_SNAKE** (which appears only as string literals for external env-var names). `Default`/`Max` prefixes for default/limit constants. Typed enums prefix each value with the type name in a const block (`StatusPending Status = "pending"`). **Universal.** Note: value prefix is sometimes a shortened form, not the full type name (`EventType` values are `EventAdded`, not `EventTypeAdded`). (`pkg/saga/types.go:20-36`, `pkg/controller/controller.go:18-25`)

**Func/callback types: role + suffix** — `XxxOption` (functional options over an unexported `*xxxOpts`), `XxxFunc`/`XxxHandler`/`XxxCallback` for handlers. **Common.** (`store.go:135`, `controller.go:64`, `globalrouter/envelope.go:30`)

**Interfaces: `-er`/`-or` for behavioral/single-method roles** (`Authenticator`, `Downloader`, `WriteTracker`, `AttrGetter`); **plain role nouns for capability/client/store interfaces** (`Client`, `Action`, `EntityStore`, `Controller`). **Common**, with single-method exceptions named for the value they expose (`ErrorMessage`, `ErrorCode`). (`controller.go:38-48`, `rpc/client.go:29-35`)

**Package names: short, all-lowercase, single-word, no underscores/mixedCaps; dir matches package.** Sole sanctioned exception: generated versioned API packages `<domain>_v1alpha` (`app_v1alpha`, `compute_v1alpha`). **Universal.** (`pkg/saga/types.go:7`)

---

## 5. Tests

Standard Go table-driven tests; testify dominant but plain `testing` fully accepted.

**Table-driven tests: anonymous-struct slice named `tests`** (sometimes `cases`); description field `name`, expected output `want`/`wantXxx`, inputs by domain meaning. Iterate `for _, tt := range tests` wrapped in `t.Run(tt.name, ...)`. **Universal.** Real variation: some tables use `expected` (`tarx_test.go:186`); name-less tables key the subtest on an input field (`t.Run(tt.input, ...)`, `t.Run(tt.ref, ...)`); `deploy_test.go:14` names the slice `cases`. (`logs_test.go:16-68`, `server_install_test.go:14-98`)

**Do not rebind the loop variable (`tt := tt`)** — the repo is Go 1.25 with automatic per-iteration scoping (`go.mod:3`). **Common.** A few older `pkg` files still carry the pre-1.22 shadow (`shellwords/posix_test.go:64`) but that is not current style.

**Prefer testify; choose `require` vs `assert` by halting semantics** — `require` for preconditions/error checks where continuing is pointless (especially `require.NoError` before dereferencing), `assert` for independent comparisons you want all reported. `r := require.New(t)` per-test handle is an accepted alternative to package-level calls. `require` dominates heavily (~1461 `require.NoError` vs ~34 `assert.NoError`; ~970 `assert.Equal` vs ~95 `require.Equal`). **Common.** (`login_keys_test.go:36-47`, `sandbox/log_test.go:34-51`)

**Plain `t.Errorf`/`t.Fatalf` (no testify) is fully acceptable**, especially for pure-function table tests — `t.Fatalf` to abort on setup/precondition failure, `t.Errorf` for value mismatches, formatted `got = %q, want %q`. **Common** — genuinely split: 7 of 17 `cli/commands` test files use no testify at all; `pkg/` skews toward testify (71 of 127 files). (`logs_test.go:62-66`, `env_test.go:11-23`)

**Name top-level tests `TestXxx`** matching the function/type under test; `_Suffix` only to disambiguate variant suites. Subtest names are lowercase behavioral sentences. **Universal.** (`logs_test.go:71-87`, `login_keys_test.go:25-50`)

**Extract setup into helpers taking `t *testing.T` with `t.Helper()` as the first line.** Common helpers build a `*Context` with `bytes.Buffer` stdout/stderr, write fixtures, or generate material. **Common** — slight variation: helpers doing no fatal work may omit `t` and `t.Helper()` (`login_keys_test.go:17` `newTestContext` vs `cluster_export_test.go:44` `testContext`, coexisting in one package). (`app_test.go:12-21`)

**Use lifecycle helpers for state:** `t.TempDir()` for filesystem fixtures, `t.Setenv` for env, `t.Cleanup` to restore mutated globals (e.g. working dir). **No golden files anywhere in the repo.** **Common** — older code still uses manual `os.Setenv`+`defer os.Unsetenv` (`login_keys_test.go:29-30`). (`app_test.go:44-55`, `env_test.go:58-61`)

**Hand-write all fakes/mocks** — small structs implementing the interface and capturing calls in exported fields, or a central mock with injectable `Func`-typed hooks. **No gomock/mockgen in the repo.** Shared `MockStore`/`InMemEntityServer` give controller tests a real-ish entity backend without etcd. **Universal.** (`sandbox/log_test.go:15-30`, `pkg/entity/mock.go:14-20`, `testutils/inmem_server.go:21-35`)

**Resource-allocating test infra returns a `(thing, cleanup func())` pair** the caller defers. **Common.** (`inmem_server.go:30`, `addon/controller_test.go:182`)

**Pick assertions by intent:** `Equal` (scalar/struct), `ElementsMatch` (order-independent slices), `Contains` (substring/membership), `Len`/`Empty` (sizing), `True`/`False`, `NoError`/`Error` (+ `Contains` on `err.Error()`). **Common.** (`addon/controller_test.go:53-54`, `login_keys_test.go:257-259`)

**Exercise CLI commands two ways:** (1) call the function directly with a hand-built `*Context` (`bytes.Buffer` Stdout/Stderr) and an opts struct, asserting on buffer contents + error; or (2) use the in-process `RunCommand(fn, args...)` harness, which infers, parses, runs, and returns `*CommandOutput{Stdout, Stderr bytes.Buffer}`. Direct-call targets a command's logic; `RunCommand` covers the full parse-and-dispatch path. **Common.** (`infer.go:363-394`, `run_test.go:12-17`, `cluster_export_test.go:66-71`)

---

## 6. Types & Idioms

Idiomatic modern Go (1.25).

**Functional-options pattern is the dominant reason named func-types exist:** exported `type XxxOption func(*xxxOpts)` over an **unexported** opts struct, `WithFoo(...) XxxOption` constructors, applied with `var o xxxOpts; for _, opt := range opts { opt(&o) }`. **Universal** in `pkg/`. A few CLI cases configure an exported struct instead (`infer.go:32` `CommandOption func(*Cmd)`). (`store.go:128-169`, `saga/executor.go:56`)

**Named func-type for single-method callbacks; interface for multi-method abstractions.** Don't define a one-method interface where a func-type reads cleaner. **Common.** (`components/base/base.go:65-70` `TaskCreator`/`ReadyPortGetter`, `controller.go:63-64` `HandlerFunc`)

**Small plain config/value structs with field-level comments, paired with `DefaultXxx()`** (and named-variant) constructors returning a fully-populated value rather than relying on zero values for non-zero defaults. **Common.** (`base.go:20-47` `RestartPolicy`/`DefaultRestartPolicy`/`AggressiveRestartPolicy`)

**Command JSON output: local struct inside the function** with `json:"snake_case"` tags, build `[]T`, `return PrintJSON(items)` — never serialize internal/RPC types. Formatting flows through embedded `FormatOptions.IsJSON()`. **Common.** (`route_list.go:40-66`, `format.go:11-19`) *(Cross-ref §2 — this is the same house pattern.)*

**Externally-visible enums: typed string** — `type X string` + const block of `XValue X = "value"` with doc comments; the string is the wire/storage form. **Common.** (`saga/types.go:19-37`)

**Internal-only enums: `iota` over a typed int**, frequently unexported, with a `String()` method (trailing `default:` → `"unknown"`) when logged. `iota + N` offsets when mapping to an external scheme. **Common.** (`indexwatch/watcher.go:44-77`, `sandbox/sandbox.go:594-598`, `color/color.go:92-103`)

**Slice construction by what's known:** `var s []T` + `append` when count is unknown/conditional (most common — a nil slice is a valid empty slice); `make([]T, len(src))` + index assignment for strict 1:1 transforms; `make([]T, 0, len(src))` + `append` for pre-sized filtered builds. **Common.** (`route_list.go:50-69`, `global.go:249-250`, `mapx/keys.go:9-16`)

**Multi-line composite literals: field:value form, trailing comma on every line.** Package-level lookup tables as `var x = map[K]V{...}` (including anonymous-struct values). **Universal.** (`cluster_add.go:21-27`, `app_history.go:113-123`)

**Guard-clause early returns over nesting.** Tagless `switch { case cond: }` for condition ladders, `switch x { case "...": }` for string/enum dispatch, `switch v := x.(type)` for type discrimination. **Universal.** (`app_history.go:393-404`, `admin.go:639`)

**Modern stdlib `slices`/`strings` helpers**, not hand-rolled loops or `sort.Slice`: `slices.Sort`/`SortFunc`/`Contains`/`ContainsFunc`, `strings.Cut` (preferred over `SplitN` for 2-way splits), `HasPrefix`/`TrimPrefix`, `Fields`. Canonical sorted-map-keys idiom: `make([]K,0,len(m))` + append + `slices.Sort` (or the `pkg/mapx` wrappers). **Common.** (`auth_provider_github.go:98`, `logs.go:349-359`, `debug_netdb.go:41`)

**Context/defer idioms:** pair every `context.WithTimeout`/`WithCancel` with immediate `defer cancel()`; `defer mu.Unlock()` right after locking; for outcome-dependent cleanup use a named return `(err error)` + `defer func() { if err != nil { ... } }()`. **Universal.** (`base.go:248-249`, `sandbox/sandbox.go:960-971`)

**Compile-time interface assertions: `var _ Iface = (*Type)(nil)`** near the implementing type. Use `io.Discard` to suppress unwanted output. **Common.** (`store.go:59`, `activator/activator.go:186`)

**Prefer `any` over `interface{}`** in new code, but the codebase is **not fully migrated** — both appear, sometimes in one file. `admin.go` still uses `map[string]interface{}` extensively alongside `any`. **Mixed.** (`sandbox/sandbox.go:981`, `admin.go:219` vs `admin.go:413,682`)

---

## 7. Concurrency

Concurrency splits by altitude: entrypoints own an errgroup; components own their own goroutines.

**Long-running entrypoints use `errgroup.WithContext`:** derive `(eg, ctx)`, launch each background task with `eg.Go`, plumb the same errgroup into sub-components, block on `eg.Wait()` filtering `context.Canceled`. These are the only places with many independent long-lived goroutines whose first error should tear down the process. **Common.** (`server.go:59`, `server.go:1008-1011`, `runner_start.go:138`, `runner.go:388`)

**A component owns its background goroutines' lifecycle:** in `Start(ctx)` derive a child via `context.WithCancel`, store the cancel func on the struct, track goroutines with a `sync.WaitGroup`; in `Stop()` call `cancel()` then `wg.Wait()`. Prefer the Go 1.25 `wg.Go(func(){...})` form over manual `wg.Add(1)`/`go`/`defer wg.Done()`. **Universal** — but not literally: `watchdog.go:52-62` uses bare `go w.monitor(ctx)` with a stored cancel and no WaitGroup join. (`controller.go:125-137`, `controller.go:268-275`, `indexwatch/watcher.go:204-209`)

**Every long-lived loop selects on `ctx.Done()` as one arm.** Ticker/poll loops: `select { case <-ctx.Done(): return; case <-ticker.C: }`. Backoff/retry sleeps: `select { case <-ctx.Done(): return; case <-time.After(delay): }`. **Universal.** (`controller.go:314-323`, `deployment/launcher.go:1169-1173`)

**Enqueue to a possibly-full buffered channel with a non-blocking `default` that logs and drops** — never block the watch stream when consumers fall behind (dropped events recover via periodic resync). Deletion/important events are never dropped. **Common.** (`controller.go:208-216`, `controller.go:293-303`)

**Detach shutdown/cleanup work from a cancelled context** via `context.WithTimeout(context.Background(), N)` in a deferred closure + `defer cancel()`. Conventional durations: component `Stop` 30s; tracing/HTTP shutdown 5s; bulk container cleanup 2m. **Common.** (`server.go:270-277`, `server.go:619-624`, `server.go:1153-1154`)

**Timeouts/intervals: named package consts when reused/semantic, inline `time.Duration` literals when local.** Named consts typed via multiplication (`const X = N * time.Second`); resync periods commonly passed as bare literals at controller construction. **Mixed** — bare literals are equally common (`runner.go:790` passes `5*time.Minute` directly). (`policy_fetcher.go:16-17`, `sandbox/sandbox.go:590-591`)

**Channel buffering by role:** unbuffered `chan struct{}` for one-shot signals/closers; **size-1 buffered result/error channels** (`chan error, 1`) so a worker can always send and exit even if the consumer bailed on timeout/ctx — this specifically prevents goroutine leaks; large buffers for event/work queues; `chan os.Signal, 1` for `signal.Notify`. **Common.** (`autocert_controller.go:296-319`, `controller.go:112`, `server.go:972-973`)

**Guard shared state with a struct-field mutex:** `sync.RWMutex` for read-heavy caches/lookup maps (RLock in getters), `sync.Mutex` for general state, `sync.Once` for idempotent Start/Stop/Sync and one-time init/capability detection. **Universal.** (`dns/dns.go:31-36`, `policy_fetcher.go:213-217`, `indexwatch/watcher.go:161-165`)

**Best-effort background work is fine** — launched with bare `go func(){...}` that logs (not returns) errors. **When a goroutine's termination depends on something non-obvious** (a parent `ctx.Done()` arm, an outer cancel func, the process exiting), **add a comment explaining why it is not a leak.** **Common.** (`globalrouter/pop.go:278-285`, `rpc/client.go:759-765`, `runner.go:506-513`)

---

## 8. Imports & Structure

Follows gofmt/goimports defaults (not gofumpt). No `local-prefixes` configured, so both two-group and three-group import styles pass the linter.

**Default: two import groups** — stdlib first, then ONE merged block of everything non-stdlib (`github.com`, `golang.org`, `miren.dev/mflags`, `miren.dev/runtime/*`) sorted alphabetically together, no blank line between third-party and internal. This is the path of least resistance under goimports. **Common** — the majority overall (CLI 23/26, pkg 36/47 of mixed-import files), but a real split. (`app_status.go:3-12`, `cluster_add.go:14-18`)

**Stdlib always comes first, in its own group, blank-line separated.** **Universal.** (`route_list.go:3-11`, `scheduler.go:3-12`)

**Three-group split is an accepted alternative** (stdlib | third-party | internal `miren.dev/runtime/*`) and is the **prevailing style in `controllers/`** (heavy on containerd deps; only 3/10 mixed-import files merge). goimports preserves author-inserted blank lines, so the manual third group survives reformatting. **Common.** A rarer fourth variant pulls `api/*_v1alpha` packages into a trailing aliased group (`sandbox/sandbox.go:30-46`). (`watchdog.go:8-16`, `deploy.go:24-27`)

**Import generated `*_v1alpha` packages unaliased** — the name already carries the version (`app_v1alpha`, `compute_v1alpha`). Apply a short alias (`compute`, `storage`, `core`) only to cut repetition; **alias non-versioned `api/<name>` packages** (`appclient`, `coreutil`, `apiserver`) since their bare name is just the directory. Unaliased dominates by raw count (`entityserver_v1alpha` 86× unaliased; `compute` alias ~28×). **Common.** (`route_list.go:7-9`, `sandbox/sandbox.go:42-46`, `servers/app/app.go:11-16`)

**Standard Go top-level declaration order:** imports → const → var (including `var _ Iface = &T{}` assertions) → types → constructor (`New*`) → methods → unexported helpers. **Common.** (`sandbox/sandbox.go:49-54`, `servers/app/app.go:44-55`)

**Exported entry point first, unexported helpers after.** In controllers/servers, helpers cluster at the bottom; tightly-scoped helpers may sit immediately above their first caller. **Common** — `servers/app/app.go:58-79` interleaves `versionShortId`/`shortIDFromEntity` between constructor and exported method rather than at the bottom. (`app_list.go:192-206`, `scheduler.go:134-150`)

**CLI: one command per file, named after the command** (`alias_list.go` → `AliasList`); exported function first; per-command JSON structs declared as local types inside the function body, not at package scope. **Universal.** (`alias_list.go:11-37`, `route_list.go:13-48`) *(Cross-ref §2/§6.)*

**Platform code splits by filename suffix:** `_linux.go`/`_darwin.go`/`_windows.go` for a recognized GOOS, `_other.go` for the catch-all. **`_other.go` always carries an explicit `//go:build !linux`** (since "other" is not a GOOS); a non-suffixed default file carries explicit `//go:build linux`. **Whether GOOS-suffixed files repeat a redundant `//go:build` is genuinely inconsistent** — `commands_linux.go` and `color/live_linux.go` carry none (relying on the suffix), while `debug_bundle_linux.go`, `server_darwin.go`, and `firewall_darwin.go` carry redundant tags matching their suffix. **Common.** (`commands_other.go:1-3`, `firewall.go:1-3`)

---

## Cross-Dimension Conflicts & Genuine Inconsistencies

1. **Acronym casing is the single biggest house inconsistency.** Hand-written code uses all-caps (`URL`, `JSON`, `TLS`, `WAF`); generated `schemagen` code uses title-case-per-segment (`Id`, `Http`, `Waf`). The identity accessor is `Id()`, never `ID()`. `ID` vs `Id` is split even within hand-written code (`saga` uses `ID`; `controller`/`sandbox` use `Id`). When writing: match the surrounding file and follow the generated convention when touching entity types. When reviewing: don't flag `WafProfile`/`HttpRoute` at generated call sites, but do expect all-caps in new hand-written identifiers.

2. **Doc-comment-the-handler is inconsistent inside the CLI.** Most command handlers are bare, but `env.go`, `cluster_add.go`, and the entire `logs.go` family are documented. This is not resolvable to one rule — both are present. Leaning bare (treating the handler as framework wiring) is the more common choice.

3. **Import grouping (two vs three groups) is genuinely mixed** and linter-neutral. Default to two groups in `cli/`/`pkg/`; use three groups in `controllers/` to match local convention.

4. **`interface{}` vs `any`** coexist mid-migration; prefer `any` in new code but don't treat `interface{}` as a defect.

5. **Timeout literals vs named consts** is mixed; neither is wrong. Name them when reused or semantically important.

6. **testify vs plain `testing`** is a real ~50/50 split in `cli/commands` (7 of 17 files plain). Both are house style; pure-function table tests lean plain, anything touching errors/IO leans `require`.

When in doubt, the unifying meta-rule is the one Miren states for itself: **comment the non-obvious, keep wiring terse, and let verbosity scale with subtlety.**
