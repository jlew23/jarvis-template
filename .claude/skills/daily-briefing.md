---
name: daily-briefing
description: Generate structured daily briefing with priorities, calendar, goals, and alerts. Used by /start or when user asks "what's on today"
---

# Daily Briefing

Generate a structured daily briefing covering priorities, calendar, goal progress, and proactive alerts.

## When to Use

Claude Code should invoke this skill when:
- The `/start` command runs (as part of session start)
- User asks "what's on today", "daily briefing", or "morning check-in"
- User asks "what did I miss?" or "catch me up"
- Session starts after a gap of 2+ days

## When NOT to Use

- Mid-session check-ins (use the status skill instead)
- When user just wants calendar details (answer directly)
- When user is already deep in a task and doesn't need a context switch

## How It Works

### Step 1: Session Awareness

Check if today's session log exists in `sessions/`:
- **Resuming**: If today's log exists, acknowledge prior session context and skip already-covered items
- **Fresh start**: If no log exists, run a full briefing

Read the last 3 days of session logs (from `sessions/`) for continuity. Surface any unresolved threads or pending follow-ups from prior sessions.

### Step 2: Staleness Detection

Check `state/current.md` modification date:
- **Fresh** (updated within 1 day): Use as-is
- **Aging** (2-3 days old): Note it, but proceed normally
- **Stale** (>3 days old): Flag prominently. Warn the user that priorities may be outdated and suggest running `/update` after the briefing.

```bash
# Check file age
find state/current.md -mtime +3
```

### Step 3: Context Gathering

Read these sources:
1. `state/current.md` - Active priorities, open threads, blockers
2. `state/goals.md` - Monthly and annual goals with targets
3. `state/decisions.md` - Recent decisions for context (if it exists)
4. Calendar (if integration is available) - Today and tomorrow's events

### Step 4: Build Structured Briefing

Assemble the briefing in this exact format:

```
## {Day}, {Date}

### PRIORITIES
- {Top 1-3 priorities from current.md}
- {Any overdue items flagged}

### CALENDAR
- {Today's events with times}
- {Tomorrow preview: notable items only}

### GOALS
- {Progress against monthly targets}
- {Days remaining in month}
- {Pacing alerts if behind}

### ALERTS
- {Stale state warning if applicable}
- {Unresolved threads from prior sessions}
- {Upcoming deadlines within 3 days}
- {Any follow-ups waiting on the user}
```

### Step 5: Proactive Suggestions

Based on patterns, add suggestions at the end:
- "You haven't made progress on {goal} this week"
- "Deadline for {item} is in {N} days"
- "{Thread} has been open for {N} days with no update"
- "Monthly review is coming up, want to schedule?"

## Output Format

Keep the briefing concise. Use the PRIORITIES / CALENDAR / GOALS / ALERTS structure above. Skip any section that has no content (e.g., skip CALENDAR if no integration is configured).

Offer to expand any section on request.

## Notes

- This skill supports the `/start` command but can also run standalone
- Keep the briefing concise. Details on request.
- If `state/decisions.md` exists, reference recent decisions for additional context
- If state files contain only placeholders, suggest the user run onboarding first
- Calendar data requires a configured integration (MCP or CLI). Skip gracefully if unavailable.
