---
description: Search, browse, and install agent skills from the skills.sh ecosystem
---

# /skills - Skill Discovery

Manage and discover agent skills from the open skills ecosystem.

**Argument:** `$ARGUMENTS` (expects a sub-command: `list`, `search <query>`, `install <package>`, `update`)

## Sub-Commands

### No argument / help

Show available sub-commands:
```
/skills list           Show installed skills
/skills search <query> Search the skills.sh ecosystem
/skills install <pkg>  Install a skill (with confirmation)
/skills update         Check for and apply skill updates
```

### `list`

Show currently installed skills.

```bash
npx skills list 2>/dev/null || echo "Skills CLI not found. Install with: npm i -g skills"
```

Present results grouped by scope (global vs project-level).

### `search <query>`

Search the skills.sh ecosystem for skills matching the query.

```bash
npx skills find <query>
```

1. Parse results into a clean list: skill name, description, install command
2. Present numbered options
3. Ask: "Want me to install any of these?"
4. If yes, run the install flow below

### `install <package>`

Install a skill with confirmation.

1. Show the skill name and package identifier
2. Link to the skills.sh page if available: `https://skills.sh/<owner>/<repo>/<skill>`
3. Ask: "Install this skill? (y/n)"
4. On confirmation:
   ```bash
   npx skills add <package> -g -y
   ```
5. Confirm success or report errors

### `update`

Check for and apply skill updates.

```bash
npx skills check
```

If updates are available:
1. List skills with available updates
2. Ask: "Update all, or pick specific ones?"
3. Run:
   ```bash
   npx skills update
   ```

## Notes

- Browse skills visually at https://skills.sh
- Skills install to `~/.agents/skills/` (global) or `.agents/skills/` (project)
- The `find-skills` skill enables proactive skill suggestions during normal conversation
