# Start shards to cover all foods still missing images (reads baseline JSON or runs --stats-only)
param(
  [int]$StartShard = 16,
  [int]$ShardSize = 500,
  [switch]$Apply,
  [int]$Workers = 8,
  [int]$SleepMs = 1200,
  [int]$MissingTotal = 0,
  [string]$BaselinePath = ""
)
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

if (-not $BaselinePath) {
  $BaselinePath = Join-Path $Root "data\standard-food-image-backfill\baseline-now.json"
}
if ($MissingTotal -le 0) {
  if (-not (Test-Path $BaselinePath)) {
    Write-Host "拉取缺图基线 -> $BaselinePath"
    go run ./cmd/standard-food-image-backfill --config-dir . --stats-only --stats-output $BaselinePath | Out-Host
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }
  $baseline = Get-Content $BaselinePath -Raw -Encoding UTF8 | ConvertFrom-Json
  $MissingTotal = [int]$baseline.missing_backfill_queue.total
}
if ($MissingTotal -le 0) {
  Write-Host "缺图队列为 0，无需启动新分片。"
  exit 0
}

$shardCount = [int][Math]::Ceiling($MissingTotal / [double]$ShardSize)
$endShard = $StartShard + $shardCount - 1
Write-Host "缺图 $MissingTotal 条 | 每片 $ShardSize | 将启动 shard-$("{0:D4}" -f $StartShard) .. shard-$("{0:D4}" -f $endShard) (query_offset 0..$(($shardCount - 1) * $ShardSize))"

$shardScript = Join-Path $PSScriptRoot "backfill-run-shard.ps1"
for ($i = 0; $i -lt $shardCount; $i++) {
  $shard = $StartShard + $i
  $qOffset = $i * $ShardSize
  $args = @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $shardScript,
    "-Shard", "$shard", "-QueryOffset", "$qOffset", "-Workers", "$Workers", "-SleepMs", "$SleepMs"
  )
  if ($Apply) { $args += "-Apply" }
  Start-Process -FilePath "powershell.exe" -ArgumentList $args -WorkingDirectory $Root -WindowStyle Hidden
  Write-Host ("started shard-{0:D4} query_offset={1}" -f $shard, $qOffset)
}

$schedulerPath = Join-Path $Root "data\standard-food-image-backfill\scheduler.json"
if (Test-Path $schedulerPath) {
  $cfg = Get-Content $schedulerPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $cfg.next_shard = $endShard + 1
  $cfg | ConvertTo-Json | Set-Content $schedulerPath -Encoding UTF8
  Write-Host "scheduler next_shard -> $($cfg.next_shard)"
}
