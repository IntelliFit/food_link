param(
  [ValidateSet('Status', 'Start', 'Release', 'Run')][string]$Action = 'Status',
  [ValidateSet('weapp', 'backend')][string]$Service = 'weapp',
  [string]$TaskId = ''
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$stateDir = Join-Path $workspaceRoot '.local-state/runtime'
$registryPath = Join-Path $stateDir 'dev-processes.json'
$lockPath = Join-Path $stateDir 'dev-processes.lock'
$scriptPath = $PSCommandPath
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null

if ($Action -eq 'Run') {
  Set-Location -LiteralPath $workspaceRoot
  & npm.cmd run $(if ($Service -eq 'weapp') { 'dev:weapp' } else { 'dev:backend' })
  exit $LASTEXITCODE
}
if ($Action -ne 'Status' -and [string]::IsNullOrWhiteSpace($TaskId)) {
  throw '启动和释放必须指定当前对话 TaskId。'
}

# OS releases this exclusive lock even if the caller crashes.
$lock = $null
$deadline = [DateTime]::UtcNow.AddSeconds(8)
while (-not $lock) {
  try { $lock = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None') }
  catch [IO.IOException] {
    if ([DateTime]::UtcNow -ge $deadline) { throw '另一对话正在管理进程，请稍后查看状态，不要重复启动。' }
    Start-Sleep -Milliseconds 150
  }
}

function Read-Registry {
  if (Test-Path -LiteralPath $registryPath) {
    return (Get-Content -LiteralPath $registryPath -Raw | ConvertFrom-Json -AsHashtable)
  }
  return @{ version = 1; services = @{} }
}
function Save-Registry($registry) {
  $tempPath = Join-Path $stateDir ('dev-processes.' + [Guid]::NewGuid() + '.tmp')
  [IO.File]::WriteAllText($tempPath, ($registry | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $tempPath -Destination $registryPath -Force
}
function Registered-Process($entry) {
  if (-not $entry) { return $null }
  $process = Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
  if (-not $process) { return $null }
  # ConvertFrom-Json in PowerShell 7 turns ISO strings into DateTime objects.
  # Compare timestamps, not their locale-dependent string representations.
  $expectedStart = ([DateTimeOffset]$entry.started_at).UtcDateTime
  if ($process.StartTime.ToUniversalTime().Ticks -ne $expectedStart.Ticks) { return $null }
  $details = Get-CimInstance Win32_Process -Filter "ProcessId=$($entry.pid)"
  if ($entry.managed -and $details.CommandLine -notlike "*$scriptPath*") { return $null }
  return $process
}
function Existing-Processes($serviceName) {
  $all = @(Get-CimInstance Win32_Process)
  if ($serviceName -eq 'weapp') {
    $candidates = @($all | Where-Object {
      $_.Name -eq 'node.exe' -and $_.CommandLine -match 'taro.*--watch' -and $_.CommandLine -notmatch 'cross-env[\\/]'
    })
    $projectMatches = @($candidates | Where-Object { $_.CommandLine -like "*$workspaceRoot*" })
    $ambiguous = @($candidates | Where-Object { $_.CommandLine -notmatch '[A-Z]:[\\/]' })
    if ($projectMatches.Count -gt 1) { throw '发现多份本项目 watch，需先诊断现有实例，未启动新进程。' }
    if ($projectMatches.Count -eq 0 -and $ambiguous.Count -gt 0) { throw '已有无法确定项目的 watch，未重复启动。' }
    return @($projectMatches)
  }
  return @(Get-NetTCPConnection -State Listen -LocalPort 3010 -ErrorAction SilentlyContinue | ForEach-Object {
    $ownerPid = $_.OwningProcess
    $all | Where-Object { $_.ProcessId -eq $ownerPid }
  } | Sort-Object ProcessId -Unique)
}

try {
  $registry = Read-Registry
  if ($Action -eq 'Status') {
    foreach ($serviceName in @('weapp', 'backend')) {
      $entry = $registry.services[$serviceName]
      $running = Registered-Process $entry
      [pscustomobject]@{
        service = $serviceName; registered = [bool]$entry; alive = [bool]$running
        pid = $(if ($running) { $entry.pid } else { $null })
        managed = $(if ($entry) { $entry.managed } else { $false })
        consumers = $(if ($entry) { @($entry.consumers) } else { @() })
        detected_pids = @((Existing-Processes $serviceName) | ForEach-Object { $_.ProcessId })
      } | ConvertTo-Json -Compress
    }
    return
  }

  $entry = $registry.services[$Service]
  $running = Registered-Process $entry
  if ($entry -and -not $running -and (Get-Process -Id $entry.pid -ErrorAction SilentlyContinue)) {
    throw '登记 PID 仍存活但身份不匹配，保留原进程并禁止启动或停止；需要先诊断。'
  }
  if ($Action -eq 'Release') {
    if (-not $entry) { Write-Output '没有本服务登记，无需停止。'; return }
    $entry.consumers = @($entry.consumers | Where-Object { $_ -ne $TaskId })
    if ($running -and $entry.managed -and $entry.consumers.Count -eq 0) {
      # Revalidate identity immediately before terminating only this owned tree.
      if (Registered-Process $entry) {
        & taskkill.exe /PID $entry.pid /T /F | Out-Null
        if ($LASTEXITCODE -ne 0) { throw '停止已登记进程失败，保留登记供诊断。' }
      }
      $registry.services.Remove($Service)
      Write-Output "已释放并停止本管理器的 $Service PID=$($entry.pid)。"
    } elseif (-not $running) {
      $registry.services.Remove($Service)
      Write-Output '登记进程已结束，仅清理失效登记。'
    } else {
      Write-Output "已释放本对话，保留 $Service（人工进程或仍有其它对话使用）。"
    }
    Save-Registry $registry
    return
  }

  if ($running) {
    $entry.consumers = @(@($entry.consumers) + $TaskId | Sort-Object -Unique)
    Save-Registry $registry
    Write-Output "复用 $Service PID=$($entry.pid)，已登记本对话。"
    return
  }
  $existing = @(Existing-Processes $Service)
  if ($existing.Count -gt 0) {
    if ($Service -eq 'backend') {
      throw '3010 已有未登记进程，先验证身份并由用户确认复用，未抢占端口。'
    }
    $process = Get-Process -Id $existing[0].ProcessId
    $registry.services[$Service] = @{
      pid = $process.Id; started_at = $process.StartTime.ToUniversalTime().ToString('o')
      managed = $false; command = $existing[0].CommandLine; consumers = @($TaskId)
    }
    Save-Registry $registry
    Write-Output "复用人工 $Service PID=$($process.Id)，不取得停止权限。"
    return
  }
  $logId = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')
  $stdoutPath = Join-Path $stateDir "$Service.$logId.stdout.log"
  $stderrPath = Join-Path $stateDir "$Service.$logId.stderr.log"
  $args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$scriptPath`"", '-Action', 'Run', '-Service', $Service)
  $process = Start-Process -FilePath (Get-Command pwsh.exe).Source -ArgumentList $args -WorkingDirectory $workspaceRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
  $registry.services[$Service] = @{
    pid = $process.Id; started_at = $process.StartTime.ToUniversalTime().ToString('o')
    managed = $true; command = "npm run dev:$Service"; consumers = @($TaskId)
    stdout = $stdoutPath; stderr = $stderrPath; owner_task = $TaskId
    started_by = 'scripts/dev-process.ps1'
  }
  Save-Registry $registry
  Write-Output "已启动唯一登记的 $Service PID=$($process.Id)，日志 $stdoutPath。"
} finally {
  $lock.Dispose()
}
