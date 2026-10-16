---
name: pr-fixup
description: Review the current PR, then fix warranted review feedback, with each phase in a fresh subagent.
disable-model-invocation: true
---

# PR Fixup

Run `pr-review`, then `pr-feedback`, in two separate fresh subagents. Keep the parent as coordinator; delegate the actual skill execution. Treat invocation as permission to fix, commit, and normally push warranted changes to the current PR, subject to repository rules.

## 1. Pin the target

- Resolve the repository root and current branch. Read applicable repository instructions and inspect working-tree status.
- Resolve the current branch's PR with `gh pr view --json number,url,state,headRefName,headRefOid,baseRefName,isCrossRepository`. Require an open PR and record its repository, number, head SHA, head branch, and base branch.
- Locate the installed `pr-review` and `pr-feedback` skill files, preferring repository-local skills over global skills. Record their absolute paths; keep scripts and references relative to each skill's own directory.
- Stop with an actionable explanation if either skill or subagent support is unavailable. Stop for local uncommitted changes, a checkout that differs from the PR head, or an inaccessible fork head. Preserve the user's checkout.
- Detect promotion snapshots using `pr-feedback`'s promotion rules. For a promotion PR, stop and explain its source-branch fix workflow rather than modifying the frozen snapshot or silently opening another PR.

Complete this step only when both skill paths and a single writable PR target are known.

## 2. Review in a fresh subagent

Start a new general-purpose subagent, with conversation inheritance disabled where supported. Pass only the target metadata, repository path, skill path, and this brief:

> Read the repository instructions and the complete `pr-review` skill at `<review-skill-path>`, including its required references. Execute it for `<repo>#<number>` with `<number> --no-fix`. Review the pinned head `<sha>` against the PR's actual base `<base>` in `<repo-path>`. This phase reviews and posts findings; leave code fixes, commits, and pushes to the next phase. Follow the skill's verification and publication rules, including fresh nested reviewers where required. Return the reviewed SHA, summary URL, finding/thread IDs, and any blockers or incomplete review dimensions. Keep the return concise; leave detailed evidence on the PR.

Wait for this agent to finish before starting the feedback agent. Use native delegation (`Agent`, `Task`, or equivalent); do not run either skill inline or reuse/resume this agent for phase 3. On an incomplete or failed review, report the blocker and stop rather than claiming a full review.

Re-fetch the PR head. If it moved since the review, stop and report that a fresh review is needed.

## 3. Fix feedback in a second fresh subagent

Start a separate new general-purpose subagent without inherited conversation. Pass the same pinned target, the feedback skill path, and the review summary URL, not the review agent's conversation or reasoning:

> Read the repository instructions and the complete `pr-feedback` skill at `<feedback-skill-path>`, including references needed for its scripts. Execute it for `<repo>#<number>` at `<sha>` in `<repo-path>`. The user requested fixes: triage and fix warranted actionable findings even without an `@soffi` mention. Fetch feedback afresh from GitHub, including unresolved inline threads, review bodies, and general comments; the preceding review is at `<summary-url>`. Re-check findings against the code, avoid duplicate or already-addressed fixes, and leave incorrect, ambiguous, or out-of-scope requests for discussion with reasons.
>
> Keep fixes on this PR's head branch, using an isolated checkout if required by repository rules. Make focused test-first changes where testable, inspect every nested fixer's diff, run the relevant checks and hooks, then commit and push normally. Stop if the remote head changes unexpectedly or push is rejected; preserve unpublished work and report its location. Never force-push, approve, merge, or open a replacement/stacked PR. Reply with actual model attribution and fix evidence; resolve only genuinely addressed threads after successful delivery. Return the pushed SHA, commits, check commands/results, fixed comment IDs, remaining IDs/reasons, and any blockers or unpublished work.

Wait for completion. Surface any decision that needs human input instead of making it on the user's behalf.

## 4. Verify and summarize

Inspect the delivered diff and re-fetch PR/thread state before reporting success. Compare the remote head with the feedback agent's reported SHA; investigate any discrepancy. Distinguish passing checks from checks not run, pending CI, and blocked work.

Report the PR URL, fixes/commits, checks, and remaining feedback or blockers. State that fix commits still need a fresh review under the repository's merge policy; this sequence is not approval or proof that the PR is merge-ready. Run one review-then-feedback sequence per invocation, not an unbounded fix loop.
