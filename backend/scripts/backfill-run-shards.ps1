# Start multiple shards in background (Windows)
param(
  [int[]]$Shards = @(1, 2, 3, 4, 5),
  [switch]$Apply,
  [int]$Workers = 8,
  [int]$SleepMs = 1200,
  [switch]$RetryFailed,
  [int]$QueryOffset = -1
)
$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "backfill-run-shard.ps1"
$backend = Split-Path $PSScriptRoot -Parent
foreach ($s in $Shards) {
  $args = @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $script,
    "-Shard", "$s", "-Workers", "$Workers", "-SleepMs", "$SleepMs"
  )
  if ($QueryOffset -ge 0) { $args += "-QueryOffset", "$QueryOffset" }
  if ($Apply) { $args += "-Apply" }
  if ($RetryFailed) { $args += "-RetryFailed" }
  Start-Process -FilePath "powershell.exe" -ArgumentList $args -WorkingDirectory $backend -WindowStyle Hidden
  Write-Host ("started shard-{0:D4} apply={1} retry={2} workers={3}" -f $s, $Apply.IsPresent, $RetryFailed.IsPresent, $Workers)
}
