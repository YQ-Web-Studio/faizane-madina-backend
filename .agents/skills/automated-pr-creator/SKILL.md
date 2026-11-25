---
name: automated-pr-creator
description: >
  MANDATORY: Must ALWAYS be used whenever any Pull Request is created across all repositories.
  Runs test suite, captures targeted visual evidence via Playwright showcasing the fix or feature,
  populates the Ultra-Lean PR template with real data, presents Gate 3 confirmation, and opens
  the PR via gh pr create. Manual or blank PRs are strictly forbidden.
---

# Automated PR Creator — Enterprise Pull Request Workflow

## Overview
This skill automates the creation of high-signal, bloat-free Pull Requests across all YQ Web Studio repositories. It enforces:
1. **The Mandatory PR Skill Hard-Gate**: Manual, blank, or partially filled PR templates are strictly forbidden.
2. **Zero Bloat / Ultra-Lean Standard**: 100% pre-filled template with real bullets, Jira link, visual proof, and test metrics.
3. **Change-Focused Visual Evidence**: Targeted Playwright screenshots demonstrating the fix or new feature in action (or `N/A` for backend/logic changes).
4. **Gate 3 Human Confirmation**: Previews the complete PR payload to the developer before opening.

---

## The Workflow

Whenever you complete a task or are instructed to create, open, or draft a Pull Request, execute these steps in order:

### Step 1: Verify Branch Hygiene & Resolve Jira Context
1. **Mandatory Branch-Off-Main Rule (NEVER branch off another feature branch by default):**
   - Whenever creating a new branch, ALWAYS start from an up-to-date `origin/main`:
     ```bash
     git fetch origin main && git checkout -b <type>/<TICKET>-<slug> origin/main
     ```
   - NEVER run `git checkout -b <new-branch>` while checked out on another feature branch unless the user explicitly requests a stacked PR.
2. Check current branch and verify it only contains commits for this ticket:
   ```bash
   git branch --show-current
   git fetch origin main && git log origin/main..HEAD --oneline
   ```
   - **Stacked-Branch Guard:** If `git log origin/main..HEAD --oneline` includes commits belonging to another ticket or another developer's unmerged branch, **HALT IMMEDIATELY** and rebase only this branch's commits onto `origin/main` (`git rebase --onto origin/main <parent-branch> <current-branch>`) before proceeding.
3. Extract the Jira ticket key matching `[A-Z]+-[0-9]+` (e.g. `DQP-14`, `MA-3`, `FMMS-1`, `YQWS-2`).
4. If no ticket key is found in the branch name, prompt the user for the ticket key before proceeding.
5. Retrieve the ticket's summary and acceptance criteria via Atlassian MCP (`getJiraIssue`) to ensure the PR description reflects the ticket's business intent.

---

### Step 2: Run Verification Tests
1. Execute the repository's test command (`npm test`).
2. If any test fails:
   - **HALT IMMEDIATELY**.
   - Report the failures. Do not open a PR with failing tests.
3. Record the passing metric (e.g., `12/12 unit tests passing, coverage >= 80%`).

---

### Step 3: Capture Visual Evidence
1. Execute the visual evidence capture runner:
   ```bash
   npm run pr:evidence
   ```
   *(or `node scripts/capture-pr-evidence.mjs`)*
2. The runner dynamically inspects `git diff` for modified UI files:
   - **If UI/Visual files were modified**: Playwright captures targeted screenshots of the affected route/component and saves them into `.github/pr-evidence/`.
   - **If Backend/Logic files only**: Use `| Backend / Logic change | *N/A (No frontend or visual UI files modified)* |`.
3. If new screenshots were generated in `.github/pr-evidence/`, **commit them BEFORE building the PR body**:
   ```bash
   git add .github/pr-evidence/
   git commit -m "chore(evidence): capture visual proof for PR" || true
   ```
4. **Mandatory Image Formatting & Immutable Raw URL Rule (ALWAYS apply automatically):**
   - GitHub PR descriptions do **NOT** resolve relative paths (`![alt](.github/pr-evidence/...)` → broken 404).
   - Branch-based raw URLs break with 404 as soon as the PR branch is deleted on merge.
   - **After Step 3.3 commits the screenshots**, resolve the exact repo slug and post-commit 40-char SHA:
     ```bash
     REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
     SHA=$(git rev-parse HEAD)
     ```
   - Format **every** screenshot cell in the `## Visual Evidence` markdown table using this exact HTML `<img>` tag (never relative markdown links):
     ```html
     <img src="https://raw.githubusercontent.com/<REPO>/<SHA>/.github/pr-evidence/<filename>.png" alt="<Short description>" width="650" />
     ```
   - Verify the `<filename>.png` exists in that commit (`git show --stat HEAD`) and remember that Step 6 pushes the branch **before** `gh pr create` so GitHub renders the image immediately upon PR creation.


---

### Step 4: Assemble 100% Pre-Filled Ultra-Lean PR Body
Construct the markdown body using the Ultra-Lean format:

```markdown
## Summary
- <Crisp bullet 1: What was changed>
- <Crisp bullet 2: Why it was changed / business logic>

## Linked Jira Ticket
- Jira: [<TICKET-KEY>](https://yqwebstudio.atlassian.net/browse/<TICKET-KEY>)

## Visual Evidence
<Output from Step 3 table>

## Test Verification
- [x] Unit / Integration Tests: `passed (<count> passed)`
- [x] E2E / Smoke Tests: `passed`
```

**Anti-Pattern Warning**: Never leave `<!-- comments -->`, empty brackets `- `, or unreplaced placeholder tokens in the submitted body.

---

### Step 5: Gate 3 Human Review & Confirmation
Before running `gh pr create`, present the complete payload to the developer:

```markdown
### Pull Request Payload Ready for Review:
- **Title**: `[<PROJECT>] <type>(<scope>): <description> (<TICKET-KEY>)`
- **Branch**: `<current-branch>` -> `main`
- **Visual Evidence**: <Attached screenshot link or N/A>
- **Test Metric**: <Passed tests summary>

[Display Full PR Body Markdown Here]
```
Ask: *"Would you like me to open this Pull Request?"* and wait for explicit confirmation.

---

### Step 6: Create the Pull Request
Once approved:
1. Push branch to origin:
   ```bash
   git push -u origin <current-branch>
   ```
2. Open the PR via GitHub CLI:
   ```bash
   gh pr create --title "[<PROJECT>] <type>(<scope>): <description> (<TICKET-KEY>)" --body "<BODY_CONTENT>" --base main
   ```
3. Report the live PR URL.

---

### Step 7: Dual Approval Gate Reminder
Remind the user of the studio policy:
- **Gate 1 (PR-Agent Automated Review)**: PR-Agent (powered by Google Gemini 2.0 Flash) analyzes the PR diff against ticket scope with zero hourly rate limits.
- **Gate 2 (Lead Review - Yusuf Qureshi)**: Final review and squash-merge authorization.