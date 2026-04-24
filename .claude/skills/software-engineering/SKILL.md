---
name: software-engineering
description: |
  Use when MARVIN is asked to build, fix, debug, review, or ship software.
  Routes to gstack development workflow skills. Handles gstack bootstrap
  if not installed. Manages PRD decomposition for large projects.
  Triggers on: build a feature, fix a bug, review code, implement a PRD,
  ship this, debug this, create an app/tool/service/CLI/API.
  Does NOT trigger on: content ideas, event planning, campaigns, meetups,
  or any non-software intent. If ambiguous, ask.
---

# Software Engineering with gstack

MARVIN uses [gstack](https://github.com/garrytan/gstack) as its software engineering
toolkit. gstack provides specialized development workflow skills. MARVIN provides
project management, orchestration, and lifecycle tracking.

**Boundary:** This skill never re-describes gstack's methodology. It routes to the
right gstack skill and handles MARVIN-specific bookkeeping. gstack's own SKILL.md
files take over once invoked.

---

## Step 1: Prerequisite Check

Verify gstack is installed:

```bash
[ -d ~/.claude/skills/gstack ] && echo "GSTACK_INSTALLED" || echo "GSTACK_MISSING"
```

**If GSTACK_MISSING:**

Tell the user: "Setting up your dev toolkit (one-time per machine)..."

```bash
git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack && cd ~/.claude/skills/gstack && ./setup
```

If the clone fails (network error, repo unavailable), tell the user:
"gstack isn't available right now. I can still build software using general-purpose
agents, but without the specialized review/QA/debug methodology. Want to proceed?"

If they say yes, proceed without gstack. Skip all gstack skill references below
and use standard development practices.

---

## Step 2: Route to gstack

Based on user intent, invoke the appropriate gstack skill:

| Intent signal | Action |
|---|---|
| "Build an app/tool/service that..." (new software concept) | Invoke `/office-hours` |
| "Review the plan", "validate before building" | Invoke `/autoplan` |
| "CEO review" / "eng review" / "design review" (specific) | Invoke `/plan-ceo-review`, `/plan-eng-review`, or `/plan-design-review` |
| "Build this feature", "implement this" (focused work) | Write code, then invoke `/review` |
| "Implement this PRD" (large, multi-requirement) | Go to Step 3: PRD Decomposition |
| "Review this code", "check my diff", "pre-merge review" | Invoke `/review` |
| "Fix this bug", "debug this", "why is this broken" | Invoke `/investigate` |
| "Test this", "QA this URL", "check this page" | Invoke `/qa` |
| "Ship it", "push and PR", "create a PR" | Invoke `/ship` |
| "Deploy this", "merge and deploy" | Invoke `/land-and-deploy` |
| "Check production", "monitor the deploy" | Invoke `/canary` |
| "Security audit", "check for vulnerabilities" | Invoke `/cso` |
| "Update the docs", "docs are stale" | Invoke `/document-release` |
| "What have we learned", "show learnings" | Invoke `/learn` |

If the intent doesn't clearly match any row, ask the user what kind of work
this is before routing.

---

## Step 3: PRD Decomposition (Large Projects)

When the request is a full PRD with multiple requirements that span more than
one coherent unit of work:

### 3a: Decompose

Read the PRD and break it into phases (max 7). Each phase should be:
- A coherent unit of work
- Independently testable
- Clearly mapped to PRD requirements

Output the decomposition for user approval:

```
Phase 1: {short name}
- Requirements: {list PRD requirement numbers}
- Files: {likely files to create/modify}
- Dependencies: {other phases this depends on, or "none"}

Phase 2: ...
```

### 3b: Execute Each Phase

For each phase (respecting dependency order):

1. Build the phase (write the code)
2. Invoke `/review` (multi-specialist code review)
3. Invoke `/qa` if the phase has UI or browser-testable endpoints
4. Fix issues surfaced by review/QA
5. Max 3 fix cycles per phase

If a phase fails 3 fix cycles, escalate to the user with:
- What phase is stuck
- What the review/QA found
- Suggested resolution

### 3c: Integration Testing

After all phases pass individually:
- Run the full test suite
- Invoke `/qa` on the integrated system if applicable
- Route integration bugs back to the relevant phase

### 3d: Ship

When integration testing passes:
- Invoke `/ship` to push and create PR
- Report summary: phases completed, bugs found and fixed, notable decisions

---

## Step 4: MARVIN Bookkeeping

After work completes (or at significant milestones):

1. **Update project tracking**: If this project is tracked in `state/projects.md`,
   update its status and next actions.

2. **Session log**: Append a summary to today's session log noting what was built,
   reviewed, or shipped.

3. **Memory**: If this is a tracked project with a memory file, update it with
   any significant architectural decisions or status changes.

4. **Decisions log**: If an architecturally significant decision was made during
   the work, note it in `state/decisions.md`.

---

## Important Rules

- **MARVIN routes. gstack executes.** Never re-implement review checklists,
  QA methodology, or debugging procedures. gstack owns those.
- **Software signals only.** This skill fires on: app, tool, software, codebase,
  repo, API, frontend, backend, service, CLI, build, fix, debug, review, ship.
  Not on: blog post, meetup, campaign, content, event.
- **Ask on ambiguity.** If you're not sure whether the user wants software
  engineering or something else, ask. Don't assume.
- **Graceful without gstack.** If gstack isn't available, MARVIN can still
  build software. It's just less rigorous.
