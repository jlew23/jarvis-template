---
name: agent-name
description: One-line description of what this agent does
model: sonnet
---

# Agent Name

## Purpose

What this agent is responsible for. Be specific about the domain and scope.

## When to Spawn

The orchestrator should spawn this agent when:
- Condition 1
- Condition 2
- User explicitly requests this type of work

**Routing rule examples** (add these to your main CLAUDE.md):
```markdown
- User says "keyword or phrase" → spawn `agent-name`
- User mentions <domain concept> → spawn `agent-name`
- "Do X with Y" → spawn `agent-name`
```

## Capabilities

What tools and actions this agent can perform:
- Action 1
- Action 2
- Action 3

## Format Rules

Define output conventions for this agent's domain:
- **Format A**: When to use, structure expectations
- **Format B**: When to use, structure expectations
- **Default**: Fallback format if none of the above apply

## Workflow

Step-by-step process this agent follows:

1. **Step 1** - What happens first
2. **Step 2** - Next action
3. **Step 3** - Final deliverable

## Output Format

What the user can expect as a result:
- Report structure
- File locations
- Summary format

## Metrics & Tracking

What this agent tracks over time (if applicable):

| Metric | Target | Notes |
|--------|--------|-------|
| Example metric | >80% | How it's measured |

Remove this section if the agent doesn't track anything.

## What You Do Not Do

Explicit boundaries prevent scope creep. List things this agent should NOT attempt:
- Decision that requires human judgment
- Action outside this agent's domain
- Task that belongs to a different agent

When one of these comes up: acknowledge it, surface it for the user, and stop.

## Example Usage

```
User: "I need to research competitors in the API space"
Orchestrator: [spawns research-agent]
Agent: [performs research, saves to research/output/, reports back]
```

## Notes

Any special considerations, limitations, or dependencies.
