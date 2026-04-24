---
description: End MARVIN session - save context, update logs and state
---

# /end - End MARVIN Session

Wrap up the current session and save all context for continuity.

**The goal:** A fresh session tomorrow should read ONLY `state/current.md` and know exactly where things stand. Every `/end` must leave that file accurate and complete.

## Instructions

### 1. Summarize This Session
Review the conversation and extract:
- **Topics discussed** - What did we work on?
- **Decisions made** - What was decided and why?
- **Content shipped** - Any content published, drafted, or completed?
- **Open threads** - What's unfinished or needs follow-up?
- **Action items** - What needs to happen next?

### 2. Update Session Log
Get today's date with `date +%Y-%m-%d`.

Append to `sessions/{TODAY}.md` (create if it doesn't exist):
```markdown
## Session End: {TIME}

### Topics
- {topic 1}
- {topic 2}

### Decisions
- {decision and reasoning}

### Content Shipped
- {content item, or "None"}

### Open Threads
- {thread 1}

### Next Actions
- {action 1}
```

If creating a new file, add header: `# Session Log: {TODAY}`

### 3. Log Decisions
If any decisions were made during this session, append each to `state/decisions.md`:
```markdown
### {TODAY} - {Decision Title}
**Decision:** {What was decided}
**Context:** {Why this decision was made}
**Status:** Active
```

Create the file with header `# Decision Log` if it doesn't exist.

### 4. Log Content Shipped
If any content was shipped (published, posted, completed drafts), append to `content/log.md`:
```markdown
| {TODAY} | {Type} | {Title/Description} | {Where published/saved} |
```

Create the file with this header if it doesn't exist:
```markdown
# Content Log

| Date | Type | Title | Destination |
|------|------|-------|-------------|
```

### 5. Update State (MANDATORY)
This is the most important step. Check the "Last updated" date in `state/current.md`:

**If 3+ days stale (or no timestamp):** Do a full rewrite.
- Re-read the last 3 days of session logs
- Rebuild priorities, open threads, and project statuses from scratch
- Ensure nothing is carried forward that's already resolved

**If recent (updated within 3 days):** Do an incremental update.
- Mark completed items as done or remove them
- Add new priorities and open threads
- Update project statuses
- Update the "Recent Context" section with the last 5 session entries
- Shift priorities based on what emerged this session

**Always:**
- Update the "Last updated: {TODAY}" line
- Ensure open threads reflect reality (remove resolved, add new)
- Ensure priorities are ordered by actual urgency

### 6. Confirm
Show a brief summary:
- What was logged
- Key items for next session
- State update confirmation (incremental or full refresh)

Keep it concise.
