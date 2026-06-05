# 对已有分片目录中的失败项重试：保持默认候选规模(8/1/12)，仅提高 Bing 分页偏移
param(
  [int[]]$Shards = @(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26),
  [switch]$Apply,
  [int]$Workers = 8,
  [int]$SleepMs = 1200,
  [int]$BingPageOffset = 1,
  [int]$ShardSize = 500
)
$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "backfill-run-shard.ps1"
$backend = Split-Path $PSScriptRoot -Parent
$dataDir = Join-Path $backend "data\standard-food-image-backfill\runs"

foreach ($s in $Shards) {
  $runName = "shard-{0:D4}" -f $s
  $runDir = Join-Path $dataDir $runName
  $qOffset = ($s - 1) * $ShardSize
  $metaPath = Join-Path $runDir "run-meta.json"
  if (Test-Path $metaPath) {
    try {
      $meta = Get-Content $metaPath -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($null -ne $meta.query_offset) {
        $qOffset = [int]$meta.query_offset
      }
    } catch {
      Write-Warning "无法读取 $metaPath，使用默认 query_offset=$qOffset"
    }
  }
  $args = @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $script,
    "-Shard", "$s",
    "-QueryOffset", "$qOffset",
    "-Workers", "$Workers",
    "-SleepMs", "$SleepMs",
    "-RetryFailed",
    "-KeepCandidateLimits",
    "-BingPageOffset", "$BingPageOffset"
  )
  if ($Apply) { $args += "-Apply" }
  Start-Process -FilePath "powershell.exe" -ArgumentList $args -WorkingDirectory $backend -WindowStyle Hidden
  Write-Host ("started {0} retry-failed query_offset={1} bing_page_offset={2} apply={3}" -f $runName, $qOffset, $BingPageOffset, $Apply.IsPresent)
}
