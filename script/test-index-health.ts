// Run with: bun test ./script/test-index-health.ts
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readIndexHealth, workspaceSnapshot, type Execute } from "../pi/config/extensions/code-intel/health.ts";

const cwd = mkdtempSync(join(tmpdir(), "index-health-"));
afterAll(() => rmSync(cwd, { recursive: true, force: true }));
const result = (stdout: string, code = 0, stderr = "") => ({ stdout, code, stderr });
const json = (value: unknown): Execute => async () => result(JSON.stringify(value));

test("freshness hashes actual mtimes even when Git's dirty-status text stays identical", async () => {
  const path = join(cwd, "name with spaces.ts");
  writeFileSync(path, "one"); utimesSync(path, 10, 10);
  const execute: Execute = async (_bin, args) => result(args.includes("rev-parse") ? "head-a" : " M name with spaces.ts\0");
  const before = await workspaceSnapshot(cwd, execute);
  writeFileSync(path, "two"); utimesSync(path, 20, 20);
  const after = await workspaceSnapshot(cwd, execute);
  expect(before.dirty).toBe(true);
  expect(after.fingerprint).not.toBe(before.fingerprint);
  expect(JSON.stringify(after)).not.toContain("name with spaces");
  expect(JSON.stringify(after)).not.toContain("two");
});

test("a clean HEAD change invalidates freshness, and failed Git probes are not proof of clean", async () => {
  let head = "head-a";
  const execute: Execute = async (_bin, args) => result(args.includes("rev-parse") ? head : "");
  const before = await workspaceSnapshot(cwd, execute);
  head = "head-b";
  const after = await workspaceSnapshot(cwd, execute);
  expect(after.dirty).toBe(false);
  expect(after.fingerprint).not.toBe(before.fingerprint);
  await expect(workspaceSnapshot(cwd, async () => result("", 1))).rejects.toThrow("freshness unavailable");
});

test("Vera stats are a read-only unchecked state, not proof of vector compatibility", async () => {
  const calls: unknown[] = [];
  const health = await readIndexHealth("vera", cwd, async (bin, args, options) => {
    calls.push({ bin, args, options });
    return result(JSON.stringify({ file_count: 8 }));
  });
  expect(health.state).toBe("unchecked");
  expect(calls).toEqual([{ bin: "vera", args: ["--json", "stats"], options: { cwd, timeout: 2000 } }]);
  expect((await readIndexHealth("vera", cwd, json({ file_count: "eight" }))).state).toBe("unavailable");
});

test("Codegraph requires a completed workspace build and distinguishes extractor/data staleness", async () => {
  expect((await readIndexHealth("codegraph", cwd, json({ initialized: true }))).state).toBe("unavailable");
  const status = { initialized: true, lastIndexed: "2026-01-01T00:00:00Z" };
  expect((await readIndexHealth("codegraph", cwd, json(status))).state).toBe("ready");
  expect((await readIndexHealth("codegraph", cwd, json({ ...status, worktreeMismatch: true }))).state).toBe("unavailable");
  expect((await readIndexHealth("codegraph", cwd, json({ ...status, index: { reindexRecommended: true } }))).reason).toContain("Extractor upgrade");
  expect((await readIndexHealth("codegraph", cwd, json({ ...status, pendingChanges: { modified: 1 } }))).state).toBe("stale");
});

test("lock contention, incompatible formats and ordinary failures have safe operational reasons", async () => {
  const check = (stderr: string) => readIndexHealth("vera", cwd, async () => result("", 1, stderr));
  expect((await check("database is locked; SECRET-QUERY")).state).toBe("updating");
  const incompatible = await check("Index format version mismatch (expected 2, found None); SECRET-SOURCE");
  expect(incompatible.state).toBe("repair");
  expect(incompatible.reason).toContain("/code-intel-repair vera");
  expect(JSON.stringify(incompatible)).not.toContain("SECRET");
  expect((await check("unsupported option; SECRET")).state).toBe("unavailable");
});

test("Graphify must actually load a nonempty graph; node/source text is not retained", async () => {
  mkdirSync(join(cwd, "graphify-out"));
  writeFileSync(join(cwd, "graphify-out", "graph.json"), "{}");
  const calls: string[][] = [];
  const health = await readIndexHealth("graphify", cwd, async (_bin, args) => {
    calls.push(args);
    return result(JSON.stringify([{ id: "source", label: "SECRET-SOURCE" }]));
  });
  expect(health.state).toBe("ready");
  expect(JSON.stringify(health)).not.toContain("SECRET");
  expect(calls[0]).toEqual(["god-nodes", "--top", "1", "--json", "--graph", join(cwd, "graphify-out", "graph.json")]);
  expect((await readIndexHealth("graphify", cwd, json([]))).state).toBe("unavailable");
  expect((await readIndexHealth("graphify", cwd, async () => result("invalid JSON"))).state).toBe("unavailable");
});

test("Graphify compares its build commit to HEAD, including at the first status check", async () => {
  const path = join(cwd, "graphify-out", "graph.json");
  const built = "a".repeat(40);
  writeFileSync(path, JSON.stringify({ built_at_commit: built }));
  const execute = json([{ id: "node" }]);
  expect((await readIndexHealth("graphify", cwd, execute, built)).state).toBe("ready");
  const stale = await readIndexHealth("graphify", cwd, execute, "b".repeat(40));
  expect(stale.state).toBe("stale");
  expect(stale.reason).toContain("/code-intel-sync");
  writeFileSync(path, "{}");
  utimesSync(path, 30, 30);
  expect((await readIndexHealth("graphify", cwd, execute, built)).state).toBe("unchecked");
});
