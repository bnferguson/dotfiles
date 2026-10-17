import assert from "node:assert/strict";
import { test } from "node:test";
import { detectTicket, formatWorkLinks, createWorkLinksReader } from "../work-links.ts";

test("branch ticket takes priority over incidental PR references", () => {
  assert.deepEqual(detectTicket("ben/sof-123-fix", "Related SOF-456", ""), {
    id: "SOF-123", url: "https://linear.app/issue/SOF-123",
  });
});

test("preserves the matching canonical Linear URL", () => {
  assert.deepEqual(detectTicket("sof-123-fix", "", "Fixes https://linear.app/soffi/issue/SOF-123/fix-it"), {
    id: "SOF-123", url: "https://linear.app/soffi/issue/SOF-123/fix-it",
  });
});

test("falls back to title, then an unambiguous body reference", () => {
  assert.equal(detectTicket("fix", "Fix SOF-12", "SOF-13")?.id, "SOF-12");
  assert.equal(detectTicket("fix", "Fix", "Closes SOF-13")?.id, "SOF-13");
  assert.equal(detectTicket("fix", "Fix", "SOF-13 and SOF-14"), undefined);
  assert.equal(detectTicket("main", "Fix", ""), undefined);
  assert.equal(detectTicket("soffi-2.0", "Soffi 2.0", ""), undefined);
});

test("links are OSC 8 hyperlinks and absent items stay hidden", () => {
  assert.equal(formatWorkLinks({}), undefined);
  assert.equal(formatWorkLinks({ pr: { number: 42, url: "https://github.com/org/repo/pull/42" }, ticket: { id: "SOF-12", url: "https://linear.app/issue/SOF-12" } }),
    "\x1b]8;;https://github.com/org/repo/pull/42\x07PR #42\x1b]8;;\x07 \x1b]8;;https://linear.app/issue/SOF-12\x07SOF-12\x1b]8;;\x07");
});

test("reader caches GitHub lookups but detects branch changes immediately", async () => {
  let branch = "sof-12-fix";
  let requests = 0;
  const read = createWorkLinksReader(async (command) => {
    if (command === "git") return branch;
    requests++;
    return JSON.stringify({ number: 42, url: "https://github.com/org/repo/pull/42", title: "Fix", body: "", state: "OPEN" });
  });
  assert.equal((await read("/repo"))?.ticket?.id, "SOF-12");
  await read("/repo");
  assert.equal(requests, 1);
  branch = "sof-13-fix";
  assert.equal((await read("/repo"))?.ticket?.id, "SOF-13");
  assert.equal(requests, 2);
});

test("different worktrees never reuse each other's PR, even on the same branch", async () => {
  const read = createWorkLinksReader(async (command, _args, cwd) => command === "git" ? "fix" : JSON.stringify({
    number: cwd === "/worktree-a" ? 1 : 2,
    url: `https://github.com/org/repo/pull/${cwd === "/worktree-a" ? 1 : 2}`,
    state: "OPEN",
  }));
  assert.equal((await read("/worktree-a"))?.pr?.number, 1);
  assert.equal((await read("/worktree-b"))?.pr?.number, 2);
});

test("PR metadata is refreshed after the cache expires", async () => {
  let time = 0, requests = 0;
  const read = createWorkLinksReader(async (command) => {
    if (command === "git") return "main";
    requests++;
    throw new Error("no PR yet");
  }, () => time);
  await read("/repo");
  time = 60_001;
  await read("/repo");
  assert.equal(requests, 2);
});

test("without gh/auth/PR, branch tickets still work", async () => {
  const read = createWorkLinksReader(async (command) => {
    if (command === "git") return "sof-12-fix";
    throw new Error("gh unavailable");
  });
  assert.deepEqual(await read("/repo"), { ticket: { id: "SOF-12", url: "https://linear.app/issue/SOF-12" } });
});

test("non-git directories have no links", async () => {
  const read = createWorkLinksReader(async () => { throw new Error("not a repo"); });
  assert.equal(await read("/tmp"), undefined);
});

test("merged PRs and malformed responses are not shown", async () => {
  for (const response of ["not JSON", JSON.stringify({ number: 42, url: "https://github.com/org/repo/pull/42", state: "MERGED" })]) {
    const read = createWorkLinksReader(async (command) => command === "git" ? "main" : response);
    assert.equal((await read("/repo"))?.pr, undefined);
  }
});
