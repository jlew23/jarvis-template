---
description: Quick checkpoint without ending session
---

# /update - Quick Context Checkpoint

Lightweight save without ending the session. Use frequently to preserve context.

## Instructions

### 1. Identify What Changed
Quickly scan the recent conversation (since last checkpoint or session start) for:
- Topics worked on
- Decisions made
- Files created or modified
- Any state changes needed

Keep it brief. No full summary needed.

### 2. Append to Session Log
Get today's date: `date +%Y-%m-%d`

Append to `sessions/{TODAY}.md`:
```markdown
## Update: {TIME}
- {what was worked on, 1-3 bullets}
```

If file doesn't exist, create with header: `# Session Log: {TODAY}`

### 3. Log Decisions (if any)
If decisions were made since the last checkpoint, append each to `state/decisions.md`:
```markdown
### {TODAY} - {Decision Title}
**Decision:** {What was decided}
**Context:** {Why}
**Status:** Active
```

Create the file with header `# Decision Log` if it doesn't exist.

### 4. Targeted State Update
Read `state/current.md` and scan for items related to the current work:
- Mark completed items as done or remove them
- Add new open threads discovered during work
- Shift priorities if something became more or less urgent
- Update "Last updated: {TODAY}" if the file is touched

**Only update what's relevant to the current work.** Don't rewrite the whole file.

### 5. Staleness Check
Check the "Last updated" date in `state/current.md`:
- If **3+ days old**: flag it and ask: "State is {N} days stale. Want me to do a full refresh now or at /end?"
- If recent: proceed without comment

### 6. Confirm (minimal)
One line: **"Checkpointed: {brief description}"**

No summary. No "next actions" list. Just confirm the save.
