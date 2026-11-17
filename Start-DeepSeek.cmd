@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo First run: execute scripts\Setup.ps1 in PowerShell.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" scripts\start_deepseek.py
pause
