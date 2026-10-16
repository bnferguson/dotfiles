import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import lsp from "../config/extensions/lsp/index.ts";
import { LspTransport } from "../config/extensions/lsp/transport.ts";

type Tool = Parameters<Parameters<typeof lsp>[0]["registerTool"]>[0];

async function fixture(mode: string, run: (h: {
  dir: string;
  call: (signal?: AbortSignal) => ReturnType<Tool["execute"]>;
  shutdown: () => Promise<void>;
  events: () => string;
}) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "pi-lsp-test-"));
  const oldPath = process.env.PATH;
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "Gemfile"), "");
  writeFileSync(join(dir, "sample.rb"), "class Sample; end\n");
  writeFileSync(join(dir, "mode"), mode);
  writeFileSync(join(dir, "bin", "ruby-lsp"), `#!${process.execPath}\n${readFileSync(new URL("./fixtures/lsp-server.mjs", import.meta.url), "utf8")}`, { mode: 0o755 });
  process.env.PATH = `${join(dir, "bin")}:${oldPath}`;
  const tools = new Map<string, Tool>();
  const handlers = new Map<string, () => Promise<void>>();
  lsp({
    registerTool: (tool: Tool) => tools.set(tool.name, tool),
    registerCommand: () => {},
    on: (name: string, handler: () => Promise<void>) => handlers.set(name, handler),
  } as unknown as Parameters<typeof lsp>[0]);
  const tool = tools.get("lsp_references")!;
  const shutdown = async () => { await handlers.get("session_shutdown")?.(); };
  try {
    await run({
      dir,
      call: (signal) => tool.execute("test", { path: "sample.rb", symbol: "Sample" }, signal, undefined, { cwd: dir } as Parameters<Tool["execute"]>[4]),
      shutdown,
      events: () => readFileSync(join(dir, "events"), "utf8"),
    });
  } finally {
    process.env.PATH = oldPath;
    await shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("references reports startup stderr and retries with a fresh server", { timeout: 5000 }, async () => {
  await fixture("crash", async ({ dir, call, events }) => {
    await assert.rejects(call(), /Bundler fixture failed/);
    writeFileSync(join(dir, "mode"), "normal");
    const result = await call();
    assert.match(JSON.stringify(result.content), /1 reference\(s\)/);
    assert.equal(events().match(/^start /gm)?.length, 2);
  });
});

for (const mode of ["hang-init", "hang-symbol", "hang-references"]) {
  test(`references can be cancelled during ${mode}`, { timeout: 5000 }, async () => {
    await fixture(mode, async ({ call, shutdown, events }) => {
      await assert.rejects(call(AbortSignal.timeout(200)), /timeout|aborted/i);
      await shutdown();
      if (mode !== "hang-init") assert.match(events(), /\$\/cancelRequest/);
    });
  });
}

test("server death rejects an in-flight reference lookup", { timeout: 3000 }, async () => {
  await fixture("exit-references", async ({ call }) => {
    await assert.rejects(call(), /Server crashed during references/);
  });
});

test("concurrent reference lookups share initialization and return results", { timeout: 5000 }, async () => {
  await fixture("normal", async ({ call, events }) => {
    const results = await Promise.all([call(), call()]);
    for (const result of results) assert.match(JSON.stringify(result.content), /1 reference\(s\)/);
    assert.equal(events().match(/^start /gm)?.length, 1);
    assert.equal(events().match(/^initialize$/gm)?.length, 1);
  });
});

test("cancelling one initialization waiter does not cancel its peer", { timeout: 5000 }, async () => {
  await fixture("slow-init", async ({ call, events }) => {
    const cancelled = assert.rejects(call(AbortSignal.timeout(100)), /timeout|aborted/i);
    const peer = call();
    await cancelled;
    assert.match(JSON.stringify((await peer).content), /1 reference\(s\)/);
    assert.equal(events().match(/^start /gm)?.length, 1);
  });
});

test("cancellation interrupts the stabilization sleep", { timeout: 3000 }, async () => {
  await fixture("normal", async ({ call }) => {
    await assert.rejects(call(AbortSignal.timeout(200)), /timeout|aborted/i);
  });
});

test("shutdown is bounded even when the server ignores it", { timeout: 4000 }, async () => {
  await fixture("hang-shutdown", async ({ call, shutdown }) => {
    await call(AbortSignal.timeout(200)).catch(() => {});
    await shutdown();
  });
});

for (const method of ["initialize", "textDocument/references"]) {
  test(`an unresponsive ${method} times out and terminates its server`, { timeout: 3000 }, async () => {
    await fixture(method === "initialize" ? "hang-init" : "hang-references", async ({ dir }) => {
      let stopped = false;
      const transport = new LspTransport("fixture", join(dir, "bin", "ruby-lsp"), [], dir, () => { stopped = true; }, 300);
      transport.conn.listen();
      try {
        await assert.rejects(transport.request(method, {}), /timed out after 300ms/);
        assert.equal(stopped, true);
      } finally {
        transport.stop("test cleanup");
      }
    });
  });
}

test("an already-cancelled waiter still observes a shared promise rejection", { timeout: 3000 }, async () => {
  await fixture("normal", async ({ dir }) => {
    const transport = new LspTransport("fixture", join(dir, "bin", "ruby-lsp"), [], dir, () => {});
    transport.conn.listen();
    const controller = new AbortController();
    controller.abort(new Error("cancelled before waiting"));
    try {
      await assert.rejects(transport.wait(Promise.reject(new Error("late failure")), "initialization", controller.signal), /cancelled before waiting/);
    } finally {
      transport.stop("test cleanup");
    }
  });
});
