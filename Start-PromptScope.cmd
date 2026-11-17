@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo First run: execute scripts\Setup.ps1 in PowerShell.
  pause
  exit /b 1
)
echo PromptScope: http://127.0.0.1:8765
echo Open that address in your browser. Keep this window open.
echo Press Ctrl+C to stop.
".venv\Scripts\python.exe" -m promptscope
pause
