# Start multiple shards in background (Windows)
param(
  [int[]]$Shards = @(1, 2, 3, 4, 5),
  [switch]$Apply,
  [int]$Workers = 8,
  [int]$SleepMs = 1200,
  [switch]$RetryFailed,
  [switch]$KeepCandidateLimits,
  [int]$QueryOffset = -1,
  [int]$BingPageOffset = 0
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
  if ($KeepCandidateLimits) { $args += "-KeepCandidateLimits" }
  if ($BingPageOffset -gt 0) { $args += "-BingPageOffset", "$BingPageOffset" }
  Start-Process -FilePath "powershell.exe" -ArgumentList $args -WorkingDirectory $backend -WindowStyle Hidden
  Write-Host ("started shard-{0:D4} apply={1} retry={2} bing_offset={3} workers={4}" -f $s, $Apply.IsPresent, $RetryFailed.IsPresent, $BingPageOffset, $Workers)
}
