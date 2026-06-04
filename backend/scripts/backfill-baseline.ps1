# 统计标准食物库缺图回填队列规模
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$DataDir = Join-Path $Root "data\standard-food-image-backfill"
$Out = Join-Path $DataDir "baseline.json"
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
Set-Location $Root
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
go run ./cmd/standard-food-image-backfill --config-dir . --stats-only --stats-output $Out 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "OK baseline -> $Out"
