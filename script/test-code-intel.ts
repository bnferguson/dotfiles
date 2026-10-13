// Run with: bun test ./script/test-code-intel.ts
import { afterAll, expect, mock, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Host imports are supplied by Pi at runtime; this harness needs only schemas
// and registration, not a running Pi session or external indexes.
mock.module("@earendil-works/pi-ai", () => ({ StringEnum: () => ({}) }));
mock.module("@earendil-works/pi-tui", () => ({ Key: { ctrlAlt: (key: string) => key } }));
mock.module("typebox", () => ({
	Type: Object.fromEntries(["Object", "String", "Number", "Integer", "Optional", "Boolean"].map((name) => [name, (value: unknown) => value])),
}));

const { default: codeIntelExtension } = await import("../pi/config/extensions/code-intel/index.ts");
const root = mkdtempSync(join(tmpdir(), "code-intel-test-"));
const cwd = join(root, "project with spaces");
mkdirSync(join(cwd, ".codegraph"), { recursive: true });
mkdirSync(join(cwd, ".vera"), { recursive: true });
for (const bin of ["codegraph", "vera", "graphify", "code-intel"]) writeFileSync(join(root, bin), ""); // PATH probes only.
afterAll(() => rmSync(root, { recursive: true, force: true }));

type Call = { bin: string; args: string[]; options: Record<string, unknown> };
type ExecResult = { code: number; stdout: string; stderr: string };
function harness(syncFails = false, override?: (call: Call) => Promise<ExecResult | undefined>) {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const events = new Map<string, any>();
	const calls: Call[] = [];
	const oldPath = process.env.PATH;
	const oldStateHome = process.env.XDG_STATE_HOME;
	const stateHome = mkdtempSync(join(root, "state-"));
	process.env.PATH = root;
	process.env.XDG_STATE_HOME = stateHome;
	try {
		codeIntelExtension({
			registerTool: (tool: any) => tools.set(tool.name, tool),
			registerFlag() {}, registerCommand: (name: string, command: any) => commands.set(name, command), registerShortcut() {}, on: (name: string, handler: any) => events.set(name, handler),
			getActiveTools: () => [...tools.keys()], getFlag: () => "off", appendEntry() {}, events: { emit() {} },
			exec: async (bin: string, args: string[], options: Record<string, unknown>) => {
				const call = { bin, args, options };
				calls.push(call);
				const result = await override?.(call);
				if (result) return result;
				if (bin === "git") return { code: 0, stdout: args.includes("rev-parse") ? "commit-a" : "", stderr: "" };
				if (args[0] === "status") return { code: 0, stdout: JSON.stringify({ initialized: true, lastIndexed: "2026-01-01" }), stderr: "" };
				if (args[0] === "--json") return { code: 0, stdout: JSON.stringify({ file_count: 1 }), stderr: "" };
				if (args[0] === "sync") {
					if (args.length !== 2 || args[1] !== cwd) return { code: 1, stdout: "", stderr: "unknown option '-p'" };
					return { code: syncFails ? 1 : 0, stdout: "", stderr: syncFails ? "sync failed" : "" };
				}
				if (args[0] === "context") return { code: 1, stdout: "", stderr: "unknown command 'context'" };
				return { code: 0, stdout: "graph results", stderr: "" };
			},
		} as any);
	} finally {
		process.env.PATH = oldPath;
		if (oldStateHome === undefined) delete process.env.XDG_STATE_HOME;
		else process.env.XDG_STATE_HOME = oldStateHome;
	}
	return {
		calls, commands, events, stateHome,
		get history(): any[] {
			const dir = join(stateHome, "code-intel", "maintenance");
			if (!existsSync(dir)) return [];
			return readdirSync(dir).flatMap((id) => readFileSync(join(dir, id, "events.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((line) => {
				try { return JSON.parse(line); }
				catch (cause) { throw new Error("Malformed maintenance journal record", { cause }); }
			}));
		},
		get operations() { return calls.filter((call) => !["status", "--json", "-C"].includes(call.args[0])); },
		execute: (name: string, params: unknown) => tools.get(name).execute("test", params, undefined, undefined, { cwd }),
	};
}

test("context uses explore, with a file limit rather than an unsupported node flag", async () => {
	const h = harness();
	const result = await h.execute("cg_context", { task: "dotfiles update", maxFiles: 3 });
	expect(h.operations[0].args).toEqual(["sync", cwd]);
	expect(h.operations[0].options.signal).toBeUndefined();
	expect(h.operations[0].options.timeout).toBeUndefined();
	expect(h.operations[1].args).toEqual(["explore", "dotfiles update", "-p", cwd, "--max-files", "3"]);
	expect(result.content[0].text).toBe("graph results");
});

test("old maxNodes calls remain usable without sending an invalid flag", async () => {
	const h = harness();
	const result = await h.execute("cg_context", { task: "dotfiles update", maxNodes: 25 });
	expect(h.operations[1].args).toEqual(["explore", "dotfiles update", "-p", cwd]);
	expect(result.content.some((part: any) => part.text.includes("maxNodes"))).toBe(true);
});

test("failed sync is not cached as fresh", async () => {
	const h = harness(true);
	await expect(h.execute("cg_query", { search: "sync" })).rejects.toThrow("sync failed");
	await expect(h.execute("cg_query", { search: "sync" })).rejects.toThrow("sync failed");
	expect(h.calls.filter((call) => call.args[0] === "sync")).toHaveLength(2);
	expect(h.calls.filter((call) => call.args[0] === "query")).toHaveLength(0);
});

test("concurrent failed syncs reject all waiting queries without touching the index", async () => {
	let release!: (result: ExecResult) => void;
	const pending = new Promise<ExecResult>((resolve) => { release = resolve; });
	const h = harness(false, async (call) => call.args[0] === "sync" ? pending : undefined);
	const results = Promise.allSettled([
		h.execute("cg_query", { search: "first" }),
		h.execute("cg_query", { search: "second" }),
	]);
	for (let i = 0; i < 20 && !h.calls.some((call) => call.args[0] === "sync"); i++) await Promise.resolve();
	release({ code: 1, stdout: "", stderr: "index unavailable" });
	expect((await results).every((result) => result.status === "rejected")).toBe(true);
	expect(h.calls.filter((call) => call.args[0] === "sync")).toHaveLength(1);
	expect(h.calls.filter((call) => call.args[0] === "query")).toHaveLength(0);
});

test("parallel queries wait for the same index sync", async () => {
	let release!: (result: ExecResult) => void;
	const pending = new Promise<ExecResult>((resolve) => { release = resolve; });
	const h = harness(false, async (call) => call.args[0] === "sync" ? pending : undefined);
	const first = h.execute("cg_query", { search: "first" });
	const second = h.execute("cg_query", { search: "second" });
	for (let i = 0; i < 20 && !h.calls.some((call) => call.args[0] === "sync"); i++) await Promise.resolve();
	expect(h.calls.filter((call) => call.args[0] === "sync")).toHaveLength(1);
	expect(h.calls.filter((call) => call.args[0] === "query")).toHaveLength(0);
	release({ code: 0, stdout: "", stderr: "" });
	await Promise.all([first, second]);
	expect(h.calls.filter((call) => call.args[0] === "query")).toHaveLength(2);
});

test("manual sync reports failures rather than claiming success", async () => {
	const h = harness(true);
	const notices: string[] = [];
	const statuses: (string | undefined)[] = [];
	await h.commands.get("code-intel-sync").handler("", {
		cwd,
		ui: {
			theme: { fg: (_color: string, text: string) => text },
			setStatus: (_key: string, text: string | undefined) => statuses.push(text),
			notify: (text: string) => notices.push(text),
		},
	});
	expect(notices.join("\n")).toContain("sync failed");
	expect(notices.join("\n")).not.toContain("Synced: codegraph");
	expect(statuses.at(-1)).toBeUndefined();
});

test("index directory with no completed CodeGraph build does not trigger sync or query", async () => {
	for (const status of [{ initialized: false }, { initialized: true, lastIndexed: null }]) {
		const h = harness(false, async (call) => call.args[0] === "status"
			? { code: 0, stdout: JSON.stringify(status), stderr: "" } : undefined);
		await expect(h.execute("cg_query", { search: "sync" })).rejects.toThrow("no completed build");
		expect(h.operations).toHaveLength(0);
	}
});

test("busy readiness probes retry but permanent failures do not", async () => {
	let probes = 0;
	const h = harness(false, async (call) => {
		if (call.args[0] === "status" && probes++ < 2) return { code: 1, stdout: "", stderr: "database is locked" };
	});
	await h.execute("cg_query", { search: "sync" });
	expect(probes).toBe(4); // Two busy probes, successful readiness, post-sync readiness.
	const broken = harness(false, async (call) => call.args[0] === "status"
		? { code: 1, stdout: "", stderr: "permission denied" } : undefined);
	await expect(broken.execute("cg_query", { search: "sync" })).rejects.toThrow("permission denied");
	expect(broken.calls).toHaveLength(1);
});

test("persistent lock contention has a bounded retry count", async () => {
	const h = harness(false, async (call) => call.args[0] === "status"
		? { code: 1, stdout: "", stderr: "Could not acquire file lock - another process may be indexing" } : undefined);
	await expect(h.execute("cg_query", { search: "sync" })).rejects.toThrow("unavailable");
	expect(h.calls).toHaveLength(3);
	expect(h.operations).toHaveLength(0);
});

test("query lock races retry reads, not writers", async () => {
	let queries = 0;
	const h = harness(false, async (call) => call.args[0] === "query" && queries++ === 0
		? { code: 1, stdout: "", stderr: "SQLITE_BUSY: database is locked" } : undefined);
	await h.execute("cg_query", { search: "sync" });
	expect(queries).toBe(2);
	expect(h.calls.filter((call) => call.args[0] === "sync")).toHaveLength(1);
});

test("unsupported commands are not treated as readiness failures", async () => {
	const h = harness(false, async (call) => call.args[0] === "query"
		? { code: 1, stdout: "", stderr: "unknown option '--invalid'" } : undefined);
	await expect(h.execute("cg_query", { search: "sync" })).rejects.toThrow("unknown option");
	expect(h.calls.filter((call) => call.args[0] === "query")).toHaveLength(1);
});

test("other CodeGraph tools retain their supported CLI flags", async () => {
	for (const [name, params, args] of [
		["cg_query", { search: "sync", kind: "function", limit: 4 }, ["query", "sync", "-p", cwd, "-k", "function", "-l", "4"]],
		["cg_callers", { symbol: "sync", limit: 4 }, ["callers", "sync", "-p", cwd, "-l", "4"]],
		["cg_callees", { symbol: "sync", limit: 4 }, ["callees", "sync", "-p", cwd, "-l", "4"]],
		["cg_impact", { symbol: "sync", depth: 3 }, ["impact", "sync", "-p", cwd, "-d", "3"]],
	] as const) {
		const h = harness();
		await h.execute(name, params);
		expect(h.operations[0].args).toEqual(["sync", cwd]);
		expect(h.operations[1].args).toEqual([...args]);
	}
});

test("Vera stats gate queries and use the requested project directory", async () => {
	mkdirSync(join(cwd, ".vera"), { recursive: true });
	const missing = harness(false, async (call) => call.bin === "vera" && call.args[0] === "--json"
		? { code: 1, stdout: "", stderr: "no index found" } : undefined);
	await expect(missing.execute("vera_search", { query: "updates" })).rejects.toThrow("no index found");
	expect(missing.calls.filter((call) => ["update", "search"].includes(call.args[0]))).toHaveLength(0);
	const ready = harness();
	await ready.execute("vera_search", { query: "updates" });
	expect(ready.calls.filter((call) => call.bin === "vera").every((call) => call.options.cwd === cwd || call.args[1] === cwd)).toBe(true);
});

test("an incomplete Vera index is not endlessly retried or rebuilt", async () => {
	const h = harness(false, async (call) => call.bin === "vera" && call.args[0] === "search"
		? { code: 1, stdout: "", stderr: "index is incomplete because an update stopped before it finished writing" } : undefined);
	await expect(h.execute("vera_search", { query: "updates" })).rejects.toThrow("incomplete");
	expect(h.calls.filter((call) => call.args[0] === "search")).toHaveLength(1);
	expect(h.calls.some((call) => call.args[0] === "index")).toBe(false);
});

test("Graphify load errors are reported without repeated rebuild attempts", async () => {
	mkdirSync(join(cwd, "graphify-out"), { recursive: true });
	writeFileSync(join(cwd, "graphify-out/graph.json"), JSON.stringify({ nodes: [], edges: [] }));
	const h = harness(false, async (call) => call.bin === "graphify" && call.args[0] === "query"
		? { code: 1, stdout: "", stderr: "error: could not load graph: invalid JSON" } : undefined);
	await expect(h.execute("gf_query", { question: "architecture" })).rejects.toThrow("could not load graph");
	expect(h.calls.filter((call) => call.args[0] === "query")).toHaveLength(1);
	expect(h.calls.filter((call) => call.args[0] === "update")).toHaveLength(1);
});

function commandContext(approved = true, hasUI = true) {
	const notices: string[] = [];
	const statuses: (string | undefined)[] = [];
	return {
		notices, statuses,
		ctx: {
			cwd, hasUI,
			ui: {
				confirm: async () => approved,
				theme: { fg: (_color: string, text: string) => text },
				setStatus: (_key: string, text: string | undefined) => statuses.push(text),
				notify: (text: string) => notices.push(text),
			},
		},
	};
}

test("incompatible Vera format stops repeated failed writers and gives a repair command", async () => {
	const h = harness(false, async (call) => call.bin === "vera" && call.args[0] === "update"
		? { code: 1, stdout: "", stderr: "Index format version mismatch (expected 2, found None)" } : undefined);
	await expect(h.execute("vera_search", { query: "updates" })).rejects.toThrow("/code-intel-repair vera");
	await expect(h.execute("vera_search", { query: "updates" })).rejects.toThrow("/code-intel-repair vera");
	expect(h.calls.filter((call) => call.args[0] === "update")).toHaveLength(1);
	expect(h.calls.some((call) => call.args[0] === "index")).toBe(false);
});

test("a clean commit or branch switch forces sync even inside the debounce window", async () => {
	let head = "commit-a";
	const h = harness(false, async (call) => call.bin === "git" && call.args.includes("rev-parse")
		? { code: 0, stdout: head, stderr: "" } : undefined);
	await h.execute("cg_query", { search: "first" });
	head = "commit-b";
	await h.execute("cg_query", { search: "second" });
	expect(h.calls.filter((call) => call.args[0] === "sync")).toHaveLength(2);
});

test("Codegraph extractor changes are advisory, not an automatic cold rebuild", async () => {
	const h = harness(false, async (call) => call.args[0] === "status"
		? { code: 0, stdout: JSON.stringify({ initialized: true, lastIndexed: "2026-01-01", index: { reindexRecommended: true } }), stderr: "" } : undefined);
	const result = await h.execute("cg_query", { search: "sync" });
	expect(result.content.some((part: any) => part.text.includes("/code-intel-repair codegraph"))).toBe(true);
	expect(h.calls.some((call) => call.args[0] === "index")).toBe(false);
});

test("repair requires confirmation and uses the shared helper without a timeout or signal", async () => {
	const h = harness();
	const cancelled = commandContext(false);
	await h.commands.get("code-intel-repair").handler("vera", cancelled.ctx);
	expect(h.calls).toHaveLength(0);
	const headless = commandContext(true, false);
	await h.commands.get("code-intel-repair").handler("vera", headless.ctx);
	expect(h.calls).toHaveLength(0);
	const approved = commandContext();
	await h.commands.get("code-intel-repair").handler("vera", approved.ctx);
	const job = h.calls.find((call) => call.bin === "code-intel");
	expect(job?.args).toEqual(["repair", "vera"]);
	expect(job?.options.cwd).toBe(cwd);
	expect(job?.options.signal).toBeUndefined();
	expect(job?.options.timeout).toBeUndefined();
	expect(approved.notices.join("\n")).toContain("Repaired: vera");
	expect(approved.statuses.at(-1)).toBeUndefined();
});

test("repair failure is not success and stays actionable", async () => {
	const h = harness(false, async (call) => call.bin === "code-intel"
		? { code: 9, stdout: "Log: /private/repair.log", stderr: "repair failed" } : undefined);
	const c = commandContext();
	await h.commands.get("code-intel-repair").handler("vera", c.ctx);
	expect(c.notices.join("\n")).toContain("repair failed");
	expect(c.notices.join("\n")).toContain("/private/repair.log");
	expect(c.notices.join("\n")).not.toContain("Repaired: vera");
});

test("a confirmed repair clears a remembered Vera format failure", async () => {
	let broken = true;
	const h = harness(false, async (call) => call.bin === "vera" && call.args[0] === "update" && broken
		? { code: 1, stdout: "", stderr: "Index format version mismatch" } : undefined);
	await expect(h.execute("vera_search", { query: "first" })).rejects.toThrow("requires repair");
	broken = false;
	await h.commands.get("code-intel-repair").handler("vera", commandContext().ctx);
	await h.execute("vera_search", { query: "second" });
	expect(h.calls.filter((call) => call.args[0] === "search")).toHaveLength(1);
});

test("manual sync can recover after an external repair", async () => {
	let broken = true;
	const h = harness(false, async (call) => call.bin === "vera" && call.args[0] === "update" && broken
		? { code: 1, stdout: "", stderr: "Index format version mismatch" } : undefined);
	await expect(h.execute("vera_search", { query: "first" })).rejects.toThrow("requires repair");
	broken = false;
	const c = commandContext();
	await h.commands.get("code-intel-sync").handler("", c.ctx);
	await h.execute("vera_search", { query: "second" });
	expect(c.notices.join("\n")).toContain("Synced:");
	expect(h.calls.filter((call) => call.bin === "vera" && call.args[0] === "update")).toHaveLength(2);
});

test("staged changes trigger synchronization after the debounce window", async () => {
	let staged = false;
	const h = harness(false, async (call) => call.bin === "git" && call.args.includes("--porcelain")
		? { code: 0, stdout: staged ? "A  added.ts" : "", stderr: "" } : undefined);
	const now = Date.now;
	let clock = now();
	Date.now = () => clock;
	try {
		await h.execute("cg_query", { search: "first" });
		staged = true;
		clock += 6000;
		await h.execute("cg_query", { search: "second" });
		expect(h.calls.filter((call) => call.args[0] === "sync")).toHaveLength(2);
	} finally { Date.now = now; }
});

test("queries and shutdown wait for a confirmed repair", async () => {
	let release!: (result: ExecResult) => void;
	const pending = new Promise<ExecResult>((resolve) => { release = resolve; });
	const h = harness(false, async (call) => call.bin === "code-intel" ? pending : undefined);
	const repair = h.commands.get("code-intel-repair").handler("codegraph", commandContext().ctx);
	for (let i = 0; i < 20 && !h.calls.some((call) => call.bin === "code-intel"); i++) await Promise.resolve();
	const query = h.execute("cg_query", { search: "first" });
	let closed = false;
	const shutdown = h.events.get("session_shutdown")().then(() => { closed = true; });
	await Promise.resolve();
	expect(closed).toBe(false);
	expect(h.calls.some((call) => call.args[0] === "query")).toBe(false);
	release({ code: 0, stdout: "Log: /private/repair.log", stderr: "" });
	await Promise.all([repair, query, shutdown]);
	expect(closed).toBe(true);
});

async function drainBackground() {
	for (let i = 0; i < 200; i++) await Promise.resolve();
}

// Time is a system boundary: drive idle callbacks without real waits or indexes.
function backgroundClock() {
	let now = Date.now();
	const timers = new Map<object, { at: number; callback: () => void }>();
	let poll = () => {};
	const date = spyOn(Date, "now").mockImplementation(() => now);
	const timeout = spyOn(globalThis, "setTimeout").mockImplementation(((callback: any, ms?: number) => {
		const handle = { unref() {} };
		timers.set(handle, { at: now + (ms ?? 0), callback });
		return handle as any;
	}) as typeof setTimeout);
	const clear = spyOn(globalThis, "clearTimeout").mockImplementation((handle: any) => { timers.delete(handle); });
	const interval = spyOn(globalThis, "setInterval").mockImplementation((callback: any) => {
		poll = callback; return { unref() {} } as any;
	});
	const clearInterval = spyOn(globalThis, "clearInterval").mockImplementation(() => {});
	return {
		async poll() { poll(); await drainBackground(); },
		async advance(ms: number) {
			const end = now + ms;
			for (;;) {
				const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
				if (!next || next[1].at > end) break;
				now = next[1].at;
				timers.delete(next[0]);
				next[1].callback();
				await drainBackground();
			}
			now = end;
			await drainBackground();
		},
		restore() { date.mockRestore(); timeout.mockRestore(); clear.mockRestore(); interval.mockRestore(); clearInterval.mockRestore(); },
	};
}

function liveContext() {
	const c = commandContext();
	const published = new Map<string, string | undefined>();
	return { ...c, published, ctx: { ...c.ctx, mode: "tui", ui: { ...c.ctx.ui, setStatus: (key: string, value: string | undefined) => published.set(key, value) } } };
}

test("idle sessions update existing indexes and verify Vera without a query", async () => {
	const clock = backgroundClock();
	const h = harness();
	const c = liveContext();
	try {
		await h.events.get("session_start")({ reason: "startup" }, c.ctx);
		expect(h.calls.some(call => ["sync", "update"].includes(call.args[0]))).toBe(false);
		await clock.advance(6000);
		expect(h.calls.filter(call => call.bin === "codegraph" && call.args[0] === "sync")).toHaveLength(1);
		expect(h.calls.filter(call => call.bin === "vera" && call.args[0] === "update")).toHaveLength(1);
		expect(c.published.get("code-intel-indexes")).toContain("CG✓ V✓");
	} finally { await h.events.get("session_shutdown")(); clock.restore(); }
});

test("rapid same-status edits coalesce and unchanged polls do not repeat updates", async () => {
	const clock = backgroundClock();
	let dirty = false;
	const file = join(cwd, "background-edits.ts");
	const h = harness(false, async call => call.bin === "git" && call.args.includes("--porcelain")
		? { code: 0, stdout: dirty ? " M background-edits.ts\0" : "", stderr: "" } : undefined);
	const c = liveContext();
	try {
		await h.events.get("session_start")({ reason: "startup" }, c.ctx);
		await clock.advance(6000);
		dirty = true;
		for (let i = 1; i <= 3; i++) {
			writeFileSync(file, `edit ${i}`); utimesSync(file, i * 100, i * 100);
			await h.events.get("tool_result")({ toolName: "edit", input: {}, isError: false }, c.ctx);
			if (i < 3) await clock.advance(1000);
		}
		await clock.advance(1999);
		expect(h.calls.filter(call => call.bin === "vera" && call.args[0] === "update")).toHaveLength(1);
		await clock.advance(1);
		expect(h.calls.filter(call => call.bin === "vera" && call.args[0] === "update")).toHaveLength(2);
		expect(c.published.get("code-intel-indexes")).toContain("CG✓ V✓");
		await clock.poll(); await clock.advance(6000);
		expect(h.calls.filter(call => call.bin === "vera" && call.args[0] === "update")).toHaveLength(2);
	} finally { await h.events.get("session_shutdown")(); clock.restore(); rmSync(file, { force: true }); }
});

test("edits during a background update get a follow-up update without another query", async () => {
	const clock = backgroundClock();
	let dirty = false;
	let updates = 0;
	let release!: (result: ExecResult) => void;
	const pending = new Promise<ExecResult>(resolve => { release = resolve; });
	const file = join(cwd, "during-update.ts");
	const h = harness(false, async call => {
		if (call.bin === "git" && call.args.includes("--porcelain")) return { code: 0, stdout: dirty ? " M during-update.ts\0" : "", stderr: "" };
		if (call.bin === "vera" && call.args[0] === "update" && updates++ === 0) return pending;
	});
	const c = liveContext();
	try {
		await h.events.get("session_start")({ reason: "startup" }, c.ctx);
		await clock.advance(6000);
		dirty = true;
		writeFileSync(file, "edited while indexing");
		await h.events.get("tool_result")({ toolName: "edit", input: {}, isError: false }, c.ctx);
		release({ code: 0, stdout: "", stderr: "" });
		await drainBackground();
		await clock.advance(6000);
		expect(updates).toBe(2);
		expect(c.published.get("code-intel-indexes")).toContain("CG✓ V✓");
	} finally { release({ code: 0, stdout: "", stderr: "" }); await h.events.get("session_shutdown")(); clock.restore(); rmSync(file, { force: true }); }
});

test("background failures do not retry the same workspace or silently repair it", async () => {
	const clock = backgroundClock();
	const h = harness(false, async call => call.bin === "vera" && call.args[0] === "update"
		? { code: 1, stdout: "", stderr: "Index format version mismatch" } : undefined);
	const c = liveContext();
	try {
		await h.events.get("session_start")({ reason: "startup" }, c.ctx);
		await clock.advance(6000);
		expect(c.published.get("code-intel-indexes")).toContain("V!");
		await clock.poll(); await clock.advance(6000);
		expect(h.calls.filter(call => call.bin === "vera" && call.args[0] === "update")).toHaveLength(1);
		expect(h.calls.some(call => ["init", "repair", "index"].includes(call.args[0]))).toBe(false);
	} finally { await h.events.get("session_shutdown")(); clock.restore(); }
});

test("expensive Graphify rebuilds stay manual while incremental indexes update", async () => {
	const clock = backgroundClock();
	const path = join(cwd, "graphify-out", "graph.json");
	const original = existsSync(path) ? readFileSync(path) : undefined;
	mkdirSync(join(cwd, "graphify-out"), { recursive: true });
	writeFileSync(path, JSON.stringify({ nodes: [], padding: "x".repeat(10_000_000) }));
	const h = harness(false, async call => call.bin === "graphify" && call.args[0] === "god-nodes"
		? { code: 0, stdout: JSON.stringify([{ label: "hub" }]), stderr: "" } : undefined);
	const c = liveContext();
	try {
		await h.events.get("session_start")({ reason: "startup" }, c.ctx);
		await clock.advance(6000);
		expect(h.calls.some(call => call.bin === "graphify" && call.args[0] === "update")).toBe(false);
		expect(h.calls.some(call => call.bin === "vera" && call.args[0] === "update")).toBe(true);
	} finally {
		await h.events.get("session_shutdown")(); clock.restore();
		if (original) writeFileSync(path, original); else rmSync(path, { force: true });
	}
});

test("small Graphify indexes share the background update path without semantic extraction", async () => {
	const clock = backgroundClock();
	const path = join(cwd, "graphify-out", "graph.json");
	const original = existsSync(path) ? readFileSync(path) : undefined;
	mkdirSync(join(cwd, "graphify-out"), { recursive: true });
	writeFileSync(path, JSON.stringify({ nodes: [{ label: "hub" }] }));
	const h = harness(false, async call => call.bin === "graphify" && call.args[0] === "god-nodes"
		? { code: 0, stdout: JSON.stringify([{ label: "hub" }]), stderr: "" } : undefined);
	const c = liveContext();
	try {
		await h.events.get("session_start")({ reason: "startup" }, c.ctx);
		await clock.advance(6000);
		expect(h.calls.filter(call => call.bin === "graphify" && call.args[0] === "update")).toHaveLength(1);
		expect(h.calls.some(call => call.args.includes("--semantic"))).toBe(false);
	} finally {
		await h.events.get("session_shutdown")(); clock.restore();
		if (original) writeFileSync(path, original); else rmSync(path, { force: true });
	}
});

test("unavailable or incomplete indexes are not automatically built or repaired", async () => {
	const clock = backgroundClock();
	const h = harness(false, async call => {
		if (call.bin === "codegraph" && call.args[0] === "status") return { code: 0, stdout: JSON.stringify({ initialized: false }), stderr: "" };
		if (call.bin === "vera" && call.args[0] === "--json") return { code: 1, stdout: "", stderr: "index is incomplete" };
	});
	const c = liveContext();
	try {
		await h.events.get("session_start")({ reason: "startup" }, c.ctx);
		await clock.advance(6000);
		await clock.poll(); await clock.advance(6000);
		expect(h.calls.some(call => ["sync", "update", "init", "repair", "index"].includes(call.args[0]))).toBe(false);
		expect(c.published.get("code-intel-indexes")).toContain("CG× V!");
	} finally { await h.events.get("session_shutdown")(); clock.restore(); }
});

test("headless sessions keep query-time updates without background timers", async () => {
	const clock = backgroundClock();
	const h = harness();
	const c = liveContext();
	try {
		await h.events.get("session_start")({ reason: "startup" }, { ...c.ctx, hasUI: false, mode: "print" });
		await clock.advance(6000);
		expect(h.calls).toHaveLength(0);
		await h.execute("vera_search", { query: "updates" });
		expect(h.calls.filter(call => call.bin === "vera" && call.args[0] === "update")).toHaveLength(1);
	} finally { await h.events.get("session_shutdown")(); clock.restore(); }
});

test("shutdown cancels queued updates before any writer starts", async () => {
	const clock = backgroundClock();
	const h = harness();
	const c = liveContext();
	try {
		await h.events.get("session_start")({ reason: "startup" }, c.ctx);
		await h.events.get("session_shutdown")();
		await clock.advance(6000);
		expect(h.calls.some(call => ["sync", "update", "index"].includes(call.args[0]))).toBe(false);
	} finally { await h.events.get("session_shutdown")(); clock.restore(); }
});

test("footer starts read-only, distinguishes unchecked Vera, and mode rendering uses cached health", async () => {
	const h = harness();
	const c = liveContext();
	try {
		await h.events.get("session_start")({ reason: "startup" }, c.ctx);
		expect(c.published.get("code-intel-indexes")).toContain("CG✓ V?");
		expect(h.calls.some(call => ["sync", "update", "init", "repair", "index", "query", "search"].includes(call.args[0]))).toBe(false);
		const before = h.calls.length;
		await h.commands.get("code-intel").handler("off", c.ctx);
		expect(h.calls).toHaveLength(before);
		await h.commands.get("code-intel").handler("status", c.ctx);
		expect(c.notices.at(-1)).toContain("Statistics readable; vector queries not yet verified");
		expect(c.notices.at(-1)).toContain("History:");
	} finally { await h.events.get("session_shutdown")(); }
	expect(c.published.get("code-intel-indexes")).toBeUndefined();
});

test("updating footer and private journal reflect one shared writer and waiting queries", async () => {
	let release!: (result: ExecResult) => void;
	const pending = new Promise<ExecResult>(resolve => { release = resolve; });
	const h = harness(false, async call => call.args[0] === "sync" ? pending : undefined);
	const c = liveContext();
	await h.events.get("session_start")({ reason: "startup" }, c.ctx);
	const first = h.execute("cg_query", { search: "SECRET-QUERY-ONE" });
	for (let i = 0; i < 80 && !h.calls.some(call => call.args[0] === "sync"); i++) await Promise.resolve();
	const second = h.execute("cg_query", { search: "SECRET-QUERY-TWO" });
	expect(c.published.get("code-intel-indexes")).toContain("CG↻");
	release({ code: 0, stdout: "SECRET-SOURCE", stderr: "" });
	try {
		await Promise.all([first, second]);
		expect(c.published.get("code-intel-indexes")).toContain("CG✓");
		expect(h.history.filter(e => e.event === "update")).toHaveLength(1);
		expect(h.history.filter(e => e.event === "writer-wait")).toHaveLength(1);
		expect(JSON.stringify(h.history)).not.toContain("SECRET");
	} finally { await h.events.get("session_shutdown")(); }
});

test("same-status edits become stale and history measures observed-to-ready and duplicate updates", async () => {
	const file = join(cwd, "dirty.ts");
	writeFileSync(file, "one"); utimesSync(file, 10, 10);
	const h = harness(false, async call => call.bin === "git" && call.args.includes("--porcelain")
		? { code: 0, stdout: " M dirty.ts\0", stderr: "" } : undefined);
	const c = liveContext();
	const originalNow = Date.now;
	let clock = originalNow(); Date.now = () => clock;
	try {
		await h.events.get("session_start")({ reason: "startup" }, c.ctx);
		await h.execute("cg_query", { search: "first" });
		writeFileSync(file, "two"); utimesSync(file, 20, 20);
		await h.events.get("tool_result")({ toolName: "edit", input: {}, isError: false }, c.ctx);
		expect(c.published.get("code-intel-indexes")).toContain("CG~");
		clock += 75;
		await h.commands.get("code-intel-sync").handler("", c.ctx);
		const ready = h.history.filter(e => e.backend === "codegraph" && e.event === "update").at(-1);
		expect(ready).toMatchObject({ trigger: "manual-sync", outcome: "success", noChange: false, changeToReadyMs: 75 });
		clock += 50;
		await h.commands.get("code-intel-sync").handler("", c.ctx);
		expect(h.history.filter(e => e.backend === "codegraph" && e.event === "update").at(-1).noChange).toBe(true);
		expect(c.published.get("code-intel-indexes")).toContain("CG✓");
	} finally { Date.now = originalNow; await h.events.get("session_shutdown")(); }
});

test("repair-needed footer is sticky without repeated probes, and history never stores errors or queries", async () => {
	const h = harness(false, async call => call.bin === "vera" && call.args[0] === "update"
		? { code: 1, stdout: "", stderr: "Index format version mismatch: SECRET-SOURCE" } : undefined);
	const c = liveContext();
	try {
		await h.events.get("session_start")({ reason: "startup" }, c.ctx);
		await expect(h.execute("vera_search", { query: "SECRET-QUERY" })).rejects.toThrow("requires repair");
		expect(c.published.get("code-intel-indexes")).toContain("V!");
		const before = h.calls.filter(call => call.bin === "vera").length;
		await h.commands.get("code-intel").handler("status", c.ctx);
		expect(h.calls.filter(call => call.bin === "vera")).toHaveLength(before);
		expect(c.notices.at(-1)).toContain("Incompatible index format");
		expect(h.history.filter(e => e.backend === "vera" && e.event === "blocked-query")).toHaveLength(1);
		expect(JSON.stringify(h.history)).not.toContain("SECRET");
		const calls = h.calls.length;
		await h.commands.get("code-intel").handler("history", c.ctx);
		expect(h.calls).toHaveLength(calls);
		expect(c.notices.at(-1)).toContain("History: last 7 days");
	} finally { await h.events.get("session_shutdown")(); }
});

test("helper failure keeps its log and last failure visible even when a later read probe succeeds", async () => {
	const h = harness(false, async call => call.bin === "code-intel"
		? { code: 1, stdout: "  logs: /private/code-intel/run.example\n", stderr: "repair failed" } : undefined);
	const c = liveContext();
	try {
		await h.events.get("session_start")({ reason: "startup" }, c.ctx);
		await h.commands.get("code-intel-repair").handler("codegraph", c.ctx);
		await h.commands.get("code-intel").handler("status", c.ctx);
		expect(c.notices.at(-1)).toContain("last failure:");
		expect(c.notices.at(-1)).toContain("/private/code-intel/run.example/codegraph.log");
		expect(h.history.filter(e => e.event === "repair")).toHaveLength(1);
		expect(h.history.find(e => e.event === "repair").outcome).toBe("failure");
	} finally { await h.events.get("session_shutdown")(); }
});

test("queries share a background writer and shutdown waits without interrupting it", async () => {
	const clock = backgroundClock();
	let release!: (result: ExecResult) => void;
	const pending = new Promise<ExecResult>(resolve => { release = resolve; });
	const h = harness(false, async call => call.bin === "vera" && call.args[0] === "update" ? pending : undefined);
	const c = liveContext();
	try {
		await h.events.get("session_start")({ reason: "startup" }, c.ctx);
		await clock.advance(6000);
		expect(c.published.get("code-intel-indexes")).toContain("V↻");
		const query = h.execute("vera_search", { query: "latest edits" });
		await drainBackground();
		expect(h.calls.some(call => call.bin === "vera" && call.args[0] === "search")).toBe(false);
		let closed = false;
		const shutdown = h.events.get("session_shutdown")().then(() => { closed = true; });
		await drainBackground();
		expect(closed).toBe(false);
		release({ code: 0, stdout: "", stderr: "" });
		await Promise.all([query, shutdown]);
		expect(closed).toBe(true);
		const updates = h.calls.filter(call => call.bin === "vera" && call.args[0] === "update");
		expect(updates).toHaveLength(1);
		expect(updates[0].options.signal).toBeUndefined();
		expect(updates[0].options.timeout).toBeUndefined();
	} finally { release({ code: 0, stdout: "", stderr: "" }); await h.events.get("session_shutdown")(); clock.restore(); }
});

test("periodic health refreshes a clean HEAD switch without a query and stops on shutdown", async () => {
	const clock = backgroundClock();
	let head = "commit-a";
	const h = harness(false, async call => call.bin === "git" && call.args.includes("rev-parse")
		? { code: 0, stdout: head, stderr: "" } : undefined);
	const c = liveContext();
	try {
		await h.events.get("session_start")({ reason: "startup" }, c.ctx);
		await clock.advance(6000);
		head = "commit-b";
		await clock.poll();
		expect(c.published.get("code-intel-indexes")).toContain("CG~");
		await clock.advance(6000);
		expect(h.calls.filter(call => call.bin === "vera" && call.args[0] === "update")).toHaveLength(2);
		expect(h.history.some(e => e.backend === "vera" && e.event === "update" && e.trigger === "head-changed")).toBe(true);
		expect(c.published.get("code-intel-indexes")).toContain("CG✓ V✓");
		await h.events.get("session_shutdown")();
		const count = h.calls.length;
		await clock.poll(); await clock.advance(6000);
		expect(h.calls).toHaveLength(count);
		expect(c.published.get("code-intel-indexes")).toBeUndefined();
	} finally { await h.events.get("session_shutdown")(); clock.restore(); }
});

test("periodic health observes HEAD changes immediately before queued updates run", async () => {
	let tick!: () => void;
	let head = "commit-a";
	const interval = spyOn(globalThis, "setInterval").mockImplementation((callback: any) => {
		tick = callback; return { unref() {} } as any;
	});
	const clear = spyOn(globalThis, "clearInterval").mockImplementation(() => {});
	const h = harness(false, async call => call.bin === "git" && call.args.includes("rev-parse")
		? { code: 0, stdout: head, stderr: "" } : undefined);
	const c = liveContext();
	try {
		await h.events.get("session_start")({ reason: "startup" }, c.ctx);
		expect(interval).toHaveBeenCalledTimes(1);
		head = "commit-b";
		tick();
		for (let i = 0; i < 80; i++) await Promise.resolve();
		expect(c.published.get("code-intel-indexes")).toContain("CG~");
		expect(h.calls.some(call => ["sync", "update", "index"].includes(call.args[0]))).toBe(false);
		await h.events.get("session_shutdown")();
		expect(clear).toHaveBeenCalledTimes(1);
		expect(c.published.get("code-intel-indexes")).toBeUndefined();
	} finally { await h.events.get("session_shutdown")(); interval.mockRestore(); clear.mockRestore(); }
});

test("a successful Vera update stays unchecked until a real vector query succeeds", async () => {
	const h = harness();
	const c = liveContext();
	try {
		await h.events.get("session_start")({ reason: "startup" }, c.ctx);
		await h.commands.get("code-intel-sync").handler("", c.ctx);
		expect(c.published.get("code-intel-indexes")).toContain("V?");
		await h.execute("vera_search", { query: "SECRET-QUERY" });
		expect(c.published.get("code-intel-indexes")).toContain("V✓");
		expect(h.history.some(e => e.backend === "vera" && e.event === "probe" && e.trigger === "query")).toBe(true);
		expect(JSON.stringify(h.history)).not.toContain("SECRET");
	} finally { await h.events.get("session_shutdown")(); }
});

test("a slow health probe cannot overwrite a writer that starts and finishes while it is pending", async () => {
	let holdNext = false;
	let release!: (result: ExecResult) => void;
	const pending = new Promise<ExecResult>(resolve => { release = resolve; });
	const h = harness(false, async call => {
		if (holdNext && call.bin === "codegraph" && call.args[0] === "status") { holdNext = false; return pending; }
		return undefined;
	});
	const c = liveContext();
	await h.events.get("session_start")({ reason: "startup" }, c.ctx);
	holdNext = true;
	const status = h.commands.get("code-intel").handler("status", c.ctx);
	for (let i = 0; i < 80 && holdNext; i++) await Promise.resolve();
	await h.execute("cg_query", { search: "first" });
	release({ code: 0, stdout: JSON.stringify({ initialized: true, lastIndexed: "2026-01-01", index: { reindexRecommended: true } }), stderr: "" });
	try {
		await status;
		expect(c.published.get("code-intel-indexes")).toContain("CG✓");
	} finally { await h.events.get("session_shutdown")(); }
});
