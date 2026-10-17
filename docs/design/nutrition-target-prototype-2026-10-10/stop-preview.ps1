$ErrorActionPreference = 'Stop'
$recordPath = 'D:/files/food_link/.local-state/runtime/nutrition-target-prototype-20261010.json'
if (!(Test-Path -LiteralPath $recordPath)) { Write-Output '没有本原型进程登记。'; exit }
$record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
$previewProcess = Get-Process -Id $record.pid -ErrorAction SilentlyContinue
if (!$previewProcess) { Write-Output '原型服务已停止。'; exit }
$expectedStart = [DateTimeOffset]::Parse($record.startTime).UtcDateTime
$expectedScript = Join-Path $PSScriptRoot 'serve.cjs'
$processDetails = Get-CimInstance Win32_Process -Filter "ProcessId=$($previewProcess.Id)"
if ($previewProcess.StartTime.ToUniversalTime() -ne $expectedStart -or $previewProcess.ProcessName -ne 'node' -or !$processDetails.CommandLine.Contains($expectedScript)) {
  throw 'PID 身份与本原型登记不符，未停止任何进程。'
}
Stop-Process -Id $previewProcess.Id
Write-Output '已停止本次饮食方案原型服务，HTML 文件保留。'
