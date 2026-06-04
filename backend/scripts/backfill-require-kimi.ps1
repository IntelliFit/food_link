# 检查 Kimi 鉴权是否可用
$Root = Split-Path $PSScriptRoot -Parent
$keyFile = Join-Path $Root "tmp\kimi-api-key.local"
if ($env:KIMI_API_KEY) { return }
if (Test-Path $keyFile) { return }
$oauth = Join-Path $Root "tmp\kimi-code-oauth-token.json"
if (Test-Path $oauth) { return }
Write-Error @"
未配置 Kimi API Key。请任选其一：
  1. copy kimi-api-key.local.example tmp\kimi-api-key.local 并填入 Key
  2. `$env:KIMI_API_KEY='sk-...'
  3. go run ./cmd/standard-food-image-backfill --config-dir . --auth-only
"@
