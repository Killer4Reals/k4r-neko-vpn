# Собирает libbox.aar (ядро sing-box для Android) из исходников.
#
# Зачем скрипт, а не готовый файл: libbox.aar весит около 30 МБ, у каждого он
# свой под свою версию sing-box, и в репозитории такому файлу не место.
#
# Что нужно:
#   * Go 1.22+                     (у нас 1.23.6)
#   * JDK 17                       (с JDK 21 сборка libbox падает)
#   * Android NDK 27.1.12297006    (ставится через sdkmanager)
#   * gomobile от sagernet          github.com/sagernet/gomobile@v0.1.13
#
# Использование:
#   powershell -ExecutionPolicy Bypass -File scripts/build-libbox.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/build-libbox.ps1 -Platforms android/arm64,android/amd64

param(
    [string]$SingBoxTag = "v1.14.4",
    [string]$Platforms = "android/arm64",
    [string]$Tools = "$env:LOCALAPPDATA\Android\tools",
    [string]$Sdk = "$env:LOCALAPPDATA\Android\Sdk",
    [string]$Work = "E:\DeepAICodeProject\_build"
)

$ErrorActionPreference = "Stop"

$go = Join-Path $Tools "go\bin\go.exe"
$jdk = Join-Path $Tools "jdk-17.0.21+9"
if (-not (Test-Path $go)) { throw "нет Go: $go" }
if (-not (Test-Path $jdk)) { throw "нет JDK 17: $jdk" }

$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = $Sdk
$env:ANDROID_NDK_HOME = Join-Path $Sdk "ndk\27.1.12297006"
$env:GOPATH = Join-Path $Tools "gopath"
$env:PATH = "$($env:GOPATH)\bin;" + (Join-Path $Tools "go\bin") + ";" + $env:PATH

# мёртвый системный прокси ломает загрузку модулей
$env:HTTP_PROXY = ""
$env:HTTPS_PROXY = ""

$src = Join-Path $Work "sing-box"
if (-not (Test-Path $src)) {
    git clone --depth 1 --branch $SingBoxTag https://github.com/SagerNet/sing-box.git $src
}

Push-Location $src
try {
    & $go run ./cmd/internal/build_libbox -target android -platform $Platforms
    $aar = Join-Path $src "libbox.aar"
    if (-not (Test-Path $aar)) { throw "сборка не дала libbox.aar" }

    $libs = "E:\DeepAICodeProject\android\app\libs"
    New-Item -ItemType Directory -Force -Path $libs | Out-Null
    Copy-Item $aar (Join-Path $libs "libbox.aar") -Force
    $size = [math]::Round((Get-Item $aar).Length / 1MB, 1)
    Write-Host "готово: libbox.aar $size МБ скопирован в android/app/libs"
} finally {
    Pop-Location
}
