# Start API, worker and web in three PowerShell windows (Windows dev).
$root = Split-Path -Parent $PSScriptRoot
$api = Join-Path $root "apps\api"
$web = Join-Path $root "apps\web"

if (-not (Test-Path (Join-Path $api ".venv"))) {
  Write-Host "Creating Python venv..." -ForegroundColor Cyan
  Push-Location $api; python -m venv .venv; .\.venv\Scripts\python -m pip install -q -r requirements.txt; Pop-Location
}
if (-not (Test-Path (Join-Path $web "node_modules"))) {
  Write-Host "Installing web dependencies..." -ForegroundColor Cyan
  Push-Location $web; pnpm install; Pop-Location
}
if (-not (Test-Path (Join-Path $root ".env"))) { Copy-Item (Join-Path $root ".env.example") (Join-Path $root ".env") }

Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd '$api'; .\.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000"
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd '$api'; .\.venv\Scripts\python -m app.worker"
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd '$web'; pnpm dev"
Write-Host "API http://localhost:8000/docs  Web http://localhost:3000" -ForegroundColor Green
