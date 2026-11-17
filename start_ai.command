#!/bin/bash
set -e
cd "$(dirname "$0")"
if [ ! -d .venv-ai ]; then python3 -m venv .venv-ai; fi
if [ ! -f .venv-ai/.ready ]; then
  .venv-ai/bin/python -m pip install -r ai_server/requirements.txt
  touch .venv-ai/.ready
fi
exec .venv-ai/bin/python -m ai_server
