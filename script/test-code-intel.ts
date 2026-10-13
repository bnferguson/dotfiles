// Run with: bun test ./script/test-code-intel.ts
import { afterAll, expect, mock, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
for (const bin of ["codegraph", "vera", "graphify"]) writeFileSync(join(root, bin), ""); // PATH probes only.
afterAll(() => rmSync(root, { recursive: true, force: true }));

type Call = { bin: string; args: string[]; options: Record<string, unknown> };
type ExecResult = { code: number; stdout: string; stderr: string };
function harness(syncFails = false, override?: (call: Call) => Promise<ExecResult | undefined>) {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const calls: Call[] = [];
	const oldPath = process.env.PATH;
	process.env.PATH = root;
	try {
		codeIntelExtension({
			registerTool: (tool: any) => tools.set(tool.name, tool),
			registerFlag() {}, registerCommand: (name: string, command: any) => commands.set(name, command), registerShortcut() {}, on() {},
			exec: async (bin: string, args: string[], options: Record<string, unknown>) => {
				const call = { bin, args, options };
				calls.push(call);
				const result = await override?.(call);
				if (result) return result;
				if (bin === "git") return { code: 0, stdout: "", stderr: "" };
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
	}
	return {
		calls, commands,
		get operations() { return calls.filter((call) => !["status", "--json", "-C"].includes(call.args[0])); },
		execute: (name: string, params: unknown) => tools.get(name).execute("test", params, undefined, undefined, { cwd }),
	};
}

test("context uses explore, with a file limit rather than an unsupported node flag", async () => {
	const h = harness();
	const result = await h.execute("cg_context", { task: "dotfiles update", maxFiles: 3 });
	expect(h.operations[0].args).toEqual(["sync", cwd]);
	expect(h.operations[0].options.signal).toBeUndefined();
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
		expect(h.operations[1].args).toEqual(args);
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
