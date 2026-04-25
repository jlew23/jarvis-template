@echo off

:: 1. Ensure the Ollama brain is running on Windows
tasklist /FI "IMAGENAME eq ollama app.exe" 2>NUL | find /I /N "ollama app.exe">NUL
if "%ERRORLEVEL%"=="1" (
    start "" "%LOCALAPPDATA%\Programs\Ollama\ollama app.exe"
    timeout /t 4 >nul
)

:: 2. Launch JARVIS directly through WSL
echo [SYSTEM] JARVIS Booting Sequence Initiated...
wsl bash -ic "cd ~/jarvis && export OLLAMA_API_BASE='http://$(ip route show default | awk '{print $3}'):11434' && aider --model ollama_chat/qwen2.5-coder:14b"
