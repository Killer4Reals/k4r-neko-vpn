# Собирает libbox.aar (ядро sing-box для Android) из исходников.
#
# Почему скрипт, а не готовый файл: libbox.aar весит около 47 МБ на две
# архитектуры, и в репозитории такому файлу не место.
#
# Что нужно:
#   * Go 1.23                     (у нас 1.23.6)
#   * JDK 17                      (с JDK 21 сборка libbox падает на проверке версии)
#   * Android SDK + NDK 27.1.12297006
#   * gomobile от sagernet        github.com/sagernet/gomobile/cmd/gomobile@v0.1.13
#                                 github.com/sagernet/gomobile/cmd/gobind@v0.1.13
#
# Три вещи, без которых сборка не проходит (проверено на своей шкуре):
#   1. -ldflags "-checklinkname=0" — иначе линковка падает с
#      "invalid reference to os.checkPidfdOnce" (Go 1.23 проверяет linkname);
#   2. без тега with_naive_outbound — иначе arm64 не линкуется:
#      "unknown relocation (315)" в предсобранной libcronet.a;
#   3. официальные флаги (версия, godebugDefault, -s -w) — иначе ядро
#      отличается от релизного.
#
# Использование:
#   powershell -ExecutionPolicy Bypass -File scripts/build-libbox.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/build-libbox.ps1 -Platforms android/arm64

param(
    [string]$SingBoxTag = "v1.14.4",
    [string]$Platforms = "android/arm64,android/amd64",
    [string]$Tools = "$env:LOCALAPPDATA\Android\tools",
    [string]$Sdk = "$env:LOCALAPPDATA\Android\Sdk",
    [string]$Work = "$PSScriptRoot\..\_build"
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

# мёртвый системный прокси ломает загрузку модулей Go
$env:HTTP_PROXY = ""
$env:HTTPS_PROXY = ""
$env:http_proxy = ""
$env:https_proxy = ""

$src = Join-Path $Work "sing-box"
if (-not (Test-Path $src)) {
    git clone --depth 1 --branch $SingBoxTag https://github.com/SagerNet/sing-box.git $src
}

$tags = @(
    "with_gvisor", "with_quic", "with_wireguard", "with_utls", "with_clash_api",
    "with_usbip", "with_openvpn", "with_openconnect",
    "badlinkname", "tfogo_checklinkname0"
) -join ","

$ldflags = "-X github.com/sagernet/sing-box/constant.Version=$SingBoxTag " +
           "-X runtime.godebugDefault=multipathtcp=0,tlssha1=1 " +
           "-checklinkname=0 -s -w -buildid="

$out = Join-Path $Work "libbox.aar"
Push-Location $src
try {
    & (Join-Path $env:GOPATH "bin\gomobile.exe") bind `
        -v `
        -o $out `
        -target $Platforms `
        -androidapi 24 `
        -javapkg=io.nekohasekai `
        -libname=box `
        -ldflags=$ldflags `
        -tags $tags `
        ./experimental/libbox
    if (-not (Test-Path $out)) { throw "сборка не дала libbox.aar" }

    $libs = Join-Path $PSScriptRoot "..\android\app\libs"
    New-Item -ItemType Directory -Force -Path $libs | Out-Null
    Copy-Item $out (Join-Path $libs "libbox.aar") -Force
    $size = [math]::Round((Get-Item $out).Length / 1MB, 1)
    Write-Host "готово: libbox.aar $size МБ ($Platforms) в android/app/libs"
} finally {
    Pop-Location
}
