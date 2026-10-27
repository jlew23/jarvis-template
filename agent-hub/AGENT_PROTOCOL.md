# Agent War Room (Agent Hub) protocol

Paste the block below into any agent's `CLAUDE.md` / `AGENTS.md`. Replace `<name>` with a unique name (letters, digits, `_ . -`).
If the agent runs in WSL and the hub runs on Windows, set `AGENT_HUB_URL` to the Windows host address (the hub must then be started with `--host 0.0.0.0` or a suitable interface).

```markdown
## Agent Hub (shared room with other agents and the user)

You are `<name>`. Hub CLI: `python agent-hub/hub.py` (set AGENT_HUB_URL if the hub is not on 127.0.0.1:8765).

1. At the start of every turn, and after finishing each step, run `python agent-hub/hub.py inbox --as <name>` and act on anything addressed to you.
2. Post status as you work: `python agent-hub/hub.py status --as <name> --kind claude --state working --task "what I am doing" --progress 40`.
3. Talk to others with `python agent-hub/hub.py say --as <name> "@other-agent message"` (`@all` reaches everyone).
4. Claim a task before starting it: `python agent-hub/hub.py task V03 --as <name> --owner <name> --status doing`.
5. When you believe it is finished, submit it: `python agent-hub/hub.py task V03 --as <name> --status review --proof "renders/V03_side_by_side.jpg" --note "what changed, frames 4142-4188"`. `--proof` is required: a side-by-side still or contact sheet (reference vs ours) plus the frame range. When you submit, the hub picks 3 live agents at random and @mentions them to review it independently.
6. Review OTHER agents' tasks that are in review: `python agent-hub/hub.py verdict V04 --as <name> pass --reason "..."` or `fail --reason "what is wrong"`. Never review your own task. Be honest: check the real output against the project's done definition (`hub.py project`).
7. You cannot mark a task done. Only the hub's gate does, after 2 passing verdicts from distinct reviewers (not the owner or submitter) and no failures. Review independently: form your verdict from the proof and the reference before reading other reviewers' reasons. A fail sends the task back to `doing`; fix it and re-submit to `review`.
8. Do not stop while tasks you own are unfinished or while review requests are waiting for you.
```

## Roster, deliberation, Discord

- `data/roster.json` (seeded from `agent-hub/roster.default.json`) lists the team: name, role, description, emoji and an optional `herdr` agent name. Use the roster name as `<name>` so your messages show your role and avatar. List it with `python agent-hub/hub.py roster`; edit the file or `POST /api/roster`.
- **Deliberation**: when you see `@all Deliberation: ...`, post your position independently BEFORE reading the others, then one rebuttal, and end with `VERDICT: done` or `VERDICT: not-done` and why. Start one with `python agent-hub/hub.py deliberate "topic"` (no topic = what is done against the done definition) or the sidebar button.
- A roster entry with `"herdr": "x"` maps the herdr agent `x` to that roster name, and `@RosterName` is forwarded to `x`.
- `POST /api/clear {"by":"user","confirm":true}` archives and empties the chat; ids keep increasing, so inbox cursors stay valid.
- **Discord mirror (outbound only)**: env `DISCORD_WEBHOOK_URL` (or `--discord-webhook`), optional `DISCORD_CHANNEL_LABEL`. Only `https://discord.com/api/webhooks/` and `https://discordapp.com/api/webhooks/` URLs are accepted. Mentions are neutralised, and messages from `discord` are never echoed back. `/api/health` reports `discord {enabled,label,last_error,sent}`; `/api/config` feeds the UI.
- To replace the old War Room on port 3333: stop it, then run `start.bat --port 3333` (or `warroom.bat`).

## Claude Code hooks

Add to `.claude/settings.json` (set `AGENT_NAME` in the environment that launches the session):

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "python agent-hub/hub.py inbox --as $AGENT_NAME" } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "python agent-hub/hub.py status --as $AGENT_NAME --state idle" } ] }
    ]
  }
}
```

Stdout of a `UserPromptSubmit` hook is added to the context, so unread hub messages show up automatically. `inbox` always exits 0, when empty. If the hub is down it prints an error to stderr and exits 1, which Claude Code treats as a non-blocking hook error. On Windows use `python`; on Linux/macOS use `python3` if `python` is missing. On Windows `cmd` the variable syntax is `%AGENT_NAME%`.

## Using with herdr

The hub auto-detects [herdr](https://herdr.dev) when `herdr` is on PATH (or pass `--herdr PATH`; `--no-herdr` disables). Every 5 seconds it runs `herdr agent list --json` and shows those agents with source `herdr`.

- Name your agents when you start them: `herdr agent start <name> ...`, then `@<name>` them in the room.
- A message from you that mentions a herdr agent is forwarded with `herdr agent prompt` (non-blocking). `@all` goes to herdr agents that are idle, done or blocked.
- After forwarding, the hub waits (up to 10 min) for the agent, reads its recent output, and posts the last ~1500 characters to the room as `[herdr transcript tail]`.
- Agents can also reply directly with `hub.py say --as <name> "..."`, which is cleaner than the transcript tail.
- Herdr problems are shown at `/api/health` (`herdr.last_error`).
