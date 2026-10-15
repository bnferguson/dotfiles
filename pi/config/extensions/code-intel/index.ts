/**
 * code-intel — structural code navigation as first-class pi tools.
 *
 * pi ships no MCP client (by design — see pi docs/usage.md), so codegraph's
 * MCP verbs are unreachable here. Every one of them has a CLI equivalent, so
 * this extension wraps them (plus vera and ast-grep) as native pi tools. That
 * lands them better than MCP would: they get promptSnippet/promptGuidelines
 * entries in the system prompt, so the model sees them next to `grep`.
 *
 * The point is the routing pressure, not just the tools. A Claude Code skill
 * can only *ask* the model to prefer the index; pi can enforce it:
 *
 *   off     tools registered, no pressure
 *   on      grep/find get one redirect to the structural equivalent, then
 *           pass through if the model still wants them (opt-in)
 *   strict  grep/find removed from the active tool set entirely — the model
 *           has no textual fallback. This is the measurement mode.
 *
 * Toggle with /code-intel, Ctrl+Alt+I, or --code-intel <mode>. Auto-enables
 * `on` when a repo already has .codegraph/ or .vera/.
 *
 * Routine synchronization runs in the background and before queries.
 * Confirmed initialization and repair use the `code-intel` helper, which
 * coordinates watchers and keeps logs.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { IndexObservability, type Trigger } from "./observability.ts";
import { readIndexHealth, workspaceSnapshot, type WorkspaceSnapshot, type IndexHealth } from "./health.ts";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Key } from "@earendil-works/pi-tui";
import { Type } from "typebox";

type Mode = "off" | "on" | "strict";
type IndexBackend = "codegraph" | "vera" | "graphify";

const MODES: Mode[] = ["off", "on", "strict"];
const TEXT_TOOLS = ["grep", "find"];
const EXEC_TIMEOUT = 120_000;

/** Tools this extension registers, in the order they're advertised. */
const OWNED_TOOLS = [
	"cg_context",
	"cg_query",
	"cg_callers",
	"cg_callees",
	"cg_impact",
	"vera_search",
	"ast_search",
	"ast_rewrite",
	"gf_query",
	"gf_explain",
	"gf_affected",
	"gf_overview",
];

/**
 * How long a sync result is trusted before we bother re-checking. The dirty
 * check itself is ~0.1s (git) and a no-op sync is ~0.3-1s, so this only exists
 * to avoid re-syncing between sibling tool calls in one batch.
 */
const SYNC_DEBOUNCE_MS = 5_000;
const BACKGROUND_DEBOUNCE_MS = 2_000;

/**
 * Budget for auto-syncing graphify before a gf_* call. Above this it stays
 * manual (`/code-intel-sync`) and the tool reports its staleness instead.
 */
const GRAPHIFY_AUTOSYNC_BUDGET_MS = 8_000;

/**
 * Conservative cost estimate for a graphify rebuild, used only until we've
 * timed a real one. graphify re-extracts the whole corpus every run — there is
 * no incremental path — so cost tracks corpus size, not the size of the change.
 * Measured 0.79 s/MB of graph.json on a small repo and 0.87 s/MB on a large one,
 * so 0.9 rounds up honestly.
 */
const GRAPHIFY_MS_PER_MB = 900;

function have(bin: string): boolean {
	// Cheap PATH probe — avoids paying for a subprocess per tool registration.
	const dirs = (process.env.PATH ?? "").split(":").filter(Boolean);
	return dirs.some((d) => existsSync(join(d, bin)));
}

export default function codeIntelExtension(pi: ExtensionAPI): void {
	let mode: Mode = "off";
	/** Tool set captured before strict mode pruned it, for restore on exit. */
	let toolsBeforeStrict: string[] | undefined;
	/**
	 * Redirect budget: each distinct text search is nudged once, then allowed.
	 * Session-scoped on purpose. An earlier version cleared this every turn, which
	 * silently broke the contract the block message advertises — the model's retry
	 * lands in a *new* turn, so it got blocked again on a call it was explicitly
	 * told would succeed. Never expire these within a session.
	 */
	const nudged = new Set<string>();

	const hasCodegraph = have("codegraph");
	const hasVera = have("vera");
	const hasAstGrep = have("ast-grep");
	const hasGraphify = have("graphify");
	const hasHelper = have("code-intel");

	pi.registerFlag("code-intel", {
		description: "Start in a code-intel mode: off | on | strict",
		type: "string",
		default: "",
	});

	// A schema mismatch cannot be fixed by another incremental update. Remember
	// it until explicit sync/repair, rather than starting a doomed writer on every
	// query. Ordinary lock contention and CLI argument errors are not repairs.
	const repairNeeded = new Map<string, string>();
	const indexAdvisories = new Map<string, string>();
	const stateHome = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
	const monitors = new Map<string, IndexObservability>();
	const verified = new Set<string>();
	const syncedFingerprint = new Map<string, string>();
	const lastWrittenFingerprint = new Map<string, string>();
	const observedFingerprint = new Map<string, string>();
	const changedAt = new Map<string, number>();
	const backendVersions = new Map<string, string>();
	const writerEpoch = new Map<string, number>();
	let statusContext: ExtensionContext | undefined;
	let statusTimer: ReturnType<typeof setInterval> | undefined;
	let healthPoll: Promise<void> | undefined;
	let statusGeneration = 0;
	const elapsed = (start: number) => Math.max(0, Date.now() - start);
	const busyIndex = (detail: string) => /database is locked|SQLITE_BUSY|SQLITE_LOCKED|could not acquire file lock|failed to acquire index lock|failed to acquire Lockfile:/i.test(detail);

	function monitor(cwd: string): IndexObservability {
		let value = monitors.get(cwd);
		if (!value) { value = new IndexObservability(cwd, { stateHome }); monitors.set(cwd, value); }
		return value;
	}

	// Rendering reads memory only; read-only probes belong to a separate poll.
	function publishHealth(cwd: string, ctx = statusContext): void {
		if (ctx?.cwd === cwd) ctx.ui.setStatus("code-intel-indexes", monitor(cwd).footer());
	}

	async function snapshot(cwd: string): Promise<WorkspaceSnapshot | undefined> {
		try { return await workspaceSnapshot(cwd, (bin, args, options) => pi.exec(bin, args, options)); }
		catch { return undefined; }
	}

	function failed(which: IndexBackend, cwd: string, err: unknown): void {
		const detail = err instanceof Error ? err.message : String(err);
		const repair = repairNeeded.has(`${which}:${cwd}`);
		const failure = /no completed build/.test(detail) ? "No completed build for this workspace" : /invalid JSON/.test(detail) ? "Backend returned invalid JSON" : /permission denied/i.test(detail) ? "Index access denied" : "Backend operation failed; inspect the backend or retained helper log";
		const repairReason = /format|schema|incompatible/i.test(repairNeeded.get(`${which}:${cwd}`) ?? "") ? "Incompatible index format" : "Incomplete or corrupt index";
		const reason = repair ? `${repairReason}; /code-intel-repair ${which}` : busyIndex(detail) ? "Another index writer is active" : failure;
		monitor(cwd).update(which, { state: repair ? "repair" : busyIndex(detail) ? "updating" : "unavailable", reason, lastFailure: Date.now(), failureReason: reason });
		publishHealth(cwd);
	}

	function updating(which: IndexBackend, cwd: string): void {
		const key = `${which}:${cwd}`;
		writerEpoch.set(key, (writerEpoch.get(key) ?? 0) + 1);
		monitor(cwd).update(which, { state: "updating", reason: "" });
		publishHealth(cwd);
	}

	async function succeeded(which: IndexBackend, cwd: string, before?: WorkspaceSnapshot): Promise<number | undefined> {
		const key = `${which}:${cwd}`;
		const after = await snapshot(cwd);
		const changed = before && after && before.fingerprint !== after.fingerprint;
		if (before) { syncedFingerprint.set(key, before.fingerprint); lastWrittenFingerprint.set(key, before.fingerprint); }
		if (which !== "vera") verified.add(key);
		const unchecked = which === "vera" && !verified.has(key);
		const lag = changedAt.has(key) && !unchecked ? elapsed(changedAt.get(key)!) : undefined;
		if (changed) { if (!changedAt.has(key)) changedAt.set(key, Date.now()); }
		else if (!unchecked) changedAt.delete(key);
		const advisory = indexAdvisories.get(key);
		monitor(cwd).update(which, { state: changed || advisory ? "stale" : unchecked ? "unchecked" : "ready", reason: changed ? "Workspace changed during indexing" : advisory ?? (unchecked ? "Update completed; vector queries not yet verified" : ""), lastSuccess: Date.now(), changeToReadyMs: changed ? undefined : lag });
		publishHealth(cwd);
		return changed ? undefined : lag;
	}

	async function waitForWriter(which: IndexBackend, cwd: string, job: Promise<void>, trigger: Trigger): Promise<void> {
		const start = Date.now();
		let outcome: "success" | "failure" = "success";
		try { await job; } catch (err) { outcome = "failure"; throw err; }
		finally { monitor(cwd).record({ backend: which, event: "writer-wait", trigger, outcome, waitMs: elapsed(start) }); }
	}

	function helperLog(which: IndexBackend, cwd: string, output: string): void {
		const path = output.match(/^[ \t]*logs: (\/[^\r\n]+)$/m)?.[1];
		if (path) monitor(cwd).update(which, { logPath: join(path, `${which}.log`) });
	}

	const backgroundTimers = new Map<string, { fingerprint: string; timer: ReturnType<typeof setTimeout> }>();
	const backgroundJobs = new Set<Promise<void>>();
	const backgroundAttempts = new Map<string, string>();

	function scheduleBackground(which: IndexBackend, cwd: string, frame: WorkspaceSnapshot, trigger: Trigger): void {
		const key = `${which}:${cwd}`;
		if (statusContext?.cwd !== cwd || repairNeeded.has(key)) return;
		if (!["ready", "unchecked", "stale"].includes(monitor(cwd).get(which).state)) return;
		if (which === "graphify" && rebuildCostMs(cwd) > GRAPHIFY_AUTOSYNC_BUDGET_MS) return;
		if (lastWrittenFingerprint.get(key) === frame.fingerprint || backgroundAttempts.get(key) === frame.fingerprint) return;
		const pending = backgroundTimers.get(key);
		if (pending?.fingerprint === frame.fingerprint) return;
		if (pending) clearTimeout(pending.timer);
		const generation = statusGeneration;
		const wait = Math.max(BACKGROUND_DEBOUNCE_MS, (lastSync.get(key) ?? 0) + SYNC_DEBOUNCE_MS - Date.now());
		const timer = setTimeout(() => {
			backgroundTimers.delete(key);
			if (generation !== statusGeneration) return;
			const job = updateInBackground(which, cwd, trigger, generation).catch(err => { failed(which, cwd, err); });
			backgroundJobs.add(job);
			void job.finally(() => { backgroundJobs.delete(job); });
		}, wait);
		timer.unref?.();
		backgroundTimers.set(key, { fingerprint: frame.fingerprint, timer });
	}

	async function updateInBackground(which: IndexBackend, cwd: string, trigger: Trigger, generation: number): Promise<void> {
		const key = `${which}:${cwd}`;
		const running = inFlight.get(key);
		if (running) await waitForWriter(which, cwd, running, trigger);
		const frame = await snapshot(cwd);
		if (!frame || generation !== statusGeneration) return;
		if (lastWrittenFingerprint.get(key) === frame.fingerprint || backgroundAttempts.get(key) === frame.fingerprint) return;
		if (Date.now() - (lastSync.get(key) ?? 0) < SYNC_DEBOUNCE_MS) {
			scheduleBackground(which, cwd, frame, trigger);
			return;
		}
		// One attempt per fingerprint: a failed writer must not loop every poll.
		backgroundAttempts.set(key, frame.fingerprint);
		requireHealthy(which, cwd);
		if (which !== "graphify") await probeReady(which, cwd);
		await sync(which, cwd, trigger);
		if (which === "vera") await run("vera", ["search", "index health verification", "--limit", "1"], undefined, undefined, cwd);
		const after = await snapshot(cwd);
		if (after && generation === statusGeneration) scheduleBackground(which, cwd, after, "files-changed");
	}

	async function refreshHealth(ctx: ExtensionContext): Promise<void> {
		if (healthPoll) { await healthPoll; return refreshHealth(ctx); }
		const generation = statusGeneration;
		healthPoll = (async () => {
			const frame = await snapshot(ctx.cwd);
			const previous = observedFingerprint.get(ctx.cwd);
			if (frame) observedFingerprint.set(ctx.cwd, frame.fingerprint);
			await Promise.all((["codegraph", "vera", "graphify"] as IndexBackend[]).map(async (which) => {
				const key = `${which}:${ctx.cwd}`;
				const observer = monitor(ctx.cwd);
				if (inFlight.has(key)) return undefined;
				const installed = { codegraph: hasCodegraph, vera: hasVera, graphify: hasGraphify }[which];
				if (!installed || !indexedWith(ctx).includes(which)) {
					observer.update(which, { state: installed ? "missing" : "unavailable", reason: installed ? "No index; /code-intel-init" : "Executable not on PATH; install the code-intel topic" });
					return undefined;
				}
				if (frame && previous && previous !== frame.fingerprint) {
					if (!changedAt.has(key)) changedAt.set(key, Date.now());
					if (!syncedFingerprint.has(key)) syncedFingerprint.set(key, previous);
				}
				if (repairNeeded.has(key)) { observer.update(which, { state: "repair", reason: `Index needs repair; /code-intel-repair ${which}` }); return undefined; }
				const old = observer.get(which);
				const epoch = writerEpoch.get(key);
				let next: IndexHealth;
				const start = Date.now();
				try { next = await readIndexHealth(which, ctx.cwd, (bin, args, options) => pi.exec(bin, args, options), frame?.head); }
				catch { next = { state: "unavailable" as const, reason: "Read-only health check failed" }; }
				// A slow read must not paint over a writer that started meanwhile.
				if (inFlight.has(key) || writerEpoch.get(key) !== epoch || generation !== statusGeneration) return undefined;
				// A matching build commit does not cover later uncommitted edits.
				if (which === "graphify" && next.state === "ready" && frame?.latestDirtyMtime !== undefined && next.lastSuccess !== undefined && frame.latestDirtyMtime > next.lastSuccess && frame.fingerprint !== syncedFingerprint.get(key))
					next = { ...next, state: "stale", reason: "Working-tree edits are newer than the graph; /code-intel-sync" };
				if (next.state === "repair") repairNeeded.set(key, `${which} index needs repair`);
				else if (next.state === "unchecked" && which === "vera" && verified.has(key)) {
					const stale = frame && syncedFingerprint.has(key) && frame.fingerprint !== syncedFingerprint.get(key);
					next = { ...next, state: stale ? "stale" : "ready", reason: stale ? "Workspace changes await a verified sync" : "" };
				} else if (next.state === "ready") {
					const versionChanged = next.version && backendVersions.has(key) && backendVersions.get(key) !== next.version;
					if (next.version) backendVersions.set(key, next.version);
					if (frame && (versionChanged || !syncedFingerprint.has(key))) syncedFingerprint.set(key, frame.fingerprint);
					if (frame && frame.fingerprint !== syncedFingerprint.get(key)) next = { ...next, state: "stale", reason: "Workspace changes await a verified sync" };
				}
				const lag = next.state === "ready" && changedAt.has(key) ? elapsed(changedAt.get(key)!) : undefined;
				if (lag !== undefined) changedAt.delete(key);
				if (next.lastSuccess !== undefined && old.lastSuccess !== undefined) next.lastSuccess = Math.max(next.lastSuccess, old.lastSuccess);
				observer.update(which, { ...next, reason: next.reason ?? "", changeToReadyMs: lag, ...(["unavailable", "repair"].includes(next.state) ? { lastFailure: Date.now(), failureReason: next.reason } : {}) });
				if (old.state !== next.state || (old.reason ?? "") !== (next.reason ?? "") || lag !== undefined)
					observer.record({ backend: which, event: "probe", trigger: "health-check", outcome: ["unavailable", "repair"].includes(next.state) ? "failure" : next.state === "updating" ? "skipped" : "success", durationMs: elapsed(start), changeToReadyMs: lag });
				if (frame) scheduleBackground(which, ctx.cwd, frame,
					lastRevision.has(key) && frame.head !== lastRevision.get(key) ? "head-changed" : previous && previous !== frame.fingerprint ? "files-changed" : "health-check");
				return undefined;
			}));
			if (generation === statusGeneration) publishHealth(ctx.cwd, ctx);
		})();
		try { await healthPoll; } finally { healthPoll = undefined; }
	}

	function stopHealth(): void {
		statusGeneration++;
		if (statusTimer) clearInterval(statusTimer);
		statusTimer = undefined;
		for (const { timer } of backgroundTimers.values()) clearTimeout(timer);
		backgroundTimers.clear();
		statusContext?.ui.setStatus("code-intel-indexes", undefined);
		statusContext = undefined;
	}

	async function startHealth(ctx: ExtensionContext): Promise<void> {
		stopHealth();
		if (!ctx.hasUI || ctx.mode !== "tui") return;
		statusContext = ctx;
		const generation = statusGeneration;
		publishHealth(ctx.cwd);
		await refreshHealth(ctx);
		if (generation !== statusGeneration) return;
		statusTimer = setInterval(() => {
			if (generation === statusGeneration) void refreshHealth(ctx).catch(() => {});
		}, 30_000);
		statusTimer.unref?.();
	}
	function repairMessage(which: IndexBackend, cwd: string, detail: string): string {
		return `${which} index requires repair in ${cwd}: ${detail}\nRun /code-intel-repair ${which} for a confirmed rebuild, or /code-intel-sync after an external repair. Until then use lsp_* or read/grep; in strict mode use /code-intel on.`;
	}
	function recordRepair(which: IndexBackend, cwd: string, detail: string): void {
		if (/index format version mismatch|incompatible (?:index|schema)|index is incomplete|SQLITE_CORRUPT|database disk image is malformed|could not load graph.*(?:invalid JSON|parse)/i.test(detail)) {
			repairNeeded.set(`${which}:${cwd}`, detail.trim());
			failed(which, cwd, detail);
		}
	}
	function requireHealthy(which: IndexBackend, cwd: string): void {
		const detail = repairNeeded.get(`${which}:${cwd}`);
		if (detail) throw new Error(repairMessage(which, cwd, detail));
	}

	/** Only read operations retry: never start competing writers or clear locks. */
	async function readIndex(bin: string, args: string[], cwd?: string, signal?: AbortSignal) {
		const deadline = Date.now() + 15_000;
		for (let attempt = 0; ; attempt++) {
			signal?.throwIfAborted();
			const probe = args[0] === "status" || args[0] === "--json";
			const result = await pi.exec(bin, args, { cwd, signal, timeout: probe ? Math.max(1, deadline - Date.now()) : EXEC_TIMEOUT });
			const detail = `${result.stderr}\n${result.stdout}`;
			const busy = busyIndex(detail);
			if (result.code === 0 || !busy || attempt >= 2) {
				if (result.code !== 0 && cwd) recordRepair(bin as IndexBackend, cwd, detail);
				return result;
			}
			const wait = attempt === 0 ? 250 : 1000;
			if (Date.now() + wait >= deadline) return result;
			const startedAt = Date.now();
			try { await delay(wait, undefined, { signal }); }
			finally { if (cwd) monitor(cwd).record({ backend: bin as IndexBackend, event: "lock-wait", trigger: "query", outcome: "skipped", waitMs: elapsed(startedAt) }); }
		}
	}

	/** Directory presence is not readiness, especially during the first build. */
	async function probeReady(which: "codegraph" | "vera", cwd: string): Promise<void> {
		const args = which === "codegraph" ? ["status", "--json", cwd] : ["--json", "stats"];
		const result = await readIndex(which, args, cwd);
		if (result.code !== 0) {
			requireHealthy(which, cwd);
			throw new Error(`${which} index is unavailable: ${(result.stderr || result.stdout).trim()}\nUse lsp_* or read/grep for now; retry after indexing completes.`);
		}
		let status: { initialized?: boolean; lastIndexed?: string; worktreeMismatch?: unknown; file_count?: number; index?: { reindexRecommended?: boolean } };
		try {
			status = JSON.parse(result.stdout);
		} catch {
			throw new Error(`${which} readiness probe returned invalid JSON; use lsp_* or read/grep for now.`);
		}
		if (which === "codegraph" && (status?.initialized !== true || typeof status.lastIndexed !== "string" || !status.lastIndexed || status.worktreeMismatch)) {
			throw new Error("codegraph index has no completed build for this workspace. Wait for indexing to finish; if no build is running, use /code-intel-repair codegraph for a confirmed rebuild. Use lsp_* or read/grep for now.");
		}
		if (which === "vera" && (!Number.isInteger(status?.file_count) || (status.file_count ?? -1) < 0)) {
			throw new Error("vera readiness probe returned invalid index statistics; use lsp_* or read/grep for now.");
		}
		if (which === "codegraph") {
			const key = `${which}:${cwd}`;
			if (status.index?.reindexRecommended) indexAdvisories.set(key, "Codegraph recommends reindexing after an extractor upgrade. Run /code-intel-repair codegraph for a confirmed rebuild.");
			else indexAdvisories.delete(key);
		}
	}

	// ------------------------------------------------------------ index sync

	/**
	 * Keeping the indexes fresh, measured rather than assumed (6000-file repo):
	 *
	 *   codegraph sync, no-op ......... 0.29s
	 *   vera update, no-op ............ 0.96s
	 *   vera update, one file changed . 0.47s
	 *   git ls-files -m -o ............ 0.10s
	 *
	 * All cheap enough to run inline before a query, so these tools sync
	 * themselves rather than serving stale answers. In Claude Code codegraph is
	 * kept fresh by the watcher in its MCP server — pi has no MCP, so nothing
	 * would sync it here at all if we didn't do it explicitly.
	 *
	 * The one genuine hazard is INTERRUPTION, not cost. A `vera update` killed
	 * mid-flight leaves its content-hash bookkeeping inconsistent, and the next
	 * update re-embeds everything it lost track of: measured at 1692 files /
	 * 19.5 minutes wall / 71 minutes CPU, from a single Ctrl+C. So sync never
	 * receives the tool's AbortSignal and is never killed on shutdown — a
	 * half-finished index is far more expensive than a slow one.
	 */
	const lastSync = new Map<string, number>();
	const lastRevision = new Map<string, string | undefined>();
	async function revision(cwd: string): Promise<string | undefined> {
		try {
			const r = await pi.exec("git", ["-C", cwd, "rev-parse", "HEAD"], { timeout: 5000 });
			return r.code === 0 ? r.stdout.trim() || undefined : undefined;
		} catch { return undefined; }
	}
	const inFlight = new Map<string, Promise<void>>();
	/** Measured wall time of the last completed sync, per key. Beats estimating. */
	const syncCostMs = new Map<string, number>();

	/** Cheap uncommitted-change probe. Empty result doesn't prove clean (a commit
	 * or branch switch also invalidates), so it only ever short-circuits work. */
	async function dirtyCount(cwd: string): Promise<number> {
		try {
			const r = await pi.exec("git", ["-C", cwd, "--no-optional-locks", "status", "--porcelain", "--untracked-files=normal"], { timeout: 5000 });
			return r.code === 0 ? r.stdout.split("\n").filter(Boolean).length : 1;
		} catch {
			return 1;
		}
	}

	async function sync(which: IndexBackend, cwd: string, trigger: Trigger = "query"): Promise<void> {
		const key = `${which}:${cwd}`;
		const running = inFlight.get(key);
		if (running) return waitForWriter(which, cwd, running, trigger);
		requireHealthy(which, cwd);

		const last = lastSync.get(key) ?? 0;
		if (Date.now() - last < SYNC_DEBOUNCE_MS) {
			monitor(cwd).record({ backend: which, event: "debounce", trigger, outcome: "skipped" });
			return;
		}

		const startedAt = Date.now();
		updating(which, cwd);
		if (which === "vera") verified.delete(key);
		const job = (async () => {
			try {
				const before = await snapshot(cwd);
				const previous = lastWrittenFingerprint.get(key);
				const headAtStart = before?.head ?? await revision(cwd);
				// No signal OR timeout: either would kill a partially written index.
				let result: Awaited<ReturnType<ExtensionAPI["exec"]>>;
				if (which === "codegraph") result = await pi.exec("codegraph", ["sync", cwd], { cwd });
				else if (which === "graphify") result = await pi.exec("graphify", ["update", cwd], { cwd });
				else result = await pi.exec("vera", ["update", cwd], { cwd });
				// pi.exec returns non-zero exits; it doesn't throw for them.
				if (result.code !== 0) {
					const detail = result.stderr || result.stdout || `${which} sync failed`;
					recordRepair(which, cwd, detail);
					throw new Error(detail);
				}
				lastRevision.set(key, headAtStart);
				if (which !== "graphify") await probeReady(which, cwd);
				syncCostMs.set(key, Date.now() - startedAt);
				lastSync.set(key, Date.now());
				const lag = await succeeded(which, cwd, before);
				monitor(cwd).record({ backend: which, event: "update", trigger, outcome: "success", durationMs: elapsed(startedAt), noChange: previous && before ? previous === before.fingerprint : undefined, changeToReadyMs: lag });
			} catch (err) {
				failed(which, cwd, err);
				monitor(cwd).record({ backend: which, event: "update", trigger, outcome: "failure", durationMs: elapsed(startedAt) });
				requireHealthy(which, cwd);
				throw new Error(`${which} index could not be made ready: ${err instanceof Error ? err.message : String(err)}\nUse lsp_* or read/grep for now; retry after indexing completes. Cold indexing requires confirmation.`);
			} finally {
				inFlight.delete(key);
			}
		})();
		inFlight.set(key, job);
		return job;
	}

	/** Called at the top of every index-backed tool. */
	async function freshen(which: "codegraph" | "vera", cwd: string): Promise<void> {
		const key = `${which}:${cwd}`;
		// Even a clean probe must not bypass an updater already writing this index.
		try {
			const running = inFlight.get(key);
			if (running) await waitForWriter(which, cwd, running, "query");
			requireHealthy(which, cwd);
			await probeReady(which, cwd);
			requireHealthy(which, cwd);
			const head = await revision(cwd);
			const headChanged = lastRevision.has(key) && head !== lastRevision.get(key);
			if (headChanged) lastSync.delete(key); // A branch switch must bypass debounce.
			if (!lastSync.has(key) || headChanged || (await dirtyCount(cwd)) > 0)
				await sync(which, cwd, headChanged ? "head-changed" : !lastSync.has(key) ? "first-query" : "files-changed");
		} catch (err) {
			failed(which, cwd, err);
			monitor(cwd).record({ backend: which, event: "blocked-query", trigger: "query", outcome: "failure" });
			throw err;
		}
	}

	// ---------------------------------------------------------------- helpers

	/**
	 * Which indexes exist here, and which could. The three are complementary
	 * rather than alternatives — codegraph traverses, vera finds by meaning,
	 * graphify spans docs — so a project with only one is under-served, and the
	 * missing list is worth surfacing rather than quietly working around.
	 */
	function indexReport(cwd: string): { present: string[]; missing: string[] } {
		const all: [boolean, string, string][] = [
			[hasCodegraph, "codegraph", ".codegraph"],
			[hasVera, "vera", ".vera"],
			[hasGraphify, "graphify", join("graphify-out", "graph.json")],
		];
		const present: string[] = [];
		const missing: string[] = [];
		for (const [installed, name, marker] of all) {
			if (!installed) continue; // tool isn't on this machine; not a gap to nag about
			(existsSync(join(cwd, marker)) ? present : missing).push(name);
		}
		return { present, missing };
	}

	function indexedWith(ctx: { cwd: string }): string[] {
		return indexReport(ctx.cwd).present;
	}

	/**
	 * Run a CLI tool and hand its stdout to the LLM verbatim. Non-zero exits are
	 * thrown so pi flags the tool result as an error rather than feeding the
	 * model an empty success.
	 */
	async function run(bin: string, args: string[], signal?: AbortSignal, hint?: string, cwd?: string) {
		const indexed = bin === "codegraph" || bin === "vera" || bin === "graphify";
		const startedAt = Date.now();
		const result = indexed
			? await readIndex(bin, args, cwd, signal)
			: await pi.exec(bin, args, { cwd, signal, timeout: EXEC_TIMEOUT });
		if (result.code !== 0) {
			const detail = (result.stderr || result.stdout || "").trim();
			if (indexed && cwd) {
				failed(bin as IndexBackend, cwd, detail);
				monitor(cwd).record({ backend: bin as IndexBackend, event: "blocked-query", trigger: "query", outcome: "failure" });
				requireHealthy(bin as IndexBackend, cwd);
			}
			throw new Error(`${bin} ${args[0]} failed (exit ${result.code})${hint ? `\n${hint}` : ""}\n${detail}${indexed ? "\nIndex may be unavailable. Use lsp_* or read/grep for now; missing or incomplete indexes require /code-intel-init or a confirmed repair. In strict mode, use /code-intel on to allow text searches." : ""}`);
		}
		if (bin === "vera" && cwd && args[0] === "search") {
			const key = `vera:${cwd}`;
			const firstVerification = !verified.has(key);
			verified.add(key);
			if (monitor(cwd).get("vera").state === "unchecked") {
				const lag = changedAt.has(key) ? elapsed(changedAt.get(key)!) : undefined;
				changedAt.delete(key);
				monitor(cwd).update("vera", { state: "ready", reason: "", lastSuccess: Date.now(), changeToReadyMs: lag });
				if (firstVerification) monitor(cwd).record({ backend: "vera", event: "probe", trigger: "query", outcome: "success", durationMs: elapsed(startedAt), changeToReadyMs: lag });
				publishHealth(cwd);
			}
		}
		const out = result.stdout.trim();
		const advisory = cwd ? indexAdvisories.get(`${bin}:${cwd}`) : undefined;
		return {
			content: [{ type: "text" as const, text: out || "(no results)" }, ...(advisory ? [{ type: "text" as const, text: `[${advisory}]` }] : [])],
			details: { command: `${bin} ${args.join(" ")}`, empty: out.length === 0 },
		};
	}

	/** codegraph and vera both need a per-project index; fail with the fix, not a stack trace. */
	function requireIndex(cwd: string, dir: string, tool: string): void {
		if (!existsSync(join(cwd, dir))) {
			const which = dir === ".vera" ? "vera" : "codegraph";
			monitor(cwd).update(which, { state: "missing", reason: "No index; /code-intel-init" });
			monitor(cwd).record({ backend: which, event: "blocked-query", trigger: "query", outcome: "failure" });
			publishHealth(cwd);
			throw new Error(
				`No ${dir}/ in ${cwd} — this project isn't indexed for ${tool}. Run \`code-intel init\` in the repo root, then retry. Until then, use grep/read.`,
			);
		}
	}

	// ------------------------------------------------------------ codegraph

	if (hasCodegraph) {
		pi.registerTool({
			name: "cg_context",
			label: "Graph Context",
			description:
				"Build task context from the structural code graph: entry points, related symbols, and relevant code blocks for a described task. Use this as the FIRST move on a new task in an indexed repo instead of grepping around for where to start.",
			promptSnippet: "Build starting context for a task from the code graph (entry points + related symbols)",
			promptGuidelines: [
				"Use cg_context as your opening move on any non-trivial task in a repo that has a .codegraph/ index, instead of guessing at file names with find or grep.",
			],
			parameters: Type.Object({
				task: Type.String({ description: "Natural-language description of the task or question" }),
				maxFiles: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum files to include source from" })),
				maxNodes: Type.Optional(Type.Number({ description: "Deprecated, ignored: explore limits files, not nodes. Use maxFiles." })),
			}),
			async execute(_id, params, signal, _onUpdate, ctx) {
				requireIndex(ctx.cwd, ".codegraph", "codegraph");
				await freshen("codegraph", ctx.cwd);
				const args = ["explore", params.task, "-p", ctx.cwd];
				if (params.maxFiles !== undefined) args.push("--max-files", String(params.maxFiles));
				const result = await run("codegraph", args, signal, undefined, ctx.cwd);
				if (params.maxNodes !== undefined) {
					result.content.push({ type: "text", text: "[maxNodes is deprecated and was ignored; use maxFiles to limit source files.]" });
				}
				return result;
			},
		});

		pi.registerTool({
			name: "cg_query",
			label: "Graph Search",
			description:
				"Search the code graph for symbols by name or fragment, optionally filtered by kind (function, class, method, interface...). Returns declaration sites with file and line. Faster and more precise than grepping for a definition.",
			promptSnippet: "Find symbol declarations in the code graph by name or kind",
			promptGuidelines: [
				"Use cg_query to locate where a symbol is declared, rather than grepping for 'function name' or 'class name' patterns.",
			],
			parameters: Type.Object({
				search: Type.String({ description: "Symbol name or fragment" }),
				kind: Type.Optional(Type.String({ description: "Filter by node kind, e.g. function, class, method" })),
				limit: Type.Optional(Type.Number({ description: "Max results (default 10)" })),
			}),
			async execute(_id, params, signal, _onUpdate, ctx) {
				requireIndex(ctx.cwd, ".codegraph", "codegraph");
				await freshen("codegraph", ctx.cwd);
				const args = ["query", params.search, "-p", ctx.cwd];
				if (params.kind) args.push("-k", params.kind);
				if (params.limit) args.push("-l", String(params.limit));
				return run("codegraph", args, signal, undefined, ctx.cwd);
			},
		});

		for (const [name, verb, label, what] of [
			["cg_callers", "callers", "Callers", "every function or method that calls a symbol"],
			["cg_callees", "callees", "Callees", "every function or method that a symbol itself calls"],
		] as const) {
			pi.registerTool({
				name,
				label,
				description: `Find ${what}, from real call edges in the structural graph — not text matches. Use instead of grepping for the symbol name, which also hits comments, strings, unrelated same-named methods, and misses dynamic dispatch the graph resolves.`,
				promptSnippet: `Find ${what} via the code graph`,
				promptGuidelines: [
					`Use ${name} to trace call relationships instead of grepping for a symbol name — grep results conflate declarations, comments, and unrelated same-named symbols.`,
				],
				parameters: Type.Object({
					symbol: Type.String({ description: "Symbol name to trace" }),
					limit: Type.Optional(Type.Number({ description: "Max results (default 20)" })),
				}),
				async execute(_id, params, signal, _onUpdate, ctx) {
					requireIndex(ctx.cwd, ".codegraph", "codegraph");
				await freshen("codegraph", ctx.cwd);
					const args = [verb, params.symbol, "-p", ctx.cwd];
					if (params.limit) args.push("-l", String(params.limit));
					return run("codegraph", args, signal, undefined, ctx.cwd);
				},
			});
		}

		pi.registerTool({
			name: "cg_impact",
			label: "Impact",
			description:
				"Analyze the blast radius of changing a symbol: everything transitively affected, to a given depth. Run this BEFORE renaming, changing a signature, or deleting anything — and before ast_rewrite.",
			promptSnippet: "Assess the blast radius of changing a symbol before editing it",
			promptGuidelines: [
				"Run cg_impact before any rename, signature change, or deletion in an indexed repo, and before running ast_rewrite, so the edit set is known up front rather than discovered through failing builds.",
			],
			parameters: Type.Object({
				symbol: Type.String({ description: "Symbol about to change" }),
				depth: Type.Optional(Type.Number({ description: "Traversal depth (default 2)" })),
			}),
			async execute(_id, params, signal, _onUpdate, ctx) {
				requireIndex(ctx.cwd, ".codegraph", "codegraph");
				await freshen("codegraph", ctx.cwd);
				const args = ["impact", params.symbol, "-p", ctx.cwd];
				if (params.depth) args.push("-d", String(params.depth));
				return run("codegraph", args, signal, undefined, ctx.cwd);
			},
		});
	}

	// ----------------------------------------------------------------- vera

	if (hasVera) {
		pi.registerTool({
			name: "vera_search",
			label: "Semantic Search",
			description:
				"Semantic code search over the vera index — finds code by MEANING, so it works when you don't know the symbol name. Ask in natural language ('validates JWT expiry', 'where retries are backed off'). This is the only tool here that finds code you can't name.",
			promptSnippet: "Find code by meaning (natural language) rather than by exact text",
			promptGuidelines: [
				"Use vera_search when you don't know the exact identifier — describe the behavior in natural language. Reach for grep only when you know the literal string you want.",
			],
			parameters: Type.Object({
				query: Type.String({ description: "Natural-language description of the behavior to find" }),
				scope: Type.Optional(StringEnum(["source", "docs", "runtime"] as const)),
				lang: Type.Optional(Type.String({ description: "Filter by language, e.g. rust, typescript" })),
				limit: Type.Optional(Type.Number({ description: "Max results (default 10)" })),
			}),
			async execute(_id, params, signal, _onUpdate, ctx) {
				requireIndex(ctx.cwd, ".vera", "vera");
				await freshen("vera", ctx.cwd);
				const args = ["search", params.query];
				if (params.scope) args.push("--scope", params.scope);
				if (params.lang) args.push("--lang", params.lang);
				if (params.limit) args.push("--limit", String(params.limit));
				return run("vera", args, signal, undefined, ctx.cwd);
			},
		});
	}

	// -------------------------------------------------------------- ast-grep

	if (hasAstGrep) {
		pi.registerTool({
			name: "ast_search",
			label: "AST Search",
			description:
				"Structural search by AST pattern, using ast-grep. Patterns are written as code with $META variables: `$A.then($B)`, `if ($C) { return $D }`, `func $NAME($$$ARGS) error`. Matches syntax, so it ignores formatting, line breaks, and comments that defeat regex. Needs no index — works in any repo.",
			promptSnippet: "Search code by AST pattern (formatting-insensitive structural match)",
			promptGuidelines: [
				"Use ast_search instead of grep when the thing you're matching is a code shape rather than a literal string — call patterns, signatures, control-flow shapes. It is immune to line breaks and formatting that break regexes.",
			],
			parameters: Type.Object({
				pattern: Type.String({ description: "ast-grep pattern, e.g. `$A.then($B)` or `func $N($$$A) error`" }),
				lang: Type.Optional(Type.String({ description: "Language, e.g. ts, tsx, rust, go, python" })),
				path: Type.Optional(Type.String({ description: "Path to search (default: cwd)" })),
			}),
			async execute(_id, params, signal, _onUpdate, ctx) {
				const args = ["run", "-p", params.pattern];
				if (params.lang) args.push("-l", params.lang);
				args.push(params.path?.replace(/^@/, "") ?? ctx.cwd);
				return run("ast-grep", args, signal);
			},
		});

		pi.registerTool({
			name: "ast_rewrite",
			label: "AST Rewrite",
			description:
				"Structural find-and-replace across a codebase via ast-grep, reusing $META variables in the rewrite: pattern `$A.then($B)` → rewrite `await $A`. Previews a diff by default; pass apply:true to write. Use for mechanical multi-file refactors instead of many hand-written edit calls or sed.",
			promptSnippet: "Apply a structural find-and-replace refactor across files (diff preview by default)",
			promptGuidelines: [
				"Use ast_rewrite for mechanical refactors that touch many files — it is safer than sed and far cheaper than a long series of edit calls. Preview first (apply defaults to false), and run cg_impact beforehand when the change touches a symbol's contract.",
			],
			parameters: Type.Object({
				pattern: Type.String({ description: "ast-grep pattern to match" }),
				rewrite: Type.String({ description: "Replacement, reusing $META vars from the pattern" }),
				lang: Type.Optional(Type.String({ description: "Language, e.g. ts, tsx, rust, go, python" })),
				path: Type.Optional(Type.String({ description: "Path to rewrite (default: cwd)" })),
				apply: Type.Optional(Type.Boolean({ description: "Write changes. Default false = diff preview only." })),
			}),
			async execute(_id, params, signal, _onUpdate, ctx) {
				const args = ["run", "-p", params.pattern, "-r", params.rewrite];
				if (params.lang) args.push("-l", params.lang);
				// -U applies without prompting; without it ast-grep would block on a TTY it doesn't have.
				args.push(params.apply ? "-U" : "--json=compact");
				args.push(params.path?.replace(/^@/, "") ?? ctx.cwd);
				const res = await run("ast-grep", args, signal);
				if (!params.apply) {
					res.content.push({
						type: "text" as const,
						text: "\n(preview only — no files changed. Re-run with apply:true to write.)",
					});
				}
				return res;
			},
		});
	}

	/** Share the same rebuild budget between background updates and queries. */
	function rebuildCostMs(cwd: string): number {
		const measured = syncCostMs.get(`graphify:${cwd}`);
		if (measured !== undefined) return measured;
		try {
			return (statSync(join(cwd, "graphify-out", "graph.json")).size / 1_000_000) * GRAPHIFY_MS_PER_MB;
		} catch {
			return Number.POSITIVE_INFINITY;
		}
	}

	// ------------------------------------------------------------- graphify

	/**
	 * graphify syncs adaptively, because unlike the others it has NO incremental
	 * path: every run re-extracts the whole corpus, so a no-op costs the same as
	 * a full rebuild and the price tracks repo size, not change size.
	 *
	 * Measured ~0.8 s/MB of graph.json, consistent across a 12x size range:
	 *   8.2MB graph  ->  2.2s   (cheap enough to hide behind a query)
	 *  55.1MB graph  -> 41.6s   (not remotely)
	 *
	 * So rebuildCostMs() decides per repo, and staleness is reported when we
	 * choose not to rebuild. graphify records `built_at_commit`, so that report
	 * is exact — commits behind HEAD — rather than the mtime guesswork the
	 * others need. `/code-intel-sync` always forces a refresh.
	 *
	 * The CLI rebuild covers more than graphify's own messaging suggests: it
	 * re-extracts markdown structure too (on these dotfiles, 7,032 -> 8,688 nodes
	 * and 1,352 -> 8,616 edges, community labels intact). What it does NOT do is
	 * the LLM pass — semantic extraction of papers/images, and naming new
	 * communities. That still needs `/graphify` in-agent with a model backend.
	 *
	 * (Note for future edits: a node's missing `_origin` field does NOT mean
	 * "LLM-extracted". It means an older extractor wrote it. Use `file_type`.)
	 */
	if (hasGraphify) {
		const graphPath = (cwd: string) => join(cwd, "graphify-out", "graph.json");

		function requireGraph(cwd: string): void {
			if (!existsSync(graphPath(cwd))) {
				throw new Error(
					`No graphify-out/graph.json in ${cwd}. Build it with \`/graphify .\` inside an agent session (full semantic graph), or \`graphify update .\` for a code-only AST graph.`,
				);
			}
		}

		/** Exact staleness via the commit the graph was built at. */
		async function staleness(cwd: string): Promise<string> {
			try {
				const raw = readFileSync(graphPath(cwd), "utf8");
				const m = /"built_at_commit"\s*:\s*"([0-9a-f]{7,40})"/.exec(raw);
				if (!m) return "";
				const r = await pi.exec("git", ["-C", cwd, "rev-list", `${m[1]}..HEAD`, "--count"], { timeout: 5000 });
				const behind = Number.parseInt(r.stdout.trim(), 10);
				if (!Number.isFinite(behind) || behind === 0) return "";
				return `\n\n[graph is ${behind} commit(s) behind HEAD. Structure and architecture rarely move that fast, so this is usually fine — but for anything added in those commits, prefer cg_* or lsp_*. Run /code-intel-sync to rebuild.]`;
			} catch (err) {
				// Staleness is advisory, so a failure here must not fail the query — but
				// it must not be invisible either. A missing import once made this
				// silently return "" on every call, so the note never appeared and the
				// tool looked like it was working.
				return `\n\n[staleness check failed: ${err instanceof Error ? err.message : String(err)}]`;
			}
		}

		async function graphRun(cwd: string, args: string[], signal?: AbortSignal) {
			requireGraph(cwd);
			const running = inFlight.get(`graphify:${cwd}`);
			try {
				if (running) await waitForWriter("graphify", cwd, running, "query");
				requireHealthy("graphify", cwd);
				if (rebuildCostMs(cwd) <= GRAPHIFY_AUTOSYNC_BUDGET_MS) await sync("graphify", cwd, lastSync.has(`graphify:${cwd}`) ? "query" : "first-query");
			} catch (err) {
				failed("graphify", cwd, err);
				monitor(cwd).record({ backend: "graphify", event: "blocked-query", trigger: "query", outcome: "failure" });
				throw err;
			}
			const res = await run("graphify", args, signal, undefined, cwd);
			const note = await staleness(cwd);
			if (note) res.content.push({ type: "text" as const, text: note });
			return res;
		}

		pi.registerTool({
			name: "gf_query",
			label: "Graph Query",
			description:
				"Ask a question against the graphify knowledge graph, which spans code AND docs, ADRs, schemas, and design rationale. Use for architecture and 'why' questions that code alone can't answer — the other tools here only see code.",
			promptSnippet: "Ask an architecture/'why' question across code, docs, and design rationale",
			promptGuidelines: [
				"Use gf_query for architecture, design-intent, and cross-cutting 'why' questions — it is the only tool here that indexes prose and docs alongside code.",
			],
			parameters: Type.Object({
				question: Type.String({ description: "Natural-language question about the project" }),
				budget: Type.Optional(Type.Number({ description: "Max output tokens (default 2000)" })),
			}),
			async execute(_id, params, signal, _onUpdate, ctx) {
				const args = ["query", params.question, "--graph", graphPath(ctx.cwd)];
				if (params.budget) args.push("--budget", String(params.budget));
				return graphRun(ctx.cwd, args, signal);
			},
		});

		pi.registerTool({
			name: "gf_explain",
			label: "Graph Explain",
			description:
				"Plain-language explanation of one node in the knowledge graph and its neighbours — what it is, what it connects to, and which part of the system it belongs to.",
			promptSnippet: "Explain a component and its neighbours from the knowledge graph",
			parameters: Type.Object({
				node: Type.String({ description: "Node label, e.g. a component, file, or concept name" }),
			}),
			async execute(_id, params, signal, _onUpdate, ctx) {
				return graphRun(ctx.cwd, ["explain", params.node, "--graph", graphPath(ctx.cwd)], signal);
			},
		});

		pi.registerTool({
			name: "gf_affected",
			label: "Graph Affected",
			description:
				"Reverse-traverse the knowledge graph to find what depends on a node. Complements cg_impact: that one follows call edges in code, this one also reaches docs, configs, and schemas that reference the thing.",
			promptSnippet: "Find what depends on a component, including docs and config",
			parameters: Type.Object({
				node: Type.String({ description: "Node label to trace backwards from" }),
				depth: Type.Optional(Type.Number({ description: "Reverse traversal depth (default 2)" })),
			}),
			async execute(_id, params, signal, _onUpdate, ctx) {
				const args = ["affected", params.node, "--graph", graphPath(ctx.cwd)];
				if (params.depth) args.push("--depth", String(params.depth));
				return graphRun(ctx.cwd, args, signal);
			},
		});

		pi.registerTool({
			name: "gf_overview",
			label: "Graph Overview",
			description:
				"List the most connected nodes in the knowledge graph — the architectural hubs. A fast way to orient in an unfamiliar project before reading any code.",
			promptSnippet: "List the architectural hubs of the project",
			promptGuidelines: [
				"Use gf_overview to orient in an unfamiliar repo before reading files, when a graphify-out/ graph exists.",
			],
			parameters: Type.Object({
				top: Type.Optional(Type.Number({ description: "How many hubs to show (default 10)" })),
			}),
			async execute(_id, params, signal, _onUpdate, ctx) {
				const args = ["god-nodes", "--graph", graphPath(ctx.cwd), "--json"];
				if (params.top) args.push("--top", String(params.top));
				const res = await graphRun(ctx.cwd, args, signal);

				// The plain-text output is label-only, which is useless on a docs-heavy
				// repo: the top hubs come back as three identical "Builtin Functions"
				// (three Zig reference versions) or 209 copies of "Problem". Resolve each
				// id to its source file so same-named nodes are distinguishable.
				try {
					const hubs = JSON.parse(res.content[0].text) as { id: string; label: string; degree: number }[];
					const graph = JSON.parse(readFileSync(graphPath(ctx.cwd), "utf8")) as {
						nodes: { id: string; source_file?: string }[];
					};
					const src = new Map(graph.nodes.map((n) => [n.id, n.source_file ?? ""]));
					res.content[0] = {
						type: "text" as const,
						text: [
							"Most connected nodes (architectural hubs):",
							...hubs.map((h, i) => {
								const f = src.get(h.id);
								return `${String(i + 1).padStart(2)}. ${h.label} — ${h.degree} edges${f ? `  [${f}]` : ""}`;
							}),
						].join("\n"),
					};
				} catch {
					// Enrichment is a nicety; the raw JSON is still a usable answer.
				}
				return res;
			},
		});
	}

	// ----------------------------------------------------------------- mode

	function applyStrict(): void {
		if (toolsBeforeStrict === undefined) toolsBeforeStrict = pi.getActiveTools();
		pi.setActiveTools(toolsBeforeStrict.filter((t) => !TEXT_TOOLS.includes(t)));
	}


	function releaseStrict(): void {
		if (toolsBeforeStrict === undefined) return;
		pi.setActiveTools(toolsBeforeStrict);
		toolsBeforeStrict = undefined;
	}

	function updateStatus(ctx: ExtensionContext): void {
		if (mode === "off") {
			ctx.ui.setStatus("code-intel", undefined);
			return;
		}
		const color = mode === "strict" ? "warning" : "accent";
		const label = mode === "strict" ? "◆ structural (strict)" : "◆ structural";
		ctx.ui.setStatus("code-intel", ctx.ui.theme.fg(color, label));
	}

	function setMode(next: Mode, ctx: ExtensionContext, quiet = false): void {
		mode = next;
		nudged.clear();
		if (next === "strict") applyStrict();
		else releaseStrict();
		updateStatus(ctx);
		pi.events.emit("code-intel:mode", mode);
		if (!quiet) {
			const msg =
				next === "off"
					? "code-intel: off — grep/find unrestricted."
					: next === "on"
						? "code-intel: on — grep/find redirected to structural tools once per pattern."
						: "code-intel: strict — grep/find removed from the tool set.";
			ctx.ui.notify(msg, next === "strict" ? "warning" : "info");
		}
		pi.appendEntry("code-intel", { mode, toolsBeforeStrict });
	}

	function cycle(ctx: ExtensionContext): void {
		setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length], ctx);
	}

	pi.registerCommand("code-intel", {
		description: "Structural navigation: off | on | strict | status | history (no arg cycles)",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "history") { ctx.ui.notify(monitor(ctx.cwd).historySummary(), "info"); return; }
			if (arg === "status" || arg === "?") {
				await refreshHealth(ctx);
				const available = OWNED_TOOLS.filter((t) => pi.getActiveTools().includes(t));
				const { present, missing } = indexReport(ctx.cwd);
				ctx.ui.notify(
					[
						`mode: ${mode}`,
						`index markers (not readiness): ${present.length ? present.join(", ") : "none — run `code-intel init`"}`,
						monitor(ctx.cwd).details(),
						missing.length ? `not indexed: ${missing.join(", ")} (\`code-intel init\` builds all three)` : "",
						`tools: ${available.length ? available.join(", ") : "none registered"}`,
						...["vera", "codegraph", "graphify"].filter((which) => repairNeeded.has(`${which}:${ctx.cwd}`)).map((which) => `repair needed: ${which} — /code-intel-repair ${which}`),
					]
						.filter(Boolean)
						.join("\n"),
					"info",
				);
				return;
			}
			if (!arg) return cycle(ctx);
			if (!MODES.includes(arg as Mode)) {
				ctx.ui.notify(`Unknown mode '${arg}'. Use: off | on | strict | status | history`, "error");
				return;
			}
			setMode(arg as Mode, ctx);
		},
	});

	pi.registerShortcut(Key.ctrlAlt("i"), {
		description: "Cycle code-intel mode (off → on → strict)",
		handler: async (ctx) => cycle(ctx),
	});

	pi.registerCommand("code-intel-init", {
		description: "Build the missing code-intelligence indexes for this project (slow, asks first)",
		handler: async (_args, ctx) => {
			if (!hasHelper) {
				ctx.ui.notify("`code-intel` helper not on PATH (it lives in the dotfiles bin/ topic).", "error");
				return;
			}
			const { present, missing } = indexReport(ctx.cwd);
			if (missing.length === 0) {
				ctx.ui.notify(`Index directories already exist: ${present.join(", ")}. Use /code-intel-sync for updates, or /code-intel-repair <backend> for an incompatible index.`, "info");
				return;
			}

			if (!ctx.hasUI) {
				ctx.ui.notify("Initial indexing needs confirmation. Run `code-intel init` explicitly in the repository.", "warning");
				return;
			}
			// A first index is nothing like the incremental syncs. A cold vera build
			// on a few thousand files is minutes of saturated CPU and hundreds of MB
			// on disk, so this is always a deliberate, confirmed act — never something
			// that fires on its own at session start.
			const ok = await ctx.ui.confirm(
				`Build ${missing.join(", ")} for this project?`,
				[
					`Directory: ${ctx.cwd}`,
					"",
					"This is a cold build, not an incremental sync: expect minutes of high",
					"CPU and a few hundred MB on disk for a large repo. It runs to completion",
					"once started — interrupting a vera index is far more expensive than",
					"letting it finish.",
				].join("\n"),
			);
			if (!ok) return;

			ctx.ui.setStatus("code-intel-init", ctx.ui.theme.fg("warning", "◆ indexing"));
			try {
				// Track the helper under every backend key so reads and shutdown wait.
				const backends = [...present, ...missing] as IndexBackend[];
				const keys = backends.map((which) => `${which}:${ctx.cwd}`);
				await Promise.allSettled(backends.map((which) => {
					const running = inFlight.get(`${which}:${ctx.cwd}`);
					return running ? waitForWriter(which, ctx.cwd, running, "init") : undefined;
				}));
				const job = Promise.resolve().then(async () => {
					const startedAt = Date.now();
					const before = await snapshot(ctx.cwd);
					for (const which of backends) updating(which, ctx.cwd);
					let result;
					try { result = await pi.exec("code-intel", ["init"], { cwd: ctx.cwd }); }
					catch (err) {
						for (const which of backends) {
							failed(which, ctx.cwd, err);
							monitor(ctx.cwd).record({ backend: which, event: "init", trigger: "init", outcome: "failure", durationMs: elapsed(startedAt) });
						}
						throw err;
					}
					for (const which of backends) {
						helperLog(which, ctx.cwd, result.stdout);
						// The helper reports each child exit, so a partial failure must
						// not label its successful siblings as failed or repaired.
						const childExit = result.stdout.match(new RegExp(`^[ \\t]*${which}: exit (\\d+) \\(log:`, "m"))?.[1];
						const ok = result.code === 0 || childExit === "0";
						let lag: number | undefined;
						if (ok) {
							repairNeeded.delete(`${which}:${ctx.cwd}`);
							lastSync.delete(`${which}:${ctx.cwd}`);
							verified.add(`${which}:${ctx.cwd}`); // Helper verified an actual search/graph read.
							lag = await succeeded(which, ctx.cwd, before);
						} else failed(which, ctx.cwd, result.stderr || result.stdout);
						monitor(ctx.cwd).record({ backend: which, event: "init", trigger: "init", outcome: ok ? "success" : "failure", durationMs: elapsed(startedAt), changeToReadyMs: lag });
					}
					if (result.code !== 0) throw new Error([result.stdout, result.stderr].filter(Boolean).join("\n"));
				});
				for (const key of keys) inFlight.set(key, job);
				try { await job; } finally {
					for (const key of keys) if (inFlight.get(key) === job) inFlight.delete(key);
				}
				const after = indexReport(ctx.cwd);
				ctx.ui.notify(`code-intel init done. Indexed: ${after.present.join(", ") || "none"}${after.missing.length ? ` (still missing: ${after.missing.join(", ")})` : ""}`, after.missing.length ? "warning" : "info");
			} catch (err) {
				ctx.ui.notify(`Initial indexing failed: ${err instanceof Error ? err.message : String(err)}`, "error");
			} finally {
				ctx.ui.setStatus("code-intel-init", undefined);
			}
		},
	});

	pi.registerCommand("code-intel-repair", {
		description: "Rebuild one backend: vera | codegraph | graphify (asks first; keeps a log)",
		handler: async (args, ctx) => {
			const which = args.trim().toLowerCase() as IndexBackend;
			if (!["vera", "codegraph", "graphify"].includes(which)) {
				ctx.ui.notify("Use /code-intel-repair vera | codegraph | graphify", "error");
				return;
			}
			if (!hasHelper) {
				ctx.ui.notify("`code-intel` helper is not on PATH.", "error");
				return;
			}
			if (!ctx.hasUI) {
				ctx.ui.notify(`Repair needs confirmation. Run \`code-intel repair ${which}\` explicitly in ${ctx.cwd}.`, "warning");
				return;
			}
			if (!(await ctx.ui.confirm(`Rebuild ${which} for this project?`, `Directory: ${ctx.cwd}\nThis can take minutes. The helper coordinates its watcher, retains a private log, and runs to completion without a timeout. Graphify does not force a smaller graph or discard its semantic layer.`))) return;
			const key = `${which}:${ctx.cwd}`;
			ctx.ui.setStatus("code-intel-repair", ctx.ui.theme.fg("warning", `◆ rebuilding ${which}`));
			try {
				const running = inFlight.get(key);
				if (running) await waitForWriter(which, ctx.cwd, running, "repair").catch(() => {});
				// Register before starting work. Queries and shutdown share this promise.
				const job = Promise.resolve().then(async () => {
					const startedAt = Date.now();
					const before = await snapshot(ctx.cwd);
					updating(which, ctx.cwd);
					try {
						const result = await pi.exec("code-intel", ["repair", which], { cwd: ctx.cwd });
						helperLog(which, ctx.cwd, result.stdout);
						if (result.code !== 0) throw new Error([result.stdout, result.stderr].filter(Boolean).join("\n") || `repair exited ${result.code}`);
						repairNeeded.delete(key);
						if (which !== "graphify") await probeReady(which, ctx.cwd);
						lastSync.set(key, Date.now());
						lastRevision.set(key, before?.head ?? await revision(ctx.cwd));
						verified.add(key); // Helper verified an actual search/graph read.
						const lag = await succeeded(which, ctx.cwd, before);
						monitor(ctx.cwd).record({ backend: which, event: "repair", trigger: "repair", outcome: "success", durationMs: elapsed(startedAt), changeToReadyMs: lag });
						ctx.ui.notify(`Repaired: ${which}\n${result.stdout.trim()}`, "info");
					} catch (err) {
						recordRepair(which, ctx.cwd, err instanceof Error ? err.message : String(err));
						failed(which, ctx.cwd, err);
						monitor(ctx.cwd).record({ backend: which, event: "repair", trigger: "repair", outcome: "failure", durationMs: elapsed(startedAt) });
						throw err;
					}
				});
				inFlight.set(key, job);
				try { await job; } finally { if (inFlight.get(key) === job) inFlight.delete(key); }
			} catch (err) {
				ctx.ui.notify(`Repair failed: ${err instanceof Error ? err.message : String(err)}`, "error");
			} finally {
				ctx.ui.setStatus("code-intel-repair", undefined);
			}
		},
	});

	pi.registerCommand("code-intel-sync", {
		description: "Force an index sync now (codegraph + vera)",
		handler: async (_args, ctx) => {
			const idx = indexedWith(ctx);
			if (idx.length === 0) {
				ctx.ui.notify("No indexes here — run `code-intel init` first.", "info");
				return;
			}
			ctx.ui.setStatus("code-intel-sync", ctx.ui.theme.fg("muted", "↻ syncing"));
			const synced: string[] = [];
			const failures: string[] = [];
			try {
				for (const which of idx as ("codegraph" | "vera" | "graphify")[]) {
					lastSync.delete(`${which}:${ctx.cwd}`);
					repairNeeded.delete(`${which}:${ctx.cwd}`);
					try {
						await sync(which, ctx.cwd, "manual-sync");
						synced.push(which);
					} catch (err) {
						failures.push(err instanceof Error ? err.message : String(err));
					}
				}
			} finally {
				ctx.ui.setStatus("code-intel-sync", undefined);
			}
			ctx.ui.notify([synced.length ? `Synced: ${synced.join(", ")}` : "", ...failures].filter(Boolean).join("\n"), failures.length ? "warning" : "info");
		},
	});

	// Edits made through Pi can be noticed immediately; external edits and Git
	// switches are caught by the read-only poll. Queue writers outside the hooks.
	pi.on("tool_result", async (event, ctx) => {
		if (event.isError || !(["write", "edit"].includes(event.toolName) || (event.toolName === "ast_rewrite" && (event.input as { apply?: boolean }).apply))) return;
		const frame = await snapshot(ctx.cwd);
		if (!frame) return;
		const previous = observedFingerprint.get(ctx.cwd);
		observedFingerprint.set(ctx.cwd, frame.fingerprint);
		for (const which of indexedWith(ctx) as IndexBackend[]) {
			const key = `${which}:${ctx.cwd}`;
			const baseline = syncedFingerprint.get(key) ?? previous;
			if (baseline ? baseline === frame.fingerprint : !frame.dirty) continue;
			if (!changedAt.has(key)) changedAt.set(key, Date.now());
			if (monitor(ctx.cwd).get(which).state === "ready") monitor(ctx.cwd).update(which, { state: "stale", reason: "Workspace edited; awaiting a verified sync" });
			scheduleBackground(which, ctx.cwd, frame, "files-changed");
		}
		publishHealth(ctx.cwd);
	});

	// Never abandon an in-flight index write. Killing `vera update` partway is
	// the one genuinely expensive mistake available here (measured: a single
	// interrupted run cost 19.5 minutes to reconcile), so shutdown waits it out.
	pi.on("session_shutdown", async () => {
		stopHealth();
		await Promise.allSettled([...backgroundJobs, ...inFlight.values()]);
	});

	// Auto-enable where it pays off: a repo that's already indexed. Explicit
	// --code-intel always wins over detection.
	/** Last mode this session recorded, if it recorded one. */
	function persistedMode(ctx: ExtensionContext): Mode | undefined {
		try {
			const entries = ctx.sessionManager.getEntries() as {
				type?: string;
				customType?: string;
				data?: { mode?: string };
			}[];
			for (let i = entries.length - 1; i >= 0; i--) {
				const e = entries[i];
				if (e.type === "custom" && e.customType === "code-intel" && e.data?.mode) {
					const m = e.data.mode;
					if (MODES.includes(m as Mode)) return m as Mode;
				}
			}
		} catch {
			// Unavailable session history falls back to off.
			return undefined;
		}
		return undefined;
	}

	pi.on("session_start", async (event, ctx) => {
		await startHealth(ctx);
		const flag = String(pi.getFlag("code-intel") ?? "").toLowerCase();
		if (MODES.includes(flag as Mode)) {
			setMode(flag as Mode, ctx, true);
			return;
		}

		// Resuming must not silently drop the mode. A long strict-mode refactor
		// that gets resumed would otherwise quietly stop being strict, and any
		// comparison you were running would be contaminated with no visible sign.
		if (event.reason !== "startup") {
			const prior = persistedMode(ctx);
			if (prior !== undefined) {
				setMode(prior, ctx, true);
				if (prior !== "off") {
					ctx.ui.notify(`code-intel: ${prior} — restored from the resumed session.`, "info");
				}
				return;
			}
		}

		// Existing indexes do not opt a session into structural routing.
		setMode("off", ctx, true);
	});

	/**
	 * Suggest only tools that will actually work right here. Recommending
	 * cg_query in a repo with no .codegraph/ sends the model down a dead end and
	 * teaches it the whole mode is noise — observed doing exactly that.
	 */
	function alternativesFor(cwd: string): string[] {
		const out: string[] = [];
		const idx = indexedWith({ cwd });
		if (idx.includes("codegraph")) {
			out.push("cg_query to find a declaration, cg_callers/cg_callees to trace calls, cg_impact for blast radius");
		}
		if (idx.includes("vera")) {
			out.push("vera_search to find code by meaning when you don't know the identifier");
		}
		if (idx.includes("graphify")) {
			out.push("gf_query for architecture and 'why' questions spanning code and docs");
		}
		// These need no index, so they are always honest suggestions.
		out.push("lsp_references / lsp_definition for exact, type-aware symbol resolution (no index needed)");
		if (hasAstGrep) out.push("ast_search to match a code shape rather than a literal string (no index needed)");
		return out;
	}

	function nudgeFor(kind: string, key: string, cwd: string): { block: true; reason: string } | undefined {
		if (nudged.has(key)) return undefined;
		nudged.add(key);
		return {
			block: true,
			reason: [
				`code-intel mode: this ${kind} was intercepted once. Consider a structural tool first:`,
				...alternativesFor(cwd).map((a) => `  - ${a}`),
				"",
				`If ${kind} really is right here (literal string, config file, comment, non-code text), issue the exact same call again — it will not be intercepted a second time.`,
			].join("\n"),
		};
	}

	// Route direct model searches, not nested calls from codemode/tool scripts.
	// Interrupting a nested call aborts the script and can discard useful work.
	pi.on("tool_call", async (event, ctx) => {
		if (event.parentToolCallId) return;
		if (mode === "off") return;

		// Strict mode removes grep/find from the tool set, but bash can still run
		// `grep -rn`. Close that hole outright, or "strict" measures nothing.
		if (mode === "strict" && event.toolName === "bash") {
			const command = String((event.input as { command?: string }).command ?? "");
			if (/(^|[|;&]|\$\()\s*(sudo\s+)?(grep|egrep|fgrep|rg|ag|ack)\b/.test(command)) {
				return {
					block: true,
					reason: [
						"code-intel strict mode: text search is disabled, including via bash. Use a structural tool:",
						...alternativesFor(ctx.cwd).map((a) => `  - ${a}`),
						"",
						"Run /code-intel on to leave strict mode if text search is genuinely required.",
					].join("\n"),
				};
			}
		}
		if (mode !== "on") return;

		if (TEXT_TOOLS.includes(event.toolName)) {
			return nudgeFor(event.toolName, `${event.toolName}:${JSON.stringify(event.input)}`, ctx.cwd);
		}

		// ...and the back door. Blocking the grep tool while leaving bash open just
		// teaches the model to run `grep -rn` in a shell instead, which is strictly
		// worse: same text search, but now invisible to this mode. Observed on the
		// very first run.
		if (event.toolName === "bash") {
			const command = String((event.input as { command?: string }).command ?? "");
			// Match only when a search binary is the command being run — at the start,
			// or after a pipe/separator — so `foo --grep` or `ripgrep_notes.md` don't trip it.
			// Backtick command substitution is deliberately NOT matched: it fires on any
			// command whose text merely quotes `grep` (a commit message, a heredoc, a doc
			// edit), which in this repo is constant. $(...) still covers real substitution.
			if (/(^|[|;&]|\$\()\s*(sudo\s+)?(grep|egrep|fgrep|rg|ag|ack)\b/.test(command)) {
				return nudgeFor("shell text search", `bash:${command}`, ctx.cwd);
			}
		}
	});
}
