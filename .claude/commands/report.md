---
description: Generate a weekly report of your work
---

# /report - Weekly Report

Generate a summary of what you accomplished this week.

## Instructions

### 1. Gather the Data

Run `date +%Y-%m-%d` to get today's date.

Read these sources directly:
- **Session logs**: Read all files in `sessions/` from the past 7 days
- **State**: Read `state/current.md` for current priorities and context
- **Goals**: Read `state/goals.md` to connect work to goals
- **Decisions**: Read `state/decisions.md` for decisions made this week
- **Content**: Read `content/log.md` for any content shipped this week

### 2. Compile the Report

Create a report with these sections:

```markdown
# Weekly Report: Week of {DATE}

## Summary
- Top 3-5 accomplishments this week
- Focus on outcomes, not activities

## Shipped
- Specific deliverables completed (features, content, docs, etc.)
- Pull from content/log.md and session logs
- If nothing shipped, omit this section

## Key Activities
- Organized by project or goal area
- Include problems solved, progress made, work in flight

## Decisions Made
- Decisions from state/decisions.md this week
- Include the context/reasoning for each

## Progress on Goals

| Goal | Status | This Week |
|------|--------|-----------|
| {Goal from goals.md} | {On track / Behind / Ahead} | {What happened toward this goal} |

## Open Threads
- Anything unfinished or waiting on others
- Decisions still needed
- Blockers

## Looking Ahead
- Top priorities for the coming week
- Carries forward from open threads
- Any upcoming deadlines or events
```

### 3. Save the Report

Save to `reports/{TODAY}.md` using today's date.

Create the `reports/` directory if it doesn't exist.

### 4. Offer Next Steps

Ask: "Want me to copy this somewhere, adjust the tone, or focus on specific areas?"

Common follow-ups:
- Copy to clipboard for pasting into Slack or email
- Adjust tone (more formal for managers, casual for team)
- Focus on specific projects or goals
