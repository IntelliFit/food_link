param(
    [Parameter(Mandatory = $true)]
    [string]$ImagePath,

    [string]$Model = "gpt-image-2-pool",

    [string]$BaseUrl = "https://maas-openapi.wanjiedata.com/api/v1",

    [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"

$resolvedImagePath = (Resolve-Path -LiteralPath $ImagePath).Path
$apiKey = [Environment]::GetEnvironmentVariable("PIXEL_AVATAR_API_KEY", "User")
if ([string]::IsNullOrWhiteSpace($apiKey)) {
    throw "PIXEL_AVATAR_API_KEY is unavailable in the Windows user environment."
}

Add-Type -AssemblyName System.Net.Http

$client = [System.Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromSeconds(180)
$client.DefaultRequestHeaders.Authorization =
    [System.Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $apiKey)

$form = [System.Net.Http.MultipartFormDataContent]::new()
$imageBytes = [System.IO.File]::ReadAllBytes($resolvedImagePath)
$imageContent = [System.Net.Http.ByteArrayContent]::new($imageBytes)
$extension = [System.IO.Path]::GetExtension($resolvedImagePath).ToLowerInvariant()
$mediaType = switch ($extension) {
    ".png" { "image/png" }
    ".webp" { "image/webp" }
    default { "image/jpeg" }
}
$imageContent.Headers.ContentType =
    [System.Net.Http.Headers.MediaTypeHeaderValue]::new($mediaType)

$prompt = @"
Transform the person into one recognizable animated 16-bit pixel-art companion sprite sheet.
Return one square 2-by-2 sheet with equal cells and transparent gutters:
top-left idle eyes open; top-right pixel-identical idle with eyes fully closed as two short horizontal pixel lines and no pupil,
bottom-left squash before a hop, bottom-right cheerful airborne hop.
Keep identity, proportions, clothing, scale and palette consistent across all frames.
Never add glasses, sunglasses, masks or eyewear unless visible in the reference, and never change eyewear between frames.
Use crisp square pixel clusters. Every pixel outside the characters must have zero alpha.
No borders, separators, stars, glow, floor shadow, guides, labels, blur, gradient or background panel.
"@

$form.Add([System.Net.Http.StringContent]::new($Model), "model")
$form.Add([System.Net.Http.StringContent]::new($prompt), "prompt")
$form.Add([System.Net.Http.StringContent]::new("low"), "quality")
$form.Add([System.Net.Http.StringContent]::new("1024x1024"), "size")
$form.Add([System.Net.Http.StringContent]::new("transparent"), "background")
$form.Add([System.Net.Http.StringContent]::new("png"), "output_format")
$form.Add($imageContent, "image", [System.IO.Path]::GetFileName($resolvedImagePath))

$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $response = $client.PostAsync(
        ($BaseUrl.TrimEnd("/") + "/images/edits"),
        $form
    ).GetAwaiter().GetResult()
    $responseBody = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    $stopwatch.Stop()

    $result = [ordered]@{
        model = $Model
        status_code = [int]$response.StatusCode
        duration_ms = $stopwatch.ElapsedMilliseconds
        response_bytes = [System.Text.Encoding]::UTF8.GetByteCount($responseBody)
    }
    if (-not $response.IsSuccessStatusCode) {
        $result.error = $responseBody.Substring(0, [Math]::Min(500, $responseBody.Length))
    } elseif (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
        $payload = $responseBody | ConvertFrom-Json
        $encoded = [string]$payload.data[0].b64_json
        if ([string]::IsNullOrWhiteSpace($encoded)) {
            throw "The image response did not include b64_json."
        }
        if ($encoded.Contains(",")) {
            $encoded = $encoded.Substring($encoded.IndexOf(",") + 1)
        }
        $resolvedOutputPath = [System.IO.Path]::GetFullPath($OutputPath)
        [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($resolvedOutputPath)) | Out-Null
        [System.IO.File]::WriteAllBytes($resolvedOutputPath, [Convert]::FromBase64String($encoded))
        $result.output_path = $resolvedOutputPath
    }
    $result | ConvertTo-Json -Compress

    if (-not $response.IsSuccessStatusCode) {
        exit 1
    }
} finally {
    $form.Dispose()
    $client.Dispose()
}
