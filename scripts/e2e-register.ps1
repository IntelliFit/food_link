# 新用户注册 e2e：启动临时库 + 微信开发者工具 + 跑 user-register 场景
# 前置：开发者工具 → 设置 → 安全设置 → 开启「服务端口」并允许 CLI/HTTP 调用

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$Cli = 'C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat'
$Port = 9420

Write-Host '==> 结束残留微信开发者工具进程'
Get-Process wechatdevtools -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
& $Cli quit 2>$null
Start-Sleep -Seconds 2

Write-Host "==> 以自动化模式打开项目 (端口 $Port)"
cmd /c "`"$Cli`" auto --project `"$Root`" --auto-port $Port"
Start-Sleep -Seconds 15

Write-Host '==> 检查 mrc 连接（需已开启服务端口）'
mrc where --port $Port
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host 'mrc 未连接成功。请在已打开的 food_link 项目窗口中：'
  Write-Host '  1. 设置 → 安全设置 → 开启服务端口'
  Write-Host '  2. 菜单 工具 → 开启自动化'
  Write-Host '然后重新运行: npm run test:e2e-weapp:register'
  exit 1
}

Write-Host '==> 运行 e2e 注册场景（含临时数据库，后端就绪约 1–2 分钟）'
Push-Location (Join-Path $Root 'e2e-weapp')
if (-not (Test-Path 'node_modules')) { npm install }
npx ts-node src/runner.ts --scenario scenarios/user-register.yaml --skip-build
$code = $LASTEXITCODE
Pop-Location
exit $code
