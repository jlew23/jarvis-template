---
name: content-shipped
description: Proactively detect and log shipped content when user mentions publishing, launching, or completing work. Tracks progress against monthly goals.
---

# Content Shipped

Log completed content to track progress against goals. This skill is proactive and activates when it detects shipping language in conversation.

## When to Use

Claude Code should invoke this skill when it detects:
- "I shipped..."
- "I published..."
- "Just posted..."
- "Finished the..."
- "The {article/video/post} is live"
- "went live"
- "hit publish"
- "launched"
- "released"
- "dropped" (in the context of content, e.g., "dropped a new video")

## When NOT to Use

- When "launched" or "released" refers to a product feature, not content
- When the user is planning future content (not yet shipped)
- When discussing someone else's content

## How It Works

### Step 1: Extract Content Details

From the conversation, identify:
- **Type**: Article, video, podcast, social post, newsletter, talk, etc.
- **Title**: The content title
- **URL**: Link if available
- **Platform**: Where it was published (YouTube, blog, LinkedIn, etc.)
- **Goal**: Which monthly/annual goal this counts toward

### Step 2: Confirm Details

If any critical details are unclear, ask briefly:
- "What's the title?"
- "Where was it published?"
- "Which goal does this count toward?"

Don't over-ask. If the context is clear, proceed without confirmation.

### Step 3: Log to Content File

Append to `content/log.md`:

```markdown
### {DATE}
- **[{TYPE}]** "{Title}"
  - URL: {link}
  - Platform: {where published}
  - Goal: {which goal this supports}
```

### Step 4: Update Pipeline Status

If tracking content in a pipeline (e.g., `state/current.md` or a project tracker):
- Move the item to "published" or "complete" status
- Mark it as "logged" to avoid double-counting

### Step 5: Check Progress Against Goals

Read `state/goals.md` and calculate:
- How many pieces shipped this month (by type)
- Monthly target for that content type
- Whether the user is on pace, ahead, or behind

### Step 6: Report Progress

Acknowledge the shipped work with progress context:

```
Logged: **[{TYPE}]** "{Title}"
Progress: {X}/{Y} {content type} this month ({Z} days remaining)
```

If behind pace: "You're {N} behind pace for the month. {days} days left."
If on track: "On track."
If ahead: "Ahead of pace."

## Output Format

```
Logged: **[{TYPE}]** "{Title}"
Progress: {X}/{Y} {content type} this month ({Z} days remaining)
```

## Related

- The **content-agent** (`.claude/agents/content-agent.md`) handles content creation, drafting, and distribution. This skill handles the logging and tracking side.

## Notes

- Be proactive about detecting shipped content in conversation
- Don't require explicit trigger if context is clear
- Keep celebration brief, not over-the-top
- If `state/goals.md` doesn't have content targets, just log the item without progress tracking
- If `content/log.md` doesn't exist, create it with a header before appending
