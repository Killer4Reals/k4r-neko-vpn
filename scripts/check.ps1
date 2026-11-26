# Локальная проверка вместо платного GitHub Actions.
#
# GitHub Actions на приватном репозитории упирается в лимит минут и billing,
# поэтому все проверки идут здесь, на этой машине. Запуск:
#   powershell -ExecutionPolicy Bypass -File scripts\check.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\check.ps1 -Build
#
# -Build дополнительно собирает установщик.
param([switch]$Build)

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root "app"
$night = "E:\DeepAICodeProject\.night"
New-Item -ItemType Directory -Force $night | Out-Null
$log = Join-Path $night "local-ci.log"
"== $(Get-Date -Format HH:mm:ss)" | Set-Content $log

function Step([string]$name) {
  $line = "$(Get-Date -Format HH:mm:ss) $name"
  Write-Host $line
  Add-Content -Path $log -Value $line -Encoding utf8
}

Push-Location $app
try {
  Step "typescript"
  npx tsc --noEmit 2>&1 | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -ne 0) { throw "tsc failed" }

  Step "vitest"
  npx vitest run --reporter=dot 2>&1 | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -ne 0) { throw "vitest failed" }

  Step "vite build"
  npm run build 2>&1 | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -ne 0) { throw "vite build failed" }

  Step "cargo test"
  Push-Location (Join-Path $app "src-tauri")
  try {
    $env:K4R_NO_ADMIN = "1"
    cargo test 2>&1 | Tee-Object -FilePath $log -Append
    if ($LASTEXITCODE -ne 0) { throw "cargo test failed" }
  } finally {
    Remove-Item Env:K4R_NO_ADMIN -ErrorAction SilentlyContinue
    Pop-Location
  }

  if ($Build) {
    Step "tauri build"
    Remove-Item Env:K4R_NO_ADMIN -ErrorAction SilentlyContinue
    npx tauri build 2>&1 | Tee-Object -FilePath $log -Append
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }
    $setup = Get-ChildItem (Join-Path $app "src-tauri\target\release\bundle\nsis") -Filter "*-setup.exe" |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $setup) { throw "installer missing" }
    $sha = (Get-FileHash $setup.FullName -Algorithm SHA256).Hash.ToLower()
    Step "installer: $($setup.Name) $($setup.Length) bytes sha256=$sha"
  }
} catch {
  Step "ОШИБКА: $($_.Exception.Message)"
  Get-Content $log -Tail 20 | Write-Host
  exit 1
} finally {
  Pop-Location
}

Step "готово"