# Windows-to-WSL Integration Bridge

The `jarvis.bat` script provided in this repository is a simple but powerful integration bridge. It allows you to seamlessly invoke your WSL-based JARVIS instance from anywhere within Windows (PowerShell, CMD, or standard Windows Terminal).

## Why is this needed?

Local AI agents often run best natively in Linux environments, but you likely want to host your heavy LLMs (like Ollama) on Windows to leverage native GPU acceleration. 

The `jarvis.bat` bridge automates this complex handoff:
1. **Ollama Check:** It checks if the `ollama app.exe` process is running on your Windows host. If not, it automatically starts it and waits for it to boot.
2. **WSL Connection:** It connects to your default WSL instance and changes the directory to your JARVIS workspace (`~/jarvis`).
3. **Dynamic Networking:** It uses a networking command (`ip route show default | awk '{print $3}'`) to figure out the IP address of your Windows host from *within* WSL, allowing the WSL agent to communicate directly with the Windows Ollama API!
4. **Agent Invocation:** Finally, it invokes `aider` interactively, explicitly pointing it to your local model (e.g., `qwen3.5:4b`).

## Prerequisites: Ollama & Aider Setup

Before the bridge can work, you need to configure your local AI stack to allow WSL to communicate with Windows.

1. **Install Ollama on Windows:** Download and install [Ollama](https://ollama.com/) for Windows.
2. **Pull the Model:** Open a Windows PowerShell and download your preferred model (the bridge uses `qwen3.5:4b` by default):
   ```powershell
   ollama pull qwen3.5:4b
   ```
3. **Configure Windows Networking:** By default, Ollama only listens to `localhost`. To allow WSL to reach it, you must bind it to all network interfaces:
   - Open Windows **Environment Variables**.
   - Under "User variables", add a **New** variable:
     - **Variable name:** `OLLAMA_HOST`
     - **Variable value:** `0.0.0.0`
   - **Restart Ollama** (quit the system tray icon and relaunch it) for this to take effect.
4. **Install Aider in WSL:** Open your WSL terminal and install Aider:
   ```bash
   python3 -m pip install aider-chat
   ```

## Setup Instructions

To use the bridge globally across your Windows machine, you have two options:

### Option 1: The Quick Method (Recommended)
Simply copy the `jarvis.bat` file from your WSL directory directly into your `C:\Windows` folder. 
Since `C:\Windows` is already in your system's PATH by default, you will instantly be able to run `jarvis` from any terminal without further configuration. *(Note: You may need Administrator privileges to copy files into this folder).*

### Option 2: The Custom Folder Method
1. **Move the Script**: Copy the `jarvis.bat` file into a custom folder like `C:\Scripts\`.
2. **Edit Windows PATH**: 
   - Open the Windows Start Search, type **"env"**, and select **"Edit the system environment variables"**.
   - Click **"Environment Variables..."** -> Select **Path** under "User variables" -> Click **Edit**.
   - Click **New** and add the path to your custom folder (e.g., `C:\Scripts`).
   - Click OK to save all changes.
3. **Restart your Terminal**: Close and reopen your Windows terminal.

## Usage

Simply open a Windows PowerShell or Command Prompt and type:

```cmd
jarvis
```

You will immediately be dropped into your JARVIS interactive session within the WSL context.

## Troubleshooting

- **Command Not Found**: If `jarvis` isn't recognized, ensure you correctly added the folder containing the `.bat` file to your Windows Path and restarted your terminal.
- **Wrong WSL Distribution**: If you have multiple WSL distributions (like Ubuntu, Debian, Alpine) and `jarvis.bat` connects to the wrong one, edit the script to explicitly pass the `-d` flag (e.g., `wsl.exe -d Ubuntu -e bash ...`).
- **Interactive Shell Issues**: The `-ic` flag in the script ensures that `bash` runs as an interactive shell. This is usually required so that tools installed via `npm` or `pip` are available in your `$PATH`.
- **Ollama Networking**: If Aider fails to connect to Ollama, ensure that your WSL instance allows traffic to the Windows host, and that `OLLAMA_HOST=0.0.0.0` is set in your Windows environment variables so Ollama binds to the network interface, not just localhost.
