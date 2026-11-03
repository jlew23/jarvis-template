## DeepSeek Harness × Verdent reliability plugins (preview)

**Make Verdent agents more reliable with validated task reports, reusable playbooks, and automatic model fallback for provider outages.**

> **Preview only — not merged into `master`.** These opt-in plugins are proposed in [draft PR #4](https://github.com/jlew23/jarvis-template/pull/4). Review or check out the PR branch before attempting installation; they are not included in the default clone.

- **`verdent-report`:** Workers submit structured, criteria-based reports; Verifiers grade them; approved results become reusable playbooks. Managers can inspect short reports instead of trusting chat summaries.
- **`model-fallback`:** After provider-side failures exhaust normal retries, switch an agent's model for its *next* step or turn. The failed step is not replayed automatically.
- **Compatibility:** `model-fallback` requires **DeepSeek Harness 0.2.2-alpha.2 or newer**; it disables itself on 0.2.1-rc.x. Report hooks have been observed on earlier builds; compatibility beyond the tested setup should be checked individually.
- **Evidence:** The maintainer reports three days of intensive live testing in their DeepSeek Harness/Verdent environment, alongside 31/31 automated tests on a stand-in host. Specific live test logs, version coverage, and reproducible results have not yet been published here.

**[Start here: plugin quick start](dsh-plugins/README.md#quick-start-preview)** · [Ready-made preset configurations](dsh-plugins/presets/README.md) · [Review findings](dsh-plugins/FINDINGS.md) · [Draft PR #4](https://github.com/jlew23/jarvis-template/pull/4)

**Feedback wanted:** Try the report plugin on one throwaway task and [tell us where setup or output is confusing](https://github.com/jlew23/jarvis-template/issues/new). Check compatibility with your Harness version and try a small task first.

---

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

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
