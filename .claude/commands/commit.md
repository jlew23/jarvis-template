---
description: Review changes and create clean git commits
---

# /commit - Git Commit Workflow

Review uncommitted changes and create logical, well-organized commits.

## Instructions

### 1. Check Current State
Run `git status` and `git diff --stat` to see all changes.

### 2. Group Changes
Identify logical groupings. Don't over-split: 2-4 commits is usually right, and one commit is fine if the changes are related.

| Group | Files | Commit Type |
|-------|-------|-------------|
| Features/Scripts | `src/*.py`, `*.js`, new integrations | `feat:` |
| Bug fixes | Any fix to existing behavior | `fix:` |
| Refactoring | Restructured code, no behavior change | `refactor:` |
| Commands/Agents/Skills | `.claude/commands/`, `.claude/agents/`, `.claude/skills/` | `feat:` or `chore:` |
| Config | `CLAUDE.md`, `config.yaml`, `*.json` | `chore:` |
| Content | `content/`, `research/` | `content:` |
| Documentation | `*.md` (non-state, non-session) | `docs:` |
| State/Sessions | `state/`, `sessions/` | `chore:` |

### 3. Commit Order
Follow this ordering discipline:
1. **Dependencies first** - If commit B uses something from commit A, commit A goes first
2. **Features before docs** - Ship the feature, then document it
3. **Content before state** - Content is the work, state is the record of it
4. **State/sessions always last** - These are metadata about the session

### 4. Create Commits
For each logical group:

```bash
git add <relevant-files>
git commit -m "$(cat <<'EOF'
<type>: <short description>

<optional body: explain WHY, not what. One sentence is enough.>

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

The subject line should be a concise summary. Use the optional body when the "why" isn't obvious from the subject.

### 5. Push (if requested)
After all commits are created:
```bash
git push
```

### 6. Verify
Show the commits created:
```bash
git log --oneline -5
```

## Commit Types

| Type | Use For |
|------|---------|
| `feat` | New features, scripts, commands, agents, integrations |
| `fix` | Bug fixes |
| `refactor` | Code restructuring with no behavior change |
| `docs` | Documentation, setup guides |
| `content` | Blog posts, research, content files |
| `chore` | Config, maintenance, state updates, session logs |
| `perf` | Performance improvements |
| `ci` | CI/CD pipeline changes |
