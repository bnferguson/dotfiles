import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Exercise the installed renderer without starting Pi or its extension lifecycle.
const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(process.env.HOME!, ".pi/agent");
const source = readFileSync(join(agentDir, "npm/node_modules/pi-powerline-footer/index.ts"), "utf8");
const start = source.indexOf("function computeResponsiveLayout(");
const end = source.indexOf("\n// ═", start);
const renderer = stripTypeScriptTypes(source.slice(start, end));

function layout(secondary: string[] | undefined, width: number, overflow = "wrap") {
  const result: { topContent: string; secondaryLines: string[] } = runInNewContext(`${renderer}\ncomputeResponsiveLayout({}, { separator: 'pipe' }, ['path', 'branch', 'PR', 'model', 'cost'], width)`, {
    config: { layout: secondary ? { secondary } : null, secondaryOverflow: overflow },
    width,
    getSeparator: () => ({ left: "|" }),
    visibleWidth: (text: string) => text.length,
    renderSegmentWithWidth: (id: string) => ({ content: id, width: id.length, visible: true }),
    buildContentFromParts: (parts: string[]) => parts.join(" | "),
  });
  return { topContent: result.topContent, secondaryLines: [...result.secondaryLines] };
}

test("installer applies the tracked patch and safely tolerates repeated runs", () => {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const temp = mkdtempSync(join(tmpdir(), "pi-powerline-test-"));
  const packageDir = join(temp, "npm/node_modules/pi-powerline-footer");
  const patchFile = join(root, "config/patches/powerline-pinned-rows.patch");
  const installer = join(root, "apply-powerline-patch.sh");
  try {
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(packageDir, "index.ts"), source);
    execFileSync("patch", ["-R", "-p1", "-d", packageDir], { input: readFileSync(patchFile) });
    const options = { env: { ...process.env, PI_CODING_AGENT_DIR: temp } };
    execFileSync("sh", [installer], options);
    execFileSync("sh", [installer], options);
    assert.equal(readFileSync(join(packageDir, "index.ts"), "utf8"), source);
    writeFileSync(join(packageDir, "index.ts"), "incompatible upstream renderer\n");
    assert.throws(() => execFileSync("sh", [installer], { ...options, stdio: "pipe" }));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("explicit secondary segments remain on row two on wide terminals", () => {
  assert.deepEqual(layout(["model", "cost"], 240), {
    topContent: "path | branch | PR",
    secondaryLines: ["model | cost"],
  });
});

test("unconfigured secondary retains the original responsive layout", () => {
  assert.deepEqual(layout(undefined, 240), {
    topContent: "path | branch | PR | model | cost",
    secondaryLines: [],
  });
});

test("narrow terminals wrap without losing segments", () => {
  const result = layout(["model", "cost"], 14);
  assert.equal([result.topContent, ...result.secondaryLines].join(" | "), "path | branch | PR | model | cost");
  for (const row of [result.topContent, ...result.secondaryLines]) assert.ok(row.length <= 12);
});

test("configured rows and segment order match the requested split", () => {
  const settings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
  assert.deepEqual(settings.powerline.layout.left, ["path", "custom:vcs", "custom:work-links"]);
  assert.deepEqual(settings.powerline.layout.right, []);
  assert.deepEqual(settings.powerline.layout.secondary, ["model", "thinking", "shell_mode", "context_pct", "cache_read", "cost", "custom:indexes", "queue", "extension_statuses"]);
  assert.equal(settings.powerline.secondaryOverflow, "wrap");
});
