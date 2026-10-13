import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { IndexObservability, type Health } from "../pi/config/extensions/code-intel/observability.ts";

const roots: string[] = [];
const NOW = 1_800_000_000_000;
function fixture(sessionId = "session-a", now = NOW) {
	const root = mkdtempSync(join(tmpdir(), "index-observability-"));
	roots.push(root);
	const cwd = join(root, "worktree");
	mkdirSync(cwd);
	const stateHome = join(root, "state");
	return { root, cwd, stateHome, obs: new IndexObservability(cwd, { stateHome, sessionId, now: () => now }) };
}
const event = { backend: "codegraph", event: "update", trigger: "query", outcome: "success" } as const;
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("IndexObservability", () => {
	test("constructor and renderers are read-only; snapshots are defensive copies", () => {
		const { obs, stateHome } = fixture();
		expect(obs.get("vera")).toEqual({ state: "unchecked" });
		expect(obs.footer()).toBe("idx CG? V? GF?");
		expect(obs.details()).toContain("last success: never");
		expect(obs.historySummary()).toBe("History: no records yet");
		obs.update("vera", { state: "ready", lastSuccess: NOW - 5000, reason: "memory-only failure", logPath: "/private/log", changeToReadyMs: 42 });
		const snapshot = obs.get("vera");
		snapshot.state = "missing";
		expect(obs.get("vera").state).toBe("ready");
		expect(obs.details()).toContain("last success: 5s ago; reason: memory-only failure; log: /private/log; change-to-ready: 42ms");
		expect(existsSync(stateHome)).toBe(false);
	});

	test("footer covers every health and details includes the legend", () => {
		const { obs } = fixture();
		const marks: Record<Health, string> = { unchecked: "?", ready: "✓", updating: "↻", stale: "~", repair: "!", missing: "∅", unavailable: "×" };
		for (const [state, mark] of Object.entries(marks)) {
			obs.update("codegraph", { state: state as Health });
			expect(obs.footer()).toBe(`idx CG${mark} V? GF?`);
			expect(obs.details()).toContain(`CG: ${state}`);
		}
		obs.update("vera", { state: "updating" });
		obs.update("graphify", { state: "stale" });
		expect(obs.footer()).toBe("idx CG× V↻ GF~");
		expect(obs.details()).toContain("Legend:");
	});

	test("journal is private, allowlisted, and keyed by the physical worktree", () => {
		const { root, cwd, obs, stateHome } = fixture();
		const alias = join(root, "alias");
		symlinkSync(cwd, alias);
		expect(new IndexObservability(alias, { stateHome }).historyPath).toBe(obs.historyPath);
		const other = join(root, "other");
		mkdirSync(other);
		expect(new IndexObservability(other, { stateHome }).historyPath).not.toBe(obs.historyPath);
		const secrets = { cwd, reason: "SECRET", source: "SECRET", query: "SECRET", output: "SECRET", arbitrary: "SECRET" };
		obs.update("codegraph", { state: "ready", ...secrets });
		obs.record({ ...event, durationMs: 100, waitMs: 10, changeToReadyMs: 200, noChange: true, ...secrets });
		const text = readFileSync(obs.historyPath, "utf8");
		expect(text).not.toContain("SECRET");
		expect(text).not.toContain(cwd);
		expect(text).toBe(JSON.stringify({ timestamp: NOW, session: "session-a", pid: process.pid, ...event, durationMs: 100, waitMs: 10, changeToReadyMs: 200, noChange: true }) + "\n");
		expect(statSync(dirname(obs.historyPath)).mode & 0o777).toBe(0o700);
		expect(statSync(obs.historyPath).mode & 0o777).toBe(0o600);
		chmodSync(obs.historyPath, 0o644);
		obs.record(event);
		expect(statSync(obs.historyPath).mode & 0o777).toBe(0o600);
		const before = statSync(obs.historyPath);
		obs.footer(); obs.details(); obs.historySummary();
		expect(readFileSync(obs.historyPath, "utf8")).toBe(text + JSON.stringify({ timestamp: NOW, session: "session-a", pid: process.pid, ...event }) + "\n");
		expect(statSync(obs.historyPath).mtimeMs).toBe(before.mtimeMs);
	});

	test("invalid runtime values do not create a journal or corrupt state", () => {
		const { obs, stateHome } = fixture();
		const invalid = [
			{ backend: "bad" }, { event: "bad" }, { trigger: "bad" }, { outcome: "bad" },
			{ durationMs: -1 }, { durationMs: NaN }, { waitMs: Infinity }, { waitMs: "12" },
			{ changeToReadyMs: -1 }, { noChange: "true" },
		];
		type RecordInput = Parameters<IndexObservability["record"]>[0];
		type UpdateInput = Parameters<IndexObservability["update"]>[1];
		for (const patch of invalid) {
			// SAFETY: Only this test bypasses types; record() must reject each invalid payload before writing it.
			obs.record({ ...event, ...patch } as unknown as RecordInput);
		}
		// SAFETY: Null deliberately bypasses the static contract to test the runtime boundary.
		obs.record(null as unknown as RecordInput);
		// SAFETY: Invalid fields deliberately bypass the static contract to test runtime rejection.
		obs.update("codegraph", { state: "bad", lastSuccess: NaN, changeToReadyMs: -1, reason: 1 } as unknown as UpdateInput);
		// SAFETY: Invalid backend deliberately tests the runtime enum boundary.
		obs.update("bad" as Parameters<IndexObservability["update"]>[0], { state: "ready" });
		expect(obs.get("codegraph")).toEqual({ state: "unchecked" });
		expect(existsSync(stateHome)).toBe(false);
	});

	test("seven-day aggregation counts outcomes, timings, waits, no-change and cross-writer overlaps", () => {
		const { obs, cwd, stateHome } = fixture();
		obs.record({ ...event, durationMs: 100, noChange: true, changeToReadyMs: 150 });
		// Same writer overlaps do not count; a different session does.
		obs.record({ ...event, durationMs: 50 });
		const peer = new IndexObservability(cwd, { stateHome, sessionId: "session-b", now: () => NOW - 25 });
		peer.record({ ...event, event: "repair", outcome: "failure", durationMs: 100 });
		obs.record({ ...event, event: "lock-wait", waitMs: 30 });
		obs.record({ ...event, event: "writer-wait", waitMs: 40 });
		obs.record({ ...event, event: "blocked-query", outcome: "skipped" });
		obs.record({ ...event, backend: "vera", event: "probe", outcome: "failure", durationMs: 10 });
		const base = { timestamp: NOW, session: "session-a", pid: process.pid + 1, ...event, event: "init", durationMs: 10 };
		appendFileSync(obs.historyPath, ["not json", JSON.stringify(base), JSON.stringify({ ...base, timestamp: NOW - 8 * 86400000 }), JSON.stringify({ ...base, timestamp: NOW + 1 }), JSON.stringify({ ...base, durationMs: -1 }), JSON.stringify({ ...base, pid: "bad" })].join("\n") + "\n");
		const result = obs.historySummary();
		expect(result).toContain("last 7 days");
		expect(result).toContain("CG: update=2 repair=1 init=1 lock-wait=1 writer-wait=1 debounce=0 blocked-query=1 probe=0");
		expect(result).toContain("success=5 failure=1 skipped=1; no-change updates=1; duration=260ms wait=70ms change-to-ready=150ms overlaps=4");
		expect(result).toContain("V: update=0");
		expect(result).toContain("duration=10ms");
	});

	test("tail reads are bounded by bytes and lines and disclose clipping", () => {
		const { obs } = fixture();
		obs.record(event);
		const line = readFileSync(obs.historyPath, "utf8");
		writeFileSync(obs.historyPath, line.repeat(2001));
		expect(obs.historySummary()).toContain("clipped");
		expect(obs.historySummary()).toContain("CG: update=2000");
		writeFileSync(obs.historyPath, "x".repeat(2 * 1024 * 1024 + 100) + "\n" + line);
		expect(obs.historySummary()).toContain("clipped");
		expect(obs.historySummary()).toContain("CG: update=1");
	});

	test("logging failures never throw and details discloses unavailable history", () => {
		const { root, cwd } = fixture();
		const blocked = join(root, "not-a-directory");
		writeFileSync(blocked, "blocked");
		const obs = new IndexObservability(cwd, { stateHome: blocked, now: () => NOW });
		expect(() => obs.record(event)).not.toThrow();
		obs.update("vera", { state: "ready" });
		expect(obs.footer()).toBe("idx CG? V✓ GF?");
		expect(obs.details()).toContain("History: unavailable");
		expect(obs.historySummary()).toBe("History unavailable");
	});

	test("concurrent processes append complete records to the same private worktree journal", async () => {
		const { cwd, stateHome, obs } = fixture();
		const modulePath = join(import.meta.dir, "../pi/config/extensions/code-intel/observability.ts");
		const children = ["writer-a", "writer-b"].map(sessionId => Bun.spawn([process.execPath, "-e", `
			import { IndexObservability } from ${JSON.stringify(modulePath)};
			const obs = new IndexObservability(${JSON.stringify(cwd)}, {stateHome: ${JSON.stringify(stateHome)}, sessionId: ${JSON.stringify(sessionId)}});
			for (let i = 0; i < 100; i++) obs.record(${JSON.stringify(event)});
		`], { stdout: "pipe", stderr: "pipe" }));
		expect(await Promise.all(children.map(child => child.exited))).toEqual([0, 0]);
		const records = readFileSync(obs.historyPath, "utf8").trim().split("\n").map(line => {
			try { return JSON.parse(line); }
			catch (cause) { throw new Error("Concurrent journal append produced a partial record", { cause }); }
		});
		expect(records).toHaveLength(200);
		expect(new Set(records.map(record => record.pid)).size).toBe(2);
		expect(records.filter(record => record.session === "writer-a")).toHaveLength(100);
		expect(records.filter(record => record.session === "writer-b")).toHaveLength(100);
	});
});
