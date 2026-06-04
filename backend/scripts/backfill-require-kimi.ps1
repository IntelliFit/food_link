# 检查 backend/.env 中是否已配置 KIMI_API_KEY
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
if ($env:KIMI_API_KEY -and $env:KIMI_API_KEY -notmatch '在此粘贴|your_|^\s*$') { return }
$envFile = Join-Path $Root ".env"
if (-not (Test-Path $envFile)) {
    Write-Error "缺少 $envFile ，请从 .env.example 复制并填写 KIMI_API_KEY"
}
$found = $false
foreach ($line in Get-Content $envFile -Encoding UTF8) {
    $t = $line.Trim()
    if ($t -match '^\s*#' -or $t -eq '') { continue }
    if ($t -match '^\s*KIMI_API_KEY\s*=\s*(.+)\s*$') {
        $val = $Matches[1].Trim().Trim('"').Trim("'")
        if ($val -and $val -notmatch '在此粘贴|your_') {
            $found = $true
            break
        }
    }
}
if ($found) { return }
$oauth = Join-Path $Root "tmp\kimi-code-oauth-token.json"
if (Test-Path $oauth) { return }
Write-Error @"
未配置 Kimi API Key。请编辑 backend\.env ：
  KIMI_API_KEY=你的Key

或执行 OAuth：
  cd backend
  go run ./cmd/standard-food-image-backfill --config-dir . --auth-only
"@
