param([switch]$WithModel)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.11 or 3.12 is required.' }
}
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Base dependency installation failed.' }
if ($WithModel) {
    & .\.venv\Scripts\python.exe -m pip install torch==2.7.1 torchvision==0.22.1 --index-url https://download.pytorch.org/whl/cpu
    if ($LASTEXITCODE -ne 0) { throw 'PyTorch installation failed.' }
    & .\.venv\Scripts\python.exe -m pip install -r requirements-model.txt
    if ($LASTEXITCODE -ne 0) { throw 'Model dependency installation failed.' }
}
Write-Host 'Ready. Double-click Start-PromptScope.cmd or run .venv\Scripts\python.exe -m promptscope'
