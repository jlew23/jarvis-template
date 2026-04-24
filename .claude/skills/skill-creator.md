---
name: skill-creator
description: Create new MARVIN capabilities on request. Determines if the request needs a command, agent, or skill, creates the file, and sets up routing.
---

# Skill Creator

Create new MARVIN capabilities based on user requests. Determines whether the request is best served by a command, agent, or skill, creates the appropriate file, and handles follow-up steps like routing rules and symlinks.

## When to Use

Claude Code should invoke this skill when it detects:
- "Give yourself the ability to..."
- "Create a skill for..."
- "Add a workflow for..."
- "I want MARVIN to be able to..."
- "Make a command for..."
- "Add an agent for..."
- "Can you learn to do X?"

## When NOT to Use

- When the user is asking about existing capabilities (direct them to `/help` or `/status`)
- When a skill, command, or agent already exists for the requested capability
- When the request is a one-off task, not a repeatable capability

## How It Works

### Step 1: Understand the Request

Clarify:
- What should the capability do?
- When should it trigger?
- What inputs does it need?
- What output should it produce?

### Step 2: Determine the Type

| Type | When to Use | Location | Example |
|------|-------------|----------|---------|
| **Command** | User explicitly invokes it with a slash command | `.claude/commands/{name}.md` | `/start`, `/commit`, `/report` |
| **Agent** | Autonomous delegated work MARVIN spawns via Task tool | `.claude/agents/{name}.md` | `research-agent`, `content-agent`, `events-agent` |
| **Skill** | Contextual capability that activates based on patterns | `.claude/skills/{name}.md` | `daily-briefing`, `content-shipped`, `status` |

**Decision guide:**

| Question | If Yes |
|----------|--------|
| Does the user explicitly invoke it with `/something`? | **Command** |
| Should MARVIN delegate a chunk of autonomous work? | **Agent** |
| Should it activate based on conversational context? | **Skill** |
| Does it need domain expertise and independent execution? | **Agent** |
| Is it a detection + action pattern? | **Skill** |
| Is it a defined sequence of steps the user triggers? | **Command** |

**Real examples for reference:**
- `research-agent` is an agent because MARVIN delegates a research task and gets results back
- `content-agent` is an agent because it autonomously handles drafting, editing, and distribution
- `events-agent` is an agent because it manages speaking engagements end-to-end
- `daily-briefing` is a skill because it activates contextually during `/start` or when asked
- `content-shipped` is a skill because it detects shipping language and triggers logging

### Step 3: Create the File

Use the templates in `.claude/agents/_template.md` and `.claude/skills/_template.md` as a foundation.

**For a command** (`.claude/commands/{name}.md`):
```markdown
---
description: One-line description shown in /help
---

# /{name} - Title

Instructions for what this command does when invoked.

## Steps
1. First step
2. Second step
```

**For an agent** (`.claude/agents/{name}.md`):
```markdown
---
name: agent-name
description: One-line description of what this agent does
model: sonnet
---

# Agent Name

## Purpose
What this agent is responsible for.

## What You Do
- Capability 1
- Capability 2

## What You Do Not Do
- Boundary 1
- Boundary 2

## Workflow
1. Discovery - Gather inputs
2. Execution - Do the work
3. Review - Present results

## Output Format
How the agent reports results.
```

**For a skill** (`.claude/skills/{name}.md`):
```markdown
---
name: skill-name
description: One-line description of what this skill does
---

# Skill Name

## When to Use
Claude Code should invoke this skill when:
- Trigger condition 1
- Trigger condition 2

## When NOT to Use
- Boundary 1

## How It Works
Step-by-step process.

## Output Format
Expected output structure.
```

### Step 4: Post-Creation Steps

**For agents**, suggest adding a routing rule to CLAUDE.md:
- Identify the trigger pattern (what user behavior should auto-spawn this agent?)
- Suggest a rule in this format: `User mentions X / says Y -> spawn {agent-name}`
- Offer to add it to the Routing Rules section in CLAUDE.md

**For skills**, set up discovery:
- Symlink the skill to `~/.claude/skills/` for Claude Code auto-discovery:
  ```bash
  ln -sf "$(pwd)/.claude/skills/{name}.md" ~/.claude/skills/{name}.md
  ```

**For commands**, verify it appears:
- Remind the user to check `/help` to confirm the command is listed

### Step 5: Confirm Creation

Tell the user:
- What was created and where
- How to trigger it
- Any follow-up steps taken (routing rules, symlinks)
- Ready to use immediately

## Output Format

```
Created: **{type}** - {name}
- Location: `.claude/{type}s/{name}.md`
- Trigger: {how to use it}
- Follow-up: {routing rule added / symlink created / none needed}

Ready to use.
```

## Notes

- All capabilities must live in the project's `.claude/` directory, not in global `~/.claude/` directly
- Use symlinks to `~/.claude/skills/` only for Claude Code discovery
- Keep capabilities focused on one task
- Include clear trigger conditions and boundaries ("When NOT to Use")
- Commands need a `description` in frontmatter for `/help` to display them
- Agents need a "What You Do Not Do" section to prevent scope creep
- For detailed guidance on the command vs. agent vs. skill decision, see `docs/extending.md`
