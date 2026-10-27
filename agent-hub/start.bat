@echo off
start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:8765"
python "%~dp0server.py" --project "%~dp0projects\void_sequence.json" %*
