@echo off
cd /d "%~dp0"
if not exist .venv-ai\Scripts\python.exe py -3 -m venv .venv-ai
if errorlevel 1 goto error
if not exist .venv-ai\.ready (
  .venv-ai\Scripts\python.exe -m pip install -r ai_server\requirements.txt
  if errorlevel 1 goto error
  type nul > .venv-ai\.ready
)
.venv-ai\Scripts\python.exe -m ai_server
if errorlevel 1 goto error
exit /b
:error
echo AI app startup failed. See the error above.
pause
