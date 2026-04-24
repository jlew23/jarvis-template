---
name: status
description: Check integration health, CLI tools, and workspace status. Tests MCP integrations, CLI availability, state file health, and directory structure.
---

# Status Check

Check integration health, CLI tool availability, and MARVIN workspace status at a glance.

## When to Use

Claude Code should invoke this skill when:
- User types `/status`
- User asks "what integrations are working?" or "is everything connected?"
- When debugging integration issues
- After setting up a new integration to verify it works
- User asks "is MARVIN healthy?" or "system check"

## When NOT to Use

- For daily briefings (use daily-briefing skill)
- For checking content progress (use content-shipped skill)
- Mid-conversation unless the user asks for a status check

## How It Works

### Step 1: Check CLI Tools

Test for commonly used CLI tools that MARVIN integrates with:

```bash
# Check each tool's availability
command -v gws && echo "gws: installed" || echo "gws: not found"
command -v gh && echo "gh: installed" || echo "gh: not found"
command -v npx && echo "npx: installed" || echo "npx: not found"
```

For installed CLIs, run a lightweight version/auth check:
- **gws** - Check if configured (config dirs exist)
- **gh** - `gh auth status` (is the user logged in?)
- **npx** - Available (just needs to exist)

Classify:
- **Ready** - Installed and authenticated
- **Installed** - Present but not configured/authenticated
- **Not Found** - Not installed

### Step 2: Check MCP Integrations

Run `claude mcp list` to get all configured MCP servers. Map each to known integrations:

| MCP Server Name | Integration | Capabilities |
|----------------|-------------|--------------|
| `atlassian` | Atlassian | Jira, Confluence |
| `google-workspace` | Google Workspace | Gmail, Calendar, Drive |
| `ms365` | Microsoft 365 | Outlook, Calendar, OneDrive, Teams |
| `parallel-search` | Web Search | Search, URL fetching |
| `slack` | Slack | Messages, channels, search |
| `notion` | Notion | Pages, databases |
| `linear` | Linear | Issues, projects |

Any unrecognized MCP server should be listed as "Custom" with its actual name.

For each configured integration, perform a **lightweight, read-only** test:

- **Atlassian** - Search for recent Jira issues
- **Google Workspace** - List recent emails or calendar events
- **MS365** - List recent emails or calendar events
- **Parallel Search** - Run a trivial web search
- **Slack** - List channels
- **Notion** - Search for pages
- **Linear** - List recent issues

Classify results:
- **Connected** - Test succeeded, integration is working
- **Error** - Test failed with a specific error (auth expired, network issue, etc.)
- **Configured** - Installed but can't be easily tested

**Critical:** Never send, create, modify, or delete anything during tests. Read-only operations only.

### Step 3: Check Workspace Health

Verify these components:

1. **User Profile** - Is the profile section in CLAUDE.md filled in (not template defaults)?
2. **State Files**:
   - Does `state/current.md` exist and contain real content (not placeholders)?
   - Does `state/goals.md` exist and contain real content?
   - Does `state/decisions.md` exist? (Optional but recommended)
3. **State Recency** - When was `state/current.md` last modified? Flag if >3 days.
4. **Decisions Recency** - When was `state/decisions.md` last modified? Flag if >14 days or missing.
5. **Session Recency** - When was the last session log in `sessions/`? Flag if >7 days.
6. **Directory Structure** - Check for expected directories:
   - `state/` - Required
   - `sessions/` - Required
   - `content/` - Required
   - `docs/` - Recommended (for plans and design docs)
   - `meetings/` - Recommended (for meeting notes)
   - `research/` - Recommended (for research outputs)
7. **Git Status** - Is the workspace a git repo? Any uncommitted changes?
8. **Goals** - Are there active goals in `state/goals.md`?

### Step 4: Identify Available Integrations

Check which integrations could be set up but aren't configured yet. Reference known integration options and suggest setup.

### Step 5: Present Report

Format the output as a clear status dashboard.

## Output Format

```
## MARVIN Status

### CLI Tools

| Tool | Status | Details |
|------|--------|---------|
| gws  | Ready  | Configured for personal + work |
| gh   | Ready  | Authenticated as @username |
| npx  | Ready  | Available |

### MCP Integrations

| Integration | Status | Details |
|-------------|--------|---------|
| Atlassian   | Connected | Jira + Confluence accessible |
| Web Search  | Connected | parallel-search working |
| Slack       | Error | Authentication expired |

### Workspace

| Component | Status |
|-----------|--------|
| User Profile | Configured |
| State Files  | Current (updated today) |
| Decisions    | 3 days old |
| Last Session | 2 days ago (2026-02-14) |
| Git          | Clean (3 commits ahead of remote) |
| Goals        | 4 active goals |

### Directory Structure

| Directory | Status |
|-----------|--------|
| state/    | Present |
| sessions/ | Present |
| content/  | Present |
| docs/     | Missing (recommended) |
| meetings/ | Missing (recommended) |
| research/ | Missing (recommended) |

### Available (Not Configured)

- Google Workspace - Ask "Help me connect to Google Workspace"
- Linear - Ask "Help me connect to Linear"

---

Anything you'd like me to fix or set up?
```

Adapt the report to what's actually found. Skip sections that are empty.

## Notes

- This is a diagnostic tool. Never modify state or integrations during a status check.
- CLI-first philosophy: prefer CLI tools over MCP when both are available. Flag when a CLI alternative exists for an MCP-only integration.
- If errors are found, offer to help fix them after presenting the full report.
- If no integrations are configured at all, suggest the user start with one and offer to help.
