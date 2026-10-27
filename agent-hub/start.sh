#!/usr/bin/env bash
# Starts the Agent Hub and opens it in your browser. Extra args (e.g. --port 9000) pass through.
cd "$(dirname "$0")" || exit 1
PY=python3; command -v python3 >/dev/null 2>&1 || PY=python
exec "$PY" server.py --open --project projects/void_sequence.json "$@"
