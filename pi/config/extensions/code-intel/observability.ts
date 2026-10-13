import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, closeSync, constants, fchmodSync, fstatSync, mkdirSync, openSync, readSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type IndexBackend = "codegraph" | "vera" | "graphify";
export type Health = "unchecked" | "ready" | "updating" | "stale" | "repair" | "missing" | "unavailable";
export type Trigger = "first-query" | "query" | "files-changed" | "head-changed" | "manual-sync" | "repair" | "init" | "health-check";
export interface Snapshot {
	state: Health;
	reason?: string;
	lastSuccess?: number;
	lastFailure?: number;
	failureReason?: string;
	logPath?: string;
	changeToReadyMs?: number;
}
type EventName = "update" | "repair" | "init" | "lock-wait" | "writer-wait" | "debounce" | "blocked-query" | "probe";
interface MaintenanceEvent {
	backend: IndexBackend;
	event: EventName;
	trigger: Trigger;
	outcome: "success" | "failure" | "skipped";
	durationMs?: number;
	waitMs?: number;
	noChange?: boolean;
	changeToReadyMs?: number;
}
interface JournalEvent extends MaintenanceEvent { timestamp: number; session: string; pid: number }
const BACKENDS: IndexBackend[] = ["codegraph", "vera", "graphify"];
const HEALTH: Health[] = ["unchecked", "ready", "updating", "stale", "repair", "missing", "unavailable"];
const TRIGGERS: Trigger[] = ["first-query", "query", "files-changed", "head-changed", "manual-sync", "repair", "init", "health-check"];
const EVENTS: EventName[] = ["update", "repair", "init", "lock-wait", "writer-wait", "debounce", "blocked-query", "probe"];
const TIMINGS = ["durationMs", "waitMs", "changeToReadyMs"] as const;
const LABELS = { codegraph: "CG", vera: "V", graphify: "GF" };
const MARKS: Record<Health, string> = { unchecked: "?", ready: "✓", updating: "↻", stale: "~", repair: "!", missing: "∅", unavailable: "×" };
const WEEK = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_RECORDS = 2000;
const nonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Validate both live events and untrusted journal lines without copying caller keys. */
function eventMetadata(value: unknown): MaintenanceEvent | undefined {
	if (!value || typeof value !== "object") return;
	const v = value as MaintenanceEvent;
	if (!BACKENDS.includes(v.backend) || !EVENTS.includes(v.event) || !TRIGGERS.includes(v.trigger) || !["success", "failure", "skipped"].includes(v.outcome)) return;
	const event: MaintenanceEvent = { backend: v.backend, event: v.event, trigger: v.trigger, outcome: v.outcome };
	for (const key of TIMINGS) {
		if (v[key] !== undefined && !nonnegative(v[key])) return;
		if (v[key] !== undefined) event[key] = v[key];
	}
	if (v.noChange !== undefined && typeof v.noChange !== "boolean") return;
	if (v.noChange !== undefined) event.noChange = v.noChange;
	return event;
}

export class IndexObservability {
	readonly historyPath: string;
	private readonly states = new Map<IndexBackend, Snapshot>();
	private readonly now: () => number;
	private readonly session: string;
	private historyUnavailable = false;

	constructor(cwd: string, options: { stateHome?: string; now?: () => number; sessionId?: string } = {}) {
		let physical: string;
		try { physical = realpathSync(cwd); } catch { physical = resolve(cwd); }
		const hash = createHash("sha256").update(physical).digest("hex");
		this.historyPath = join(options.stateHome ?? process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "code-intel", "maintenance", hash, "events.jsonl");
		this.now = options.now ?? Date.now;
		this.session = options.sessionId ?? randomUUID();
	}

	update(backend: IndexBackend, patch: Partial<Snapshot>): void {
		if (!BACKENDS.includes(backend) || !patch || typeof patch !== "object") return;
		const next = this.get(backend);
		if (patch.state !== undefined && HEALTH.includes(patch.state)) next.state = patch.state;
		for (const key of ["reason", "failureReason", "logPath"] as const) if (typeof patch[key] === "string") next[key] = patch[key];
		for (const key of ["lastSuccess", "lastFailure", "changeToReadyMs"] as const) if (nonnegative(patch[key])) next[key] = patch[key];
		this.states.set(backend, next);
	}

	get(backend: IndexBackend): Snapshot { return { ...(this.states.get(backend) ?? { state: "unchecked" }) }; }

	record(value: MaintenanceEvent): void {
		const metadata = eventMetadata(value);
		if (!metadata) return;
		let fd: number | undefined;
		try {
			const timestamp = this.now();
			if (!nonnegative(timestamp)) return;
			const directory = dirname(this.historyPath);
			mkdirSync(directory, { recursive: true, mode: 0o700 });
			chmodSync(directory, 0o700);
			fd = openSync(this.historyPath, constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
			// Enforce private permissions even when an earlier writer created the file.
			fchmodSync(fd, 0o600);
			appendFileSync(fd, JSON.stringify({ timestamp, session: this.session, pid: process.pid, ...metadata }) + "\n");
			this.historyUnavailable = false;
		} catch { this.historyUnavailable = true; }
		finally { if (fd !== undefined) { try { closeSync(fd); } catch { this.historyUnavailable = true; } } }
	}

	footer(): string { return `idx ${BACKENDS.map(b => LABELS[b] + MARKS[this.get(b).state]).join(" ")}`; }

	details(): string {
		const now = this.now();
		const lines = BACKENDS.map(b => {
			const s = this.get(b);
			const age = s.lastSuccess === undefined ? "never" : `${Math.max(0, Math.floor((now - s.lastSuccess) / 1000))}s ago`;
			return `${LABELS[b]}: ${s.state}; last success: ${age}${s.reason ? `; reason: ${s.reason}` : ""}${s.lastFailure === undefined ? "" : `; last failure: ${Math.max(0, Math.floor((now - s.lastFailure) / 1000))}s ago (${s.failureReason ?? "unknown"})`}${s.logPath ? `; log: ${s.logPath}` : ""}${s.changeToReadyMs === undefined ? "" : `; change-to-ready: ${s.changeToReadyMs}ms`}`;
		});
		lines.push(`History: ${this.historyUnavailable ? "unavailable; " : ""}${this.historyPath}`);
		lines.push("Legend: ? unchecked, ✓ ready, ↻ updating, ~ stale, ! repair, ∅ missing, × unavailable");
		return lines.join("\n");
	}

	/** Reads only a bounded tail; a partial first line is discarded. */
	historySummary(): string {
		let fd: number | undefined;
		let content: string;
		let clipped = false;
		try {
			fd = openSync(this.historyPath, constants.O_RDONLY | constants.O_NOFOLLOW);
			const size = fstatSync(fd).size;
			const start = Math.max(0, size - MAX_BYTES);
			const buffer = Buffer.alloc(Math.min(size, MAX_BYTES));
			const bytes = readSync(fd, buffer, 0, buffer.length, start);
			content = buffer.subarray(0, bytes).toString("utf8");
			clipped = start > 0;
			if (clipped) content = content.slice(content.indexOf("\n") + 1);
		} catch (error) {
			const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
			if (!missing) this.historyUnavailable = true;
			return this.historyUnavailable ? "History unavailable" : "History: no records yet";
		} finally { if (fd !== undefined) { try { closeSync(fd); } catch { this.historyUnavailable = true; } } }
		const lines = content.split("\n").filter(Boolean);
		if (lines.length > MAX_RECORDS) clipped = true;
		const now = this.now();
		const records: JournalEvent[] = [];
		for (const line of lines.slice(-MAX_RECORDS)) {
			try {
				const raw = JSON.parse(line);
				const metadata = eventMetadata(raw);
				if (!metadata || !nonnegative(raw.timestamp) || typeof raw.session !== "string" || !Number.isSafeInteger(raw.pid) || raw.pid <= 0) continue;
				if (raw.timestamp >= now - WEEK && raw.timestamp <= now) records.push({ ...metadata, timestamp: raw.timestamp, session: raw.session, pid: raw.pid });
			} catch { /* Ignore malformed lines, including interrupted appends. */ }
		}
		const summary = BACKENDS.map(b => {
			const events = records.filter(r => r.backend === b);
			const counts = EVENTS.map(name => `${name}=${events.filter(r => r.event === name).length}`).join(" ");
			const writers = events.filter(r => ["update", "repair", "init"].includes(r.event) && r.durationMs !== undefined);
			let overlaps = 0;
			for (let i = 0; i < writers.length; i++) for (let j = i + 1; j < writers.length; j++) {
				const a = writers[i], c = writers[j];
				if ((a.session !== c.session || a.pid !== c.pid) && Math.max(a.timestamp - (a.durationMs ?? 0), c.timestamp - (c.durationMs ?? 0)) < Math.min(a.timestamp, c.timestamp)) overlaps++;
			}
			const total = (key: typeof TIMINGS[number]) => events.reduce((sum, r) => sum + (r[key] ?? 0), 0);
			return `${LABELS[b]}: ${counts}; success=${events.filter(r => r.outcome === "success").length} failure=${events.filter(r => r.outcome === "failure").length} skipped=${events.filter(r => r.outcome === "skipped").length}; no-change updates=${events.filter(r => r.event === "update" && r.noChange === true).length}; duration=${total("durationMs")}ms wait=${total("waitMs")}ms change-to-ready=${total("changeToReadyMs")}ms overlaps=${overlaps}`;
		});
		return [`History: last 7 days${clipped ? " (clipped: 2MB/2000-line tail)" : ""}${this.historyUnavailable ? "; logging unavailable" : ""}`, ...summary].join("\n");
	}
}
