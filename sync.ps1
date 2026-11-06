# 把 workspace 的插件源码同步到 DSH profile 的 vendor 副本。
# 两处是独立文件（node_modules 与 vendor 之间是硬链接，改 vendor 两处都动），
# 忘了同步会导致「改了代码但界面不变」，排查时极易误判成缓存问题。
$ErrorActionPreference = 'Stop'

$src = 'D:\Software\workspace\dsh-compact-line'
$dst = 'C:\Users\MRLX\.dsh\profiles\web\vendor\dsh-compact-line'

if (-not (Test-Path $src)) { throw "源码目录不存在: $src" }
if (-not (Test-Path $dst)) { throw "vendor 目录不存在: $dst" }

$files = @('cordis.patch.yml', 'package.json', 'README.md', 'LICENSE')
foreach ($f in $files) {
  $s = Join-Path $src $f
  if (Test-Path $s) { Copy-Item $s (Join-Path $dst $f) -Force }
}

foreach ($f in @('client.js', 'core.js', 'host.js', 'index.js')) {
  Copy-Item (Join-Path $src "lib\$f") (Join-Path $dst "lib\$f") -Force
}

Write-Host "已同步到 vendor"
Write-Host ""
Write-Host "校验（两侧大小应一致）:"
foreach ($f in @('client.js', 'core.js', 'host.js', 'index.js')) {
  $a = (Get-Item (Join-Path $src "lib\$f")).Length
  $b = (Get-Item (Join-Path $dst "lib\$f")).Length
  $c = (Get-Item "C:\Users\MRLX\.dsh\profiles\web\node_modules\dsh-compact-line\lib\$f" -ErrorAction SilentlyContinue).Length
  $ok = if ($a -eq $b -and ($null -eq $c -or $a -eq $c)) { 'OK' } else { '不一致!' }
  Write-Host ("  {0,-12} workspace={1,-7} vendor={2,-7} node_modules={3,-7} {4}" -f $f, $a, $b, $c, $ok)
}

Write-Host ""
Write-Host "记得重启 DSH 才会加载。"
