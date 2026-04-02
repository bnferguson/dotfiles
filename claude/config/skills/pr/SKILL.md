---
name: pr
description: "Opening a Pull Request with Interview"
---

# Rule: Opening a Pull Request with Interview

## Arguments

- `base` (optional): Target branch for the PR. Defaults to the repository's default branch (via `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`).

## Goal

Create a draft pull request with an interview process that captures both the assistant's analysis and the user's own thinking. This ensures the user understands and has reflected on the changes before they go up for review.

## Hard Rules

- **You MUST follow every step in the Process section below, in order.** Do not skip, compress, or combine steps.
- **The interview is mandatory.** Ask each section's question one at a time, wait for the user's response, then move to the next section. Never batch questions or pre-fill the user's answers. The user may choose to skip sections or end the interview early ("ship it", "looks good") — but that's their call, not yours.
- **Use the correct PR structure.** The description MUST use the section format (Background, Approach, Reviewer notes, Testing plan — or the repo's PR template). Never output a flat, unstructured description.
- **Use the dual-perspective format** for any section where the user contributed. The `<username> says` / `<assistant> says` format is not optional.
- The only exception is step 4's trivial-PR shortcut, and even then you must propose it and get explicit confirmation before skipping.

## Process

1. **Resolve identities and base branch.** Before anything else, determine:
   - The user's GitHub username: run `gh api user --jq .login` (fall back to `git config user.name` if `gh` is unavailable).
   - The assistant's name: use whatever name you identify as (e.g., "Claude"). If unknown, use "Assistant".
   - The base branch: use the `base` argument if provided, otherwise detect via `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`.

   Use these throughout the process.

2. **Detect PR template.** Check for a repository PR template in these locations (in order):
   - `.github/PULL_REQUEST_TEMPLATE.md`
   - `.github/pull_request_template.md`
   - `docs/pull_request_template.md`
   - `PULL_REQUEST_TEMPLATE.md`

   If a template exists, use its sections as the structure for both drafting and the interview. Map each template section to the closest interview question (see defaults below) and interview on those sections instead. If no template is found, fall back to the default sections: Background, Approach, Reviewer notes, Testing plan.

3. **Research the changes.** Look at the full commit history on the current branch vs the base branch (`git log`, `git diff`). Also search git history and related PRs to build context. For bug fixes, dig into the root cause: use `git log -S`, `git blame`, and PR archaeology to trace how the bug was introduced and why the code ended up this way. The background for a bug fix should tell the story of how we got here, not just describe the symptom.

4. **Gauge the scope.** Look at what changed. If the PR is trivial (typo fix, version bump, single-line config change, etc.), propose skipping the interview: "This looks straightforward — here's what I'd put up. Want to go through the full interview, or is this good to go?" Let the user decide. For anything non-trivial, proceed with the interview.

5. **Draft a PR title and all sections.** The title should be short (under 72 chars), imperative mood, and scoped to what changed (e.g., "Fix race condition in worker pool shutdown", "Add duti for default editor file associations"). Prepare drafts for each section from the template (or the defaults).

6. **Interview section by section.** For each section, present your draft and then ask the user for their take. Go through them one at a time. Default interview prompts (adapt to match template section names):

   - **Background / Context / Description:** "Here's my read on the background. What's your take? What motivated this, and what context am I missing?"
   - **Approach / Changes:** "Here's how I'd describe the approach. Anything you'd add or frame differently?"
   - **Reviewer notes:** "Here's what I think is worth calling out for reviewers. Anything you want to highlight or get specific feedback on?"
   - **Testing plan / How to test:** "Here's what I have for testing. How did you test it, or how should a reviewer?"

   For template sections that don't map to a default prompt, ask an open-ended question: "Here's what I have for [section]. What would you add or change?"

   The user can skip any section ("skip", "looks good", empty response) or skip the rest of the interview entirely ("ship it", "looks good, let's go"). If skipped, use your draft as-is without the split format.

7. **Assemble the PR description.** Use the template structure if one was found. For sections where the user contributed, use the dual-perspective format:

```
## [Section Name]

### <github_username> says
[The user's words, lightly cleaned up but preserving their voice]

### <assistant_name> says
[Your analysis]
```

For sections where the user skipped, use the normal format:

```
## [Section Name]
[Your draft, no sub-headings needed]
```

8. **Review together.** Show the user the full assembled PR title and description before creating it. Make adjustments based on their feedback.

9. **Create the draft PR.** Open as a draft. Use `gh pr create --draft --base <base_branch>`.

## Notes

- PRs should be small and focused on a single concern. Avoid bundling unrelated changes. If you notice the code needs refactoring (code smells, emerging duplication), flag it and ask the user rather than folding it into the current PR.
- The user's words should be kept in their voice. Don't rewrite them into formal prose. Light cleanup (typos, formatting) is fine.
- If the user's take and your take overlap significantly, that's fine — it shows alignment. Don't try to artificially differentiate them.
- The interview step is the important part. Don't skip it or pre-fill the user's sections. But respect the user's time — if they want to skip sections or the whole interview, let them.
- Keep the interview conversational. Ask follow-up questions if something is unclear or you think there's more to draw out. This is a dialogue, not a form.
- Don't ask all sections at once. Go one at a time so the conversation stays focused.
