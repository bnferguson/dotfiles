---
name: pr
description: "Opening a Pull Request with Interview"
---

# Rule: Opening a Pull Request with Interview

## Goal

Create a draft pull request with an interview process that captures both Claude's analysis and Brandon's own thinking. This ensures Brandon understands and has reflected on the changes before they go up for review.

## Process

1. **Research the changes.** Look at the full commit history on the current branch vs the base branch (`git log`, `git diff`). Also search git history and related PRs to build context per CLAUDE.md instructions.

2. **Draft all sections.** Prepare your drafts for each PR section: Background, Solution, Reviewer notes, Testing plan.

3. **Interview section by section.** For each section, present your "Claude says" draft and then ask Brandon for his take. Go through them one at a time:

   - **Background:** "Here's my read on the background. What's your take? What motivated this, and what context am I missing?"
   - **Solution:** "Here's how I'd describe the solution. Anything you'd add or frame differently?"
   - **Reviewer notes:** "Here's what I think is worth calling out for reviewers. Anything you want to highlight or get specific feedback on?"
   - **Testing plan:** "Here's what I have for testing. How did you test it, or how should a reviewer?"

   If Brandon responds with his thoughts, format that section with both perspectives (see format below). If he says to skip, move on, or gives an empty response, use only the Claude draft for that section without the split format.

4. **Assemble the PR description.** For sections where Brandon contributed, use:

```
## [Section Name]

### bnferguson says
[Brandon's words, lightly cleaned up but preserving his voice]

### Claude says
[Your analysis]
```

For sections where Brandon skipped, use the normal format:

```
## [Section Name]
[Claude's draft, no sub-headings needed]
```

5. **Review together.** Show Brandon the full assembled PR description before creating it. Make adjustments based on his feedback.

6. **Create the draft PR.** Open as a draft per CLAUDE.md preferences. Use `gh pr create --draft`.

## Notes

- Brandon's words should be kept in his voice. Don't rewrite them into formal prose. Light cleanup (typos, formatting) is fine.
- If Brandon's take and Claude's take overlap significantly, that's fine—it shows alignment. Don't try to artificially differentiate them.
- The interview step is the important part. Don't skip it or pre-fill Brandon's sections.
- Keep the interview conversational. Ask follow-up questions if something is unclear or you think there's more to draw out. This is a dialogue, not a form.
- Don't ask all sections at once. Go one at a time so the conversation stays focused.
