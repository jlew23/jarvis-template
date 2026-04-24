---
description: Scaffold a new software project with gstack dev toolkit
---

# /new-project - Project Scaffolding

Scaffold a new software project with gstack pre-configured. Creates the directory,
runs framework scaffolding, wires up gstack, writes CLAUDE.md, and adds the project
to MARVIN's tracking.

## Instructions

### 1. Check gstack Prerequisite

```bash
[ -d ~/.claude/skills/gstack ] && echo "GSTACK_READY" || echo "GSTACK_MISSING"
```

If GSTACK_MISSING, install it:

```bash
git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack && cd ~/.claude/skills/gstack && ./setup
```

If installation fails, warn the user and offer to proceed without gstack.

### 2. Gather Project Info

If not already clear from conversation context, ask the user:

1. **Project name** (kebab-case, used for directory name)
2. **Framework/stack** (Next.js, React/Vite, Python, Go, SwiftUI, etc.)
3. **One-line description**
4. **Location** — suggest based on context:
   - Personal projects: `~/personal/{project-name}/`
   - Work projects: ask the user for the work directory
   - Confirm before creating

If MARVIN already brainstormed a spec for this project (check `docs/superpowers/specs/`
and conversation context), pull the name, stack, and description from there.

### 3. Scaffold the Project

Create the directory and run framework scaffolding:

```bash
mkdir -p {location}/{project-name}
cd {location}/{project-name}
```

Then run the appropriate scaffolding command:

| Stack | Command |
|---|---|
| Next.js | `npx create-next-app@latest . --ts --tailwind --eslint --app --src-dir` |
| React (Vite) | `npm create vite@latest . -- --template react-ts` |
| Python | `mkdir src tests && touch src/__init__.py requirements.txt setup.py` |
| Go | `go mod init {module-name}` |
| Node.js (plain) | `npm init -y && mkdir src tests` |

For SwiftUI: Tell the user to create the Xcode project manually, then run the
remaining steps in the project directory.

For unlisted stacks: Ask the user for the scaffolding command.

Initialize git if the scaffolding didn't:

```bash
[ -d .git ] || git init
```

### 4. Wire Up gstack

Run gstack's team init to add the gstack section to CLAUDE.md:

```bash
~/.claude/skills/gstack/bin/gstack-team-init required
```

### 5. Write CLAUDE.md

If CLAUDE.md was created by gstack team init or the scaffolding, append project
context to it. If it doesn't exist, create it. Include:

```markdown
# {Project Name}

{One-line description}

## Tech Stack

{Framework, language, key libraries}

## Spec

{Link to spec if one exists, e.g.: ~/personal/marvin/docs/superpowers/specs/YYYY-MM-DD-{name}-design.md}

## gstack

{This section was added by gstack-team-init in step 4}
```

### 6. Initial Commit

```bash
git add -A
git commit -m "feat: scaffold {project-name} with gstack"
```

### 7. Update MARVIN Project Tracking

Add the project to `state/projects.md` under the appropriate section
(Personal Projects or Work Projects):

```markdown
### {Project Name}
- **Status:** Scaffolded
- **Location:** {location}/{project-name}
- **Stack:** {framework}
- **Created:** {today's date}
- **Next Action:** Run `/office-hours` to validate spec, or `/autoplan` to start planning
```

### 8. Tell the User What's Next

Output:

```
Project scaffolded at {location}/{project-name}.

Open a session there to start building:
  cd {location}/{project-name}

Suggested first steps:
  /office-hours    — validate the spec before coding
  /autoplan        — run the full review pipeline on your plan
```
