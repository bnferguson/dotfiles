import assert from "node:assert/strict";
import { test } from "node:test";
import { gitStatus, readStatus, type Run } from "../config/extensions/vcs-status/status.ts";

test("branch labels cannot inject terminal controls", () => {
  assert.equal(gitStatus("hello\n\x1b[31m", "").text, "hello[31m");
});

test("normal git preserves staged, unstaged, and untracked counts", () => {
  assert.deepEqual(gitStatus("main", " M file\nA  staged\n?? new\nMM both"), {
    text: "main +2 *2 ?1", dirty: true,
  });
});

test("repositories only invoke git", async () => {
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

test("branch names with slashes use normal git status", async () => {
  const execute: Run = async (command, args) => {
    assert.equal(command, "git");
    if (args[0] === "symbolic-ref") return "feature/workspace";
    if (args[0] === "status") return " M changed";
    return ".git";
  };
  assert.equal((await readStatus("/repo", execute))?.text, "feature/workspace *1");
});

test("failed git status is visible", async () => {
  const execute: Run = async (_command, args) => {
    if (args[0] === "status") throw new Error("unavailable");
    return args[0] === "symbolic-ref" ? "main" : ".git";
  };
  assert.deepEqual(await readStatus("/repo", execute), {
    text: "main (status unavailable)", dirty: false, warning: true,
  });
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
