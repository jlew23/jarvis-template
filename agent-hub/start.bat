@echo off
rem Starts the Agent Hub and opens it in your browser. Extra args (e.g. --port 9000) pass through.
set "PY=python"
where py >nul 2>nul && set "PY=py -3"
%PY% "%~dp0server.py" --open --project "%~dp0projects\void_sequence.json" %*
