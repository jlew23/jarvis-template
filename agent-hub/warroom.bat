@echo off
rem Starts the Agent War Room on port 3333 and opens it in your browser. Extra args pass through.
set "PY=python"
where py >nul 2>nul && set "PY=py -3"
%PY% "%~dp0server.py" --open --port 3333 --project "%~dp0projects\void_sequence.json" %*
