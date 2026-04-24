---
description: Sync updates from the MARVIN template
---

# /sync - Get Updates

Pull new features and commands from the MARVIN template into your workspace.

## Instructions

### 1. Find the Template

Read `.marvin-source` to get the path to the template directory:
```bash
cat .marvin-source
```

If this file doesn't exist, tell the user:
> "I can't find your template source. This usually means you set up MARVIN manually. Would you like to tell me where your template folder is?"

### 2. Check Version

Compare versions between the user's workspace and the template:

```bash
USER_VERSION=$(cat VERSION 2>/dev/null || echo "0.0.0")
TEMPLATE_VERSION=$(cat {template}/VERSION 2>/dev/null || echo "unknown")
echo "Current: $USER_VERSION"
echo "Template: $TEMPLATE_VERSION"
```

Replace `{template}` with the path from `.marvin-source`.

If versions are the same, tell the user:
> "You're on the latest version ($USER_VERSION). No updates available."

And stop (unless the user explicitly asked to check files anyway).

If versions differ, extract what changed from the template's CHANGELOG.md.
Read `{template}/CHANGELOG.md` and collect all entries between the user's
version and the template's version. Show a summary:

```
You're on {USER_VERSION}. Template is at {TEMPLATE_VERSION}.

What's new:
{bullet points from CHANGELOG entries}

Checking for new files...
```

Then proceed to step 3.

If the user has no VERSION file (pre-versioning install), treat as 0.0.0
and show all CHANGELOG entries.

### 3. Check What's New

Compare the template's files with the user's workspace:

**Files to sync:**
- `.claude/commands/` - Slash commands
- `.claude/agents/` - Subagent definitions
- `.claude/skills/` - Reusable skills
- `docs/patterns/` - Architectural pattern docs

**Files to NEVER sync (user's data):**
- `state/` - User's goals and current state
- `sessions/` - Session logs
- `reports/` - Weekly reports
- `content/` - User's content
- `meetings/` - User's meeting notes
- `personal/` - User's personal files
- `CLAUDE.md` - User's profile (contains personal config)
- `.env` - User's secrets
- `.marvin-team/` - User's team config (if present)

### 4. Identify Changes

For each file in the template's `.claude/commands/` and `.claude/agents/`:
- If it doesn't exist in the workspace: NEW
- If it exists but differs: CONFLICT (user's version wins)
- If it's identical: UNCHANGED

For each skill in the template's `.claude/skills/`:
- Skills may be a single `.md` file or a directory containing `SKILL.md`
- For single-file skills: compare the file directly
- For directory skills: compare by checking if the directory exists. If SKILL.md differs, it's a CONFLICT
- If the skill doesn't exist at all: NEW

For each file in `docs/patterns/`:
- If it doesn't exist in the workspace: NEW
- If it exists but differs: CONFLICT (user's version wins)
- If it's identical: UNCHANGED

### 5. Show What's Available

Display something like:

```
## Updates Available

**New commands:**
- /newcommand - Description

**New skills:**
- new-skill/ - Description

**Conflicts (your version kept):**
- /existingcommand - Template has updates, but keeping yours

No changes to your data (goals, sessions, etc.) - those are always safe.
```

### 6. Apply Updates

Ask: "Would you like me to add the new commands/agents/skills?"

If yes, copy the NEW files only. Never overwrite existing files.

```bash
# Example for a new command
cp {template}/.claude/commands/newcommand.md .claude/commands/
```

After copying files, update the VERSION file to match the template:

```bash
cp {template}/VERSION ./VERSION
```

### 7. Handle Conflicts

If there are conflicts, explain:
> "I found some commands that exist in both places. I kept your versions since you may have customized them. If you want the template version instead, let me know which ones and I'll update them."

### 8. Finish

After syncing:
> "Updated to {TEMPLATE_VERSION}. Type `/help` to see what's available."
