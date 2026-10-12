import assert from "node:assert/strict";
import { test } from "node:test";
import { butStatus, gitStatus, readStatus, type Run } from "../config/extensions/vcs-status/status.ts";

const workspace = {
  stacks: [{
    assignedChanges: [{ filePath: "one.ts" }],
    branches: [
      { name: "base", commits: [] },
      { name: "feature", commits: [{ conflicted: false }] },
    ],
  }],
  uncommittedChanges: [{ filePath: "one.ts" }, { filePath: "two.ts" }],
};

test("GitButler displays applied stack branches and deduplicates changed files", () => {
  assert.deepEqual(butStatus(workspace), { text: "base → feature *2", dirty: true, warning: false });
});

test("empty workspace is not mistaken for an unavailable CLI", () => {
  assert.equal(butStatus({ stacks: [], uncommittedChanges: [] }).text, "no branches");
});

test("multiple stacks are bounded and conflicts stay visible", () => {
  const stack = { branches: [{ name: "worker", commits: [{ conflicted: true }] }] };
  const result = butStatus({ stacks: [stack, stack, stack], uncommittedChanges: [] });
  assert.equal(result.text, "worker | worker +1 stacks !conflicts");
  assert.equal(result.warning, true);
});

test("branch labels cannot inject terminal controls", () => {
  assert.equal(gitStatus("hello\n\x1b[31m", "").text, "hello[31m");
});

test("normal git preserves staged, unstaged, and untracked counts", () => {
  assert.deepEqual(gitStatus("main", " M file\nA  staged\n?? new\nMM both"), {
    text: "main +2 *2 ?1", dirty: true,
  });
});

test("ordinary repositories never invoke but", async () => {
  const calls: string[] = [];
  const execute: Run = async (command, args) => {
    calls.push(command);
    if (args[0] === "symbolic-ref") return "main";
    if (args[0] === "status") return " M changed";
    return ".git";
  };
  assert.equal((await readStatus("/repo", execute))?.text, "main *1");
  assert.ok(calls.every(command => command === "git"));
});

test("workspace detection queries GitButler JSON instead of git status", async () => {
  const execute: Run = async (command, args) => {
    if (command === "but") {
      assert.deepEqual(args, ["status", "--json"]);
      return JSON.stringify(workspace);
    }
    assert.notEqual(args[0], "status");
    return args[0] === "symbolic-ref" ? "gitbutler/workspace" : ".git";
  };
  assert.equal((await readStatus("/repo", execute))?.text, "base → feature *2");
});

test("missing but, malformed JSON, and schema changes show unavailable", async () => {
  for (const result of [null, "invalid json", "{}", JSON.stringify({ stacks: [{}], uncommittedChanges: [] })]) {
    const execute: Run = async (command, args) => {
      if (command === "but") {
        if (result === null) throw new Error("ENOENT");
        return result;
      }
      return args[0] === "symbolic-ref" ? "gitbutler/workspace" : ".git";
    };
    assert.deepEqual(await readStatus("/repo", execute), { text: "GitButler unavailable", dirty: false, warning: true });
  }
});

test("non-repositories hide the segment", async () => {
  assert.equal(await readStatus("/tmp", async () => { throw new Error("not a repo"); }), undefined);
});

test("detached HEAD displays its commit", async () => {
  const execute: Run = async (_command, args) => {
    if (args[0] === "symbolic-ref") throw new Error("detached");
    if (args[0] === "status") return "";
    return args.includes("--short") ? "abc1234" : ".git";
  };
  assert.equal((await readStatus("/repo", execute))?.text, "abc1234 (detached)");
});
