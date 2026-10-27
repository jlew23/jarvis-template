#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
PY=python3; command -v python3 >/dev/null 2>&1 || PY=python
( sleep 1; (xdg-open http://127.0.0.1:8765 || open http://127.0.0.1:8765) >/dev/null 2>&1 ) &
exec "$PY" server.py --project projects/void_sequence.json "$@"
