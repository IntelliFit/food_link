# Phase 1: 200 条 dry-run 校准
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "backfill-require-dashscope.ps1")
$Root = Split-Path $PSScriptRoot -Parent
$RunDir = Join-Path $Root "data\standard-food-image-backfill\runs\phase1-dryrun-200"
New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
Set-Location $Root
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
$log = Join-Path $RunDir "run.log"
go run ./cmd/standard-food-image-backfill --config-dir . `
  --limit 200 --offset 0 `
  --image-search bing --search-query-limit 1 `
  --max-candidates 8 --threshold 0.72 `
  --workers 2 --sleep 1s --checkpoint-every 1 `
  --dry-run --timing `
  --output-dir $RunDir `
  --timeout 6h 2>&1 | Tee-Object -FilePath $log
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
python (Join-Path $PSScriptRoot "backfill-summarize-results.py") (Join-Path $RunDir "results.jsonl")
