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
. (Join-Path $PSScriptRoot "backfill-require-dashscope.ps1")
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
$startUtc = (Get-Date).ToUniversalTime().ToString('o')
$startTime = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
@{
  shard = $Shard
  workers = $Workers
  apply = $Apply.IsPresent
  sleep_ms = $SleepMs
  started_at = $startUtc
  vision_api = "dashscope"
  vision_model = "qwen3.5-flash"
} | ConvertTo-Json | Set-Content (Join-Path $RunDir "run-meta.json") -Encoding UTF8
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "=== [$startTime] $runName 启动 ===" -ForegroundColor Cyan
Write-Host "参数: offset=$offset limit=$ShardSize apply=$($Apply.IsPresent) workers=$Workers sleep=${SleepMs}ms" -ForegroundColor Cyan
Write-Host "目录: $RunDir" -ForegroundColor Cyan
Write-Host "日志: $log" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan

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
$exitCode = $LASTEXITCODE

$endTime = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
Write-Host "===========================================" -ForegroundColor Green
if ($exitCode -eq 0) {
  Write-Host "=== [$endTime] $runName 正常完成 ===" -ForegroundColor Green
} else {
  Write-Host "=== [$endTime] $runName 异常退出 (code=$exitCode) ===" -ForegroundColor Red
}
Write-Host "===========================================" -ForegroundColor Green

$finishedUtc = (Get-Date).ToUniversalTime().ToString('o')
$meta = Get-Content (Join-Path $RunDir "run-meta.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$meta | Add-Member -NotePropertyName finished_at -NotePropertyValue $finishedUtc -Force
$meta | Add-Member -NotePropertyName exit_code -NotePropertyValue $exitCode -Force
$meta | ConvertTo-Json | Set-Content (Join-Path $RunDir "run-meta.json") -Encoding UTF8

if ($exitCode -ne 0) { exit $exitCode }
python (Join-Path $PSScriptRoot "backfill-summarize-results.py") (Join-Path $RunDir "results.jsonl")
python (Join-Path $PSScriptRoot "backfill-summarize-timing.py") $RunDir
Write-Host "=== 汇总完成 $runName ===" -ForegroundColor Green
