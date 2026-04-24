---
name: skill-name
description: One-line description of what this skill does
---

# Skill Name

## What This Skill Does

Clear explanation of the capability this skill provides.

## When to Use

Claude Code should invoke this skill when:

**Keyword triggers** (user says something specific):
- "keyword phrase 1"
- "keyword phrase 2"

**Context triggers** (situation-based activation):
- When a specific condition is detected in conversation
- When another command or workflow needs this capability
- When state files indicate this skill is relevant

## When NOT to Use

Clear boundaries to prevent false activations:
- When the user is asking about something similar but different
- When another skill or agent is better suited
- When the context doesn't match (e.g., discussing vs. actually doing)

## Activation Mode

**Proactive** / **On-demand** / **Both**

- **Proactive**: This skill activates automatically when it detects matching patterns. No explicit user request needed.
- **On-demand**: This skill activates only when the user explicitly asks for it.
- **Both**: Can be triggered either way depending on context.

## How It Works

### Step 1: Input
What information is gathered and from where.

### Step 2: Process
What actions are taken with that information.

### Step 3: Output
What is returned, saved, or displayed.

## Output Format

```
Expected output structure here.
Use a consistent format so results are predictable.
```

## Example

```
User: "Can you do X for me?"
Claude: [invokes skill-name]
Result: [Output description]
```

## Related

- **agent-name** (`.claude/agents/agent-name.md`) - How this skill relates to agents
- **command-name** (`.claude/commands/command-name.md`) - How this skill relates to commands

## Notes

- Dependencies, limitations, or special considerations
- File paths this skill reads from or writes to
- Integration requirements (MCP, CLI tools, etc.)
