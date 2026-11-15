# Скачивает движок sing-box для Windows в папку ресурсов.
# Запускать один раз перед первой сборкой: powershell -ExecutionPolicy Bypass -File scripts/fetch-engine.ps1
param(
    [string]$Version = "1.14.4"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $root "app\src-tauri\resources\bin"
New-Item -ItemType Directory -Force -Path $bin | Out-Null

$zip = Join-Path $env:TEMP "sing-box-$Version.zip"
$url = "https://github.com/SagerNet/sing-box/releases/download/v$Version/sing-box-$Version-windows-amd64.zip"
Write-Host "Скачиваю $url"
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

$tmp = Join-Path $env:TEMP "sing-box-$Version"
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
Expand-Archive -Path $zip -DestinationPath $tmp -Force

$exe = Get-ChildItem -Path $tmp -Recurse -Filter "sing-box.exe" | Select-Object -First 1
if (-not $exe) { throw "в архиве нет sing-box.exe" }
Copy-Item $exe.FullName (Join-Path $bin "sing-box.exe") -Force
Remove-Item -Recurse -Force $tmp, $zip
Write-Host "Готово: $bin\sing-box.exe"
