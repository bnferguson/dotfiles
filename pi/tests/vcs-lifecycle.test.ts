import assert from "node:assert/strict";
import { test } from "node:test";
import vcsStatus from "../config/extensions/vcs-status/index.ts";
import type { Status } from "../config/extensions/vcs-status/status.ts";

function harness(getStatus: (cwd: string) => Promise<Status | undefined>, mode = "tui") {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void> | void>();
  const updates: (string | undefined)[] = [];
  const pi = { on: (event: string, handler: (event: unknown, ctx: unknown) => Promise<void> | void) => handlers.set(event, handler) };
  const ctx = {
    mode, cwd: "/repo",
    ui: { setStatus: (_key: string, value?: string) => updates.push(value), theme: { fg: (_color: string, text: string) => text } },
  };
  vcsStatus(pi as unknown as Parameters<typeof vcsStatus>[0], getStatus);
  return { updates, emit: (name: string) => handlers.get(name)?.({}, ctx) };
}

test("headless sessions do not start background reads", async () => {
  let reads = 0;
  const h = harness(async () => { reads++; return undefined; }, "json");
  await h.emit("session_start");
  await h.emit("agent_end");
  await h.emit("session_shutdown");
  assert.equal(reads, 0);
});

test("shutdown discards an in-flight result", async () => {
  let resolve!: (value: Status) => void;
  const h = harness(() => new Promise(done => { resolve = done; }));
  const start = h.emit("session_start");
  await h.emit("session_shutdown");
  resolve({ text: "stale", dirty: false });
  await start;
  assert.ok(!h.updates.some(value => value?.includes("stale")));
});

test("refresh can switch from but back to regular git without sticky status", async () => {
  let status: Status = { text: "feature *2", dirty: true };
  const h = harness(async () => status);
  try {
    await h.emit("session_start");
    assert.equal(h.updates.at(-1), "\uF126 feature *2");
    status = { text: "main", dirty: false };
    await h.emit("agent_end");
    assert.equal(h.updates.at(-1), "\uF126 main");
  } finally {
    await h.emit("session_shutdown");
  }
});
