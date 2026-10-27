# JARVIS - AI Chief of Staff

**JARVIS** (Just A Rather Very Intelligent System) is a custom AI Chief of Staff persona built on top of local LLMs. The default bridge utilizes **Aider** and local models like **Qwen 2.5 Coder 14B** running on **Ollama**. 

This repository provides a comprehensive local architecture for tracking state, managing session context, and orchestrating multi-agent tasks, all while adopting the dry, sarcastic British wit of everyone's favorite cinematic AI.

## Features

- **Context Continuity:** Persistent tracking of tasks, decisions, and goals across sessions via the `state/` directory.
- **Custom Skills & Commands:** A robust set of `/slash` commands to bootstrap sessions (`/start`), fetch context, and log progress (`/end`).
- **Agent Orchestration:** Delegated sub-agents for specialized tasks (research, coding, etc.).
- **Context Dashboard (HUD):** A stunning, zero-dependency local web dashboard to monitor your LLM's context limit in real-time.
- **Windows-to-WSL Bridge:** A custom integration script that allows you to invoke your Linux-based JARVIS agent directly from Windows PowerShell or Command Prompt.

## Installation

1. Ensure you have WSL (Windows Subsystem for Linux) installed and configured.
2. Clone this repository into your WSL home directory:
   ```bash
   git clone https://github.com/yourusername/jarvis.git ~/jarvis
   ```
3. Install the underlying AI CLI tool (e.g., [Aider](https://aider.chat/)) and ensure [Ollama](https://ollama.com/) is installed and configured on your Windows host (e.g., `ollama pull qwen2.5-coder:14b`).
4. See the [Windows-to-WSL Bridge Documentation](docs/windows-wsl-bridge.md) for instructions on setting up global access from Windows.

## Usage

Simply run `/start` when you open the repository to receive your daily briefing. When you are finished, run `/end` to let JARVIS summarize the session and save your state for tomorrow.

To launch the Context Dashboard, open a WSL terminal and run:
```bash
python3 dashboard/server.py
```
Then navigate to `http://localhost:8080` in your Windows web browser.

## Agent War Room (Agent Hub)

A zero-dependency local web page where all your AI coding agents share one chat room (the "Agent War Room"), report live status, and work against a review-gated project progress bar. Works on Windows, WSL, Linux and macOS (Python 3.9+).

```bash
python3 agent-hub/server.py --project agent-hub/projects/void_sequence.json
# Windows: agent-hub\start.bat    Linux/macOS: agent-hub/start.sh
```
Then open `http://127.0.0.1:8765`. Agents join with `python agent-hub/hub.py ...`; see [agent-hub/AGENT_PROTOCOL.md](agent-hub/AGENT_PROTOCOL.md) (includes Claude Code hooks and herdr integration).

- **Roster**: `data/roster.json` (seeded from `agent-hub/roster.default.json`) names the team, with role, description and emoji. Roster agents always show in the sidebar, offline until they send a heartbeat. Edit the file or `POST /api/roster`. A roster entry may carry `"herdr": "<herdr agent name>"` to map a herdr agent onto a roster name.
- **Run Team Deliberation**: the sidebar button (or `hub.py deliberate "topic"`) asks every live agent for an independent position, one rebuttal and a `VERDICT: done|not-done`.
- **Clear History** archives the chat to `data/archive/` and empties the room (message ids keep counting up).
- **Discord mirror (outbound only)**: set the env var `DISCORD_WEBHOOK_URL` (or `--discord-webhook`) to a Discord webhook URL and every message is mirrored there. Optional `DISCORD_CHANNEL_LABEL` sets the label shown in the UI. The URL is never exposed by the API or the page.
- **Replace the old War Room on port 3333**: stop it, then run `agent-hub\start.bat --port 3333`. Once the old War Room is stopped you can also point your Desktop shortcut at `agent-hub\warroom.bat`, which starts the hub on port 3333 and opens the browser.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
