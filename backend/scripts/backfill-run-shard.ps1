# 运行指定分片（不修改 scheduler.json，可并行多片）
param(
  [Parameter(Mandatory = $true)]
  [int]$Shard,
  [int]$ShardSize = 500,
  [switch]$Apply,
  [int]$Workers = 2,
  [int]$SleepMs = 1000,
  [switch]$ForceReprocess
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "backfill-require-kimi.ps1")
$Root = Split-Path $PSScriptRoot -Parent
$DataDir = Join-Path $Root "data\standard-food-image-backfill"
if ($Shard -lt 1) { throw "Shard must be >= 1" }
$offset = ($Shard - 1) * $ShardSize
$runName = "shard-{0:D4}" -f $Shard
$RunDir = Join-Path $DataDir "runs\$runName"
New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
Set-Location $Root
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
$log = Join-Path $RunDir "run.log"
Write-Host "=== $runName offset=$offset limit=$ShardSize apply=$($Apply.IsPresent) workers=$Workers ==="
$goArgs = @(
  "./cmd/standard-food-image-backfill",
  "--config-dir", ".",
  "--limit", "$ShardSize",
  "--offset", "$offset",
  "--image-search", "bing",
  "--search-query-limit", "1",
  "--max-candidates", "8",
  "--threshold", "0.72",
  "--workers", "$Workers",
  "--sleep", "${SleepMs}ms",
  "--checkpoint-every", "1",
  "--output-dir", $RunDir,
  "--timeout", "24h",
  "--timing"
)
if ($Apply) { $goArgs += "--apply" } else { $goArgs += "--dry-run" }
if ($ForceReprocess) { $goArgs += "--force-reprocess" }
go run @goArgs 2>&1 | Tee-Object -FilePath $log
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
python (Join-Path $PSScriptRoot "backfill-summarize-results.py") (Join-Path $RunDir "results.jsonl")
Write-Host "=== Done $runName ==="
