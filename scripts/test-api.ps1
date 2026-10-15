$ErrorActionPreference = "Stop"

$rpgRoot = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $rpgRoot "backend")
try {
  & .\.venv\Scripts\python.exe -m pytest -q
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
