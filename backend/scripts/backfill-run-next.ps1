# 按 scheduler.json 执行下一片回填
param(
  [string]$SchedulerPath = ""
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "backfill-require-kimi.ps1")
$Root = Split-Path $PSScriptRoot -Parent
$DataDir = Join-Path $Root "data\standard-food-image-backfill"
if (-not $SchedulerPath) { $SchedulerPath = Join-Path $DataDir "scheduler.json" }
if (-not (Test-Path $SchedulerPath)) {
  Copy-Item (Join-Path $DataDir "scheduler.example.json") $SchedulerPath
  Write-Host "已创建 $SchedulerPath ，请确认 apply/workers 后重新运行"
  exit 0
}
$cfg = Get-Content $SchedulerPath -Raw -Encoding UTF8 | ConvertFrom-Json
$shard = [int]$cfg.next_shard
$size = [int]$cfg.shard_size
$offset = ($shard - 1) * $size
$runName = "shard-{0:D4}" -f $shard
$RunDir = Join-Path $DataDir "runs\$runName"
New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
Set-Location $Root
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
$apply = [bool]$cfg.apply
$dry = -not $apply
$log = Join-Path $RunDir "run.log"
Write-Host "Running $runName offset=$offset limit=$size apply=$apply"
$goArgs = @(
  "./cmd/standard-food-image-backfill",
  "--config-dir", ".",
  "--limit", "$size",
  "--offset", "$offset",
  "--image-search", "$($cfg.image_search)",
  "--search-query-limit", "$([int]$cfg.search_query_limit)",
  "--max-candidates", "$([int]$cfg.max_candidates)",
  "--threshold", "$([double]$cfg.threshold)",
  "--workers", "$([int]$cfg.workers)",
  "--sleep", "$([int]$cfg.sleep_ms)ms",
  "--checkpoint-every", "1",
  "--output-dir", $RunDir,
  "--timeout", "24h",
  "--timing"
)
if ($apply) { $goArgs += "--apply" } else { $goArgs += "--dry-run" }
go run @goArgs 2>&1 | Tee-Object -FilePath $log
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$cfg.next_shard = $shard + 1
$cfg | ConvertTo-Json -Depth 5 | Set-Content $SchedulerPath -Encoding UTF8
python (Join-Path $PSScriptRoot "backfill-summarize-results.py") (Join-Path $RunDir "results.jsonl")
Write-Host "Done $runName ; next_shard=$($cfg.next_shard)"
