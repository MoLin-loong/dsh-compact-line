# 重建预览页并截图。改完 lib/client.js 的 CSS 后跑一次，
# 就能在 preview/shot.png 里看到真实渲染效果，不必重启 DSH 去试。
#   pwsh -File D:\Software\workspace\dsh-compact-line\preview.ps1
$ErrorActionPreference = 'Stop'

$dir  = 'D:\Software\workspace\dsh-compact-line\preview'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Users\MRLX\AppData\Roaming\fnm\node-versions\v26.13.0\installation\node.exe' }

& $node (Join-Path $dir 'build.mjs')
if ($LASTEXITCODE -ne 0) { throw '预览页生成失败' }

$edge = @(
  'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
  'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
  'C:\Program Files\Google\Chrome\Application\chrome.exe'
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw '找不到 Edge 或 Chrome，无法截图' }

$png  = Join-Path $dir 'shot.png'
$prof = Join-Path $dir '_profile'
Remove-Item $png  -Force -ErrorAction SilentlyContinue
Remove-Item $prof -Recurse -Force -ErrorAction SilentlyContinue

$url = 'file:///' + ($dir -replace '\\','/') + '/index.html'
& $edge --headless=new --disable-gpu --no-first-run --user-data-dir="$prof" --hide-scrollbars --force-device-scale-factor=2 --window-size=520,700 --screenshot="$png" $url 2>&1 | Out-Null
Start-Sleep -Seconds 1

if (Test-Path $png) {
  Write-Host ("截图已更新: " + $png + "  (" + (Get-Item $png).Length + " B)")
} else {
  throw '截图失败'
}
