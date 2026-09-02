param(
    [Parameter(Mandatory = $true)]
    [string]$ApiKeyFile,
    [string]$BaseUrl = "https://api.healthymax.cn/open/v1",
    [string]$Text = ""
)

$ErrorActionPreference = "Stop"
$resolvedKeyFile = (Resolve-Path -LiteralPath $ApiKeyFile).Path
$apiKey = (Get-Content -Raw -LiteralPath $resolvedKeyFile).Trim()
if (-not $apiKey) {
    throw "API Key 文件为空: $resolvedKeyFile"
}

$base = $BaseUrl.TrimEnd("/")
$headers = @{ Authorization = "Bearer $apiKey" }

Write-Host "[1/2] 查询账户和余额"
$account = Invoke-RestMethod -Method Get -Uri "$base/account" -Headers $headers
$account | ConvertTo-Json -Depth 8

Write-Host "[2/2] 免费搜索营养库"
$search = Invoke-RestMethod -Method Get -Uri "$base/foods/search?query=%E7%89%9B%E8%82%89&limit=3" -Headers $headers
$search | ConvertTo-Json -Depth 8

if (-not $Text.Trim()) {
    Write-Host "未提供 -Text；只读验收完成，没有提交计费分析。"
    exit 0
}

Write-Host "提交文字分析（当前消耗 2 点）"
$idempotencyKey = [guid]::NewGuid().ToString()
$body = @{ text = $Text.Trim(); mode = "standard" } | ConvertTo-Json
$submitted = Invoke-RestMethod -Method Post -Uri "$base/food-analyses" -Headers ($headers + @{ "Idempotency-Key" = $idempotencyKey }) -ContentType "application/json" -Body $body
$taskId = $submitted.data.task_id
if (-not $taskId) {
    throw "提交响应缺少 task_id"
}

for ($attempt = 1; $attempt -le 60; $attempt++) {
    $result = Invoke-RestMethod -Method Get -Uri "$base/food-analyses/$taskId" -Headers $headers
    $status = $result.data.status
    Write-Host "任务状态: $status"
    if ($status -in @("completed", "failed", "cancelled", "requires_action")) {
        $result | ConvertTo-Json -Depth 20
        exit 0
    }
    Start-Sleep -Seconds 2
}

throw "等待分析结果超时，task_id=$taskId；可稍后继续查询，不要重新提交。"
