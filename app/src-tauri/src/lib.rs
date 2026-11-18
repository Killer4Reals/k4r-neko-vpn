// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod engine;
pub mod health;
pub mod netwatch;
pub mod probe;
pub mod single;
pub mod store;
pub mod subscription;
#[cfg(windows)]
pub mod orchestrator;
pub mod wfp;
pub mod zapret;
pub mod zapret_lists;

use probe::PingResult;
use serde::Serialize;
use std::path::PathBuf;
use store::AppState;
use subscription::{Profile, SubHeader, SubResult};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, State};
use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
use winreg::RegKey;

#[derive(Serialize, Clone)]
pub struct CoreInfo {
    pub name: String,
    pub version: String,
    /// Версия sing-box, как её называет само ядро ("1.14.4"); пусто — не смогли.
    pub core_version: String,
    /// true, если работает обновлённое ядро, а не встроенное.
    pub core_updated: bool,
    pub platform: String,
    pub data_dir: String,
    pub admin: bool,
    pub zapret_dir: Option<String>,
    pub autostart: bool,
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("cannot resolve app data dir: {e}"))
}

/// Какое ядро запускать: своё обновлённое, если оно есть, иначе встроенное.
fn core_bin(app: &tauri::AppHandle) -> PathBuf {
    let data = data_dir(app).ok();
    engine::sidecar_with_core(&resources_dir(app), data.as_deref())
}

fn resources_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .resource_dir()
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources"))
}

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_VALUE: &str = "K4RNekoVPN";

fn autostart_enabled() -> bool {
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(RUN_KEY, KEY_READ)
        .and_then(|k| k.get_value::<String, _>(RUN_VALUE))
        .is_ok()
}

fn set_autostart(enabled: bool) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey_with_flags(RUN_KEY, KEY_WRITE)
        .map_err(|e| format!("реестр недоступен: {e}"))?;
    if enabled {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        key.set_value(RUN_VALUE, &format!("\"{}\"", exe.display()))
            .map_err(|e| format!("не удалось включить автозапуск: {e}"))
    } else {
        let _ = key.delete_value(RUN_VALUE);
        Ok(())
    }
}

#[tauri::command]
fn core_info(app: tauri::AppHandle) -> Result<CoreInfo, String> {
    Ok(CoreInfo {
        name: "K4R Neko VPN".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        core_version: engine::core_version(&core_bin(&app)),
        core_updated: data_dir(&app)
            .map(|d| engine::updated_core(&d).exists())
            .unwrap_or(false),
        platform: std::env::consts::OS.into(),
        data_dir: data_dir(&app)?.display().to_string(),
        admin: engine::is_elevated(),
        zapret_dir: zapret::detect_dir().map(|p| p.display().to_string()),
        autostart: autostart_enabled(),
    })
}

/// Адрес релиза ядра. Отдельная функция — её проверяет тест: без строгой
/// проверки версии сюда можно вписать что угодно и скачать чужой файл.
fn core_download_url(version: &str) -> Result<String, String> {
    let v = version.trim().trim_start_matches('v');
    let ok = !v.is_empty()
        && v.chars()
            .next()
            .map(|c| c.is_ascii_digit())
            .unwrap_or(false)
        && v.chars().all(|c| c.is_ascii_digit() || c == '.');
    if !ok {
        return Err(format!("не похоже на версию: {version}"));
    }
    Ok(format!(
        "https://github.com/SagerNet/sing-box/releases/download/v{v}/sing-box-{v}-windows-amd64.zip"
    ))
}

/// Последняя версия ядра по данным GitHub. Пусто — не смогли спросить.
#[tauri::command]
async fn core_latest() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(std::time::Duration::from_secs(15)))
            .user_agent("K4R-Neko-VPN/core")
            .build()
            .into();
        let body = agent
            .get("https://api.github.com/repos/SagerNet/sing-box/releases/latest")
            .call()
            .map_err(|e| format!("не удалось спросить GitHub: {e}"))?
            .into_body()
            .read_to_string()
            .map_err(|e| e.to_string())?;
        let value: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
        value
            .get("tag_name")
            .and_then(|v| v.as_str())
            .map(|t| t.trim_start_matches('v').to_string())
            .ok_or_else(|| "GitHub не назвал версию".to_string())
    })
    .await
    .map_err(|e| format!("задача упала: {e}"))?
}

/// Скачать и поставить новое ядро рядом с настройками (без прав администратора).
/// Старое не трогаем: его можно вернуть одной кнопкой.
#[tauri::command]
async fn core_update(app: tauri::AppHandle, version: String) -> Result<String, String> {
    let url = core_download_url(&version)?;
    let data = data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let work = std::env::temp_dir().join("k4r-core");
        let _ = std::fs::remove_dir_all(&work);
        std::fs::create_dir_all(&work).map_err(|e| format!("не смог создать каталог: {e}"))?;

        let zip_path = work.join("sing-box.zip");
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(std::time::Duration::from_secs(600)))
            .user_agent("K4R-Neko-VPN/core")
            .build()
            .into();
        let mut resp = agent
            .get(&url)
            .call()
            .map_err(|e| format!("не удалось скачать ядро: {e}"))?;
        let mut file = std::fs::File::create(&zip_path).map_err(|e| e.to_string())?;
        std::io::copy(&mut resp.body_mut().as_reader(), &mut file)
            .map_err(|e| format!("скачивание прервалось: {e}"))?;
        drop(file);

        // Zip распаковываем системой: тянуть ради одного архива ещё одну
        // зависимость в клиент — лишний вес и лишние обновления
        let unzip = format!(
            "Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force",
            zip_path.display(),
            work.join("out").display()
        );
        let mut unzip_cmd = std::process::Command::new("powershell");
        engine::hidden(&mut unzip_cmd);
        let status = unzip_cmd
            .args(["-NoProfile", "-NonInteractive", "-Command", &unzip])
            .status()
            .map_err(|e| format!("не смог распаковать архив: {e}"))?;
        if !status.success() {
            return Err("архив не распаковался".into());
        }

        let mut found: Option<std::path::PathBuf> = None;
        let mut stack = vec![work.join("out")];
        while let Some(dir) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else if path
                    .file_name()
                    .map(|n| n.eq_ignore_ascii_case("sing-box.exe"))
                    .unwrap_or(false)
                {
                    found = Some(path);
                }
            }
        }
        let exe = found.ok_or_else(|| "в архиве нет sing-box.exe".to_string())?;

        // Проверяем, что скачали именно ядро и именно той версии
        let got = engine::core_version(&exe);
        let want = version.trim().trim_start_matches('v').to_string();
        if got.is_empty() {
            return Err("скачанный файл не запускается как ядро".into());
        }
        if got != want {
            return Err(format!("в архиве ядро {got}, а просили {want}"));
        }

        let target = engine::updated_core(&data);
        if let Some(dir) = target.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("не смог создать каталог: {e}"))?;
        }
        std::fs::copy(&exe, &target).map_err(|e| format!("не смог положить ядро: {e}"))?;
        let _ = std::fs::remove_dir_all(&work);
        Ok(got)
    })
    .await
    .map_err(|e| format!("задача упала: {e}"))?
}

/// Вернуть встроенное ядро: обновлённое просто удаляем.
#[tauri::command]
fn core_reset(app: tauri::AppHandle) -> Result<String, String> {
    let path = engine::updated_core(&data_dir(&app)?);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("не смог удалить: {e}"))?;
    }
    Ok(engine::core_version(&core_bin(&app)))
}

#[tauri::command]
fn profiles_import(text: String) -> Result<Vec<Profile>, String> {
    subscription::import_text(&text)
}

#[tauri::command]
fn probe_ping(profiles: Vec<Profile>) -> Vec<PingResult> {
    probe::ping_all(&profiles)
}

#[tauri::command]
fn state_load(app: tauri::AppHandle) -> Result<AppState, String> {
    Ok(store::load(&data_dir(&app)?))
}

#[tauri::command]
fn state_save(app: tauri::AppHandle, mut state: AppState) -> Result<(), String> {
    let dir = data_dir(&app)?;
    // Never lose the install id: it is our device slot with the provider.
    if state.hwid.is_empty() {
        state.hwid = store::install_id(&dir);
    }
    // the UI never sends a schema: whatever it saves is already current
    state.schema = store::SCHEMA;
    store::save(&dir, &state)?;
    refresh_tray(&app);
    Ok(())
}

#[tauri::command]
fn logs_tail(app: tauri::AppHandle, which: String, lines: usize) -> Result<String, String> {
    Ok(store::tail(&data_dir(&app)?, &which, lines.clamp(10, 500)))
}

#[derive(Serialize, Clone)]
pub struct InstalledApp {
    pub exe: String,
    pub name: String,
    pub path: String,
    pub running: bool,
}

/// Exe names that are never a program the user wants to route.
const NOISE_EXE: [&str; 18] = [
    "unins",
    "uninstall",
    "setup",
    "update",
    "updater",
    "vcredist",
    "dotnet",
    "crashpad",
    "crashreporter",
    "node.exe",
    "python.exe",
    "wscript.exe",
    "jucheck",
    "jusched",
    "vctip",
    "oemdrv",
    "googleupdate",
    "msedgewebview2",
];

const NOISE_NAME: [&str; 9] = [
    "update",
    "updater",
    "installer",
    "uninstall",
    "telemetry",
    "improvement",
    "redistributable",
    "crashpad",
    "не обновля",
];

fn looks_like_program(path: &str, name: &str) -> bool {
    let lower = path.to_lowercase();
    if !lower.ends_with(".exe") || lower.contains(r"\windows\") || lower.contains(r"\temp\") {
        return false;
    }
    let exe = lower.rsplit('\\').next().unwrap_or(&lower);
    if exe.len() < 5 || exe == "k4r neko vpn.exe" {
        return false;
    }
    if NOISE_EXE.iter().any(|n| exe.starts_with(n)) {
        return false;
    }
    let n = name.to_lowercase();
    !NOISE_NAME.iter().any(|bad| n.contains(bad))
}

/// Readable program name: "discord.exe" -> "Discord", "Google Chrome" stays as is.
fn pretty_name(name: &str, exe: &str) -> String {
    let trimmed = name.trim().trim_matches('"');
    let source = if trimmed.is_empty() {
        exe.trim_end_matches(".exe")
    } else {
        trimmed
    };
    let mut chars = source.chars();
    match chars.next() {
        Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
        None => exe.trim_end_matches(".exe").to_string(),
    }
}

struct CatalogRow {
    running: bool,
    from_menu: bool,
    path: String,
    name: String,
}

/// Everything Windows knows to be installed: running processes, Start Menu
/// shortcuts and uninstall entries. One PowerShell pass, tab separated.
fn windows_catalog() -> Vec<CatalogRow> {
    const SCRIPT: &str = r#"
$ErrorActionPreference='SilentlyContinue'
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
$seen=@{}
function emit($kind,$exe,$name){
  if(-not $exe){return}
  $x=$exe.Trim('"')
  if($x -notmatch '(?i)\.exe$'){return}
  $k=$x.ToLower()
  if($seen.ContainsKey($k)){return}
  $seen[$k]=1
  "$kind`t$x`t$name"
}
Get-Process | Where-Object { $_.Path } | ForEach-Object { emit 'run' $_.Path $_.Description }
$ws=New-Object -ComObject WScript.Shell
$menus=@("$env:ProgramData\Microsoft\Windows\Start Menu\Programs","$env:APPDATA\Microsoft\Windows\Start Menu\Programs")
foreach($m in $menus){
  Get-ChildItem -LiteralPath $m -Filter *.lnk -Recurse -File | ForEach-Object {
    $t=$ws.CreateShortcut($_.FullName).TargetPath
    if($t){ emit 'menu' $t $_.BaseName }
  }
}
$keys=@('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*')
Get-ItemProperty $keys | ForEach-Object {
  $ic=$_.DisplayIcon
  if($ic){ emit 'reg' ($ic -replace ',\d+$','') $_.DisplayName }
}
"#;
    let mut scan = std::process::Command::new("powershell");
    scan.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        SCRIPT,
    ]);
    engine::hidden(&mut scan);
    let Ok(res) = scan.output() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for line in String::from_utf8_lossy(&res.stdout).lines() {
        let mut parts = line.split('\t');
        let kind = parts.next().unwrap_or("").trim().to_string();
        let path = parts
            .next()
            .unwrap_or("")
            .trim()
            .trim_matches('"')
            .to_string();
        let name = parts.next().unwrap_or("").trim().to_string();
        if path.is_empty() {
            continue;
        }
        out.push(CatalogRow {
            running: kind == "run",
            from_menu: kind == "menu",
            path,
            name,
        });
    }
    out
}

/// Programs the user can route: installed ones plus whatever is running now.
#[tauri::command]
fn apps_scan() -> Vec<InstalledApp> {
    scan_installed()
}

pub fn scan_installed() -> Vec<InstalledApp> {
    use std::collections::BTreeMap;
    let mut found: BTreeMap<String, InstalledApp> = BTreeMap::new();
    let mut names: BTreeMap<String, String> = BTreeMap::new();
    let mut menu_names: BTreeMap<String, String> = BTreeMap::new();

    for row in windows_catalog() {
        if !looks_like_program(&row.path, &row.name) || !std::path::Path::new(&row.path).is_file() {
            continue;
        }
        let exe = row
            .path
            .rsplit('\\')
            .next()
            .unwrap_or(&row.path)
            .to_lowercase();
        if !row.name.is_empty() {
            if row.from_menu {
                // the Start Menu label is what the owner sees in the Start menu
                menu_names.entry(exe.clone()).or_insert(row.name);
            } else {
                names.entry(exe.clone()).or_insert(row.name);
            }
        }
        let entry = found.entry(exe.clone()).or_insert_with(|| InstalledApp {
            running: false,
            name: String::new(),
            exe: exe.clone(),
            path: row.path.clone(),
        });
        entry.running |= row.running;
    }

    let roots = [
        (
            winreg::enums::HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths",
        ),
        (
            winreg::enums::HKEY_CURRENT_USER,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths",
        ),
    ];
    for (root, key_path) in roots {
        let Ok(key) = RegKey::predef(root).open_subkey(key_path) else {
            continue;
        };
        for sub in key.enum_keys().flatten() {
            let Ok(app) = key.open_subkey(&sub) else {
                continue;
            };
            let path: String = app.get_value::<String, _>("").unwrap_or_default();
            let path = path.trim().trim_matches('"').to_string();
            let exe = sub.to_lowercase();
            if !exe.ends_with(".exe") || !looks_like_program(&path, "") {
                continue;
            }
            found.entry(exe.clone()).or_insert(InstalledApp {
                running: false,
                name: String::new(),
                exe,
                path,
            });
        }
    }

    let mut list: Vec<InstalledApp> = found
        .into_iter()
        .map(|(exe, mut app)| {
            let known = menu_names
                .get(&exe)
                .or_else(|| names.get(&exe))
                .map(String::as_str)
                .unwrap_or("");
            app.name = pretty_name(known, &exe);
            app
        })
        .collect();
    list.sort_by(|a, b| {
        b.running
            .cmp(&a.running)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.exe.cmp(&b.exe))
    });
    list
}

/// One readable file the user can hand over when something breaks.
#[tauri::command]
fn export_log(app: tauri::AppHandle) -> Result<String, String> {
    let dir = data_dir(&app)?;
    let out_dir = dir.join("exports");
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let path = out_dir.join(format!("k4r-log-{stamp}.txt"));
    let mut text = String::new();
    text.push_str(
        "K4R Neko VPN — журнал для поддержки
",
    );
    text.push_str(&format!(
        "версия: {}
",
        env!("CARGO_PKG_VERSION")
    ));
    text.push_str(&format!(
        "админ: {}
",
        engine::is_elevated()
    ));
    text.push_str(
        "
--- engine.log ---
",
    );
    text.push_str(&store::tail(&dir, "engine", 400));
    text.push_str(
        "

--- zapret.log ---
",
    );
    text.push_str(&store::tail(&dir, "zapret", 200));
    // never include the subscription url or ids here
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

#[tauri::command]
fn set_start_with_windows(enabled: bool) -> Result<bool, String> {
    set_autostart(enabled)?;
    Ok(autostart_enabled())
}

/// Providers that gate on a device id get ours: stable per install, never impersonates
/// another client's identity.
#[tauri::command]
async fn sub_fetch(
    app: tauri::AppHandle,
    url: String,
    user_agent: String,
    headers: Vec<SubHeader>,
) -> Result<SubResult, String> {
    let hwid = store::install_id(&data_dir(&app)?);
    tauri::async_runtime::spawn_blocking(move || {
        let mut all = headers;
        if !all.iter().any(|h| h.name.eq_ignore_ascii_case("x-hwid")) {
            all.push(SubHeader {
                name: "X-HWID".into(),
                value: hwid,
            });
        }
        subscription::fetch(&url, &user_agent, &all)
    })
    .await
    .map_err(|e| format!("задача упала: {e}"))?
}

/// Копия настроек одним файлом: переезд на другой компьютер без потери списков.
/// Пишем в «Загрузки» — понятное место, которое человек найдёт без подсказок.
#[tauri::command]
fn state_export(app: tauri::AppHandle) -> Result<String, String> {
    let state = store::load(&data_dir(&app)?);
    let text =
        serde_json::to_string_pretty(&state).map_err(|e| format!("не смог собрать файл: {e}"))?;
    let home =
        std::env::var("USERPROFILE").map_err(|_| "не нашёл папку пользователя".to_string())?;
    let dir = std::path::PathBuf::from(home).join("Downloads");
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let path = dir.join(format!("k4r-neko-settings-{stamp}.json"));
    std::fs::write(&path, text).map_err(|e| format!("не смог записать файл: {e}"))?;
    Ok(path.display().to_string())
}

/// Возврат настроек из файла. Принимаем текст, а не путь: человек может вставить
/// содержимое прямо в окно, если файл далеко.
#[tauri::command]
fn state_import(app: tauri::AppHandle, text: String) -> Result<(), String> {
    let mut parsed: store::AppState =
        serde_json::from_str(&text).map_err(|e| format!("это не файл настроек: {e}"))?;
    if parsed.profiles.is_empty() && parsed.sub_url.is_empty() {
        return Err("в файле нет ни серверов, ни подписки — похоже, это не наши настройки".into());
    }
    let dir = data_dir(&app)?;
    // чужой идентификатор устройства не подставляем: он привязан к машине
    parsed.hwid = store::install_id(&dir);
    parsed.schema = store::SCHEMA;
    store::save(&dir, &parsed)
}

/// Проверка утечек DNS без чужих сервисов: `whoami.akamai.net` всегда отвечает
/// адресом того резолвера, который его спросил. Значит, если мы видим адрес
/// Cloudflare — запросы идут через наш шифрованный резолвер, а если адрес
/// провайдера — DNS течёт мимо туннеля.
#[tauri::command]
async fn dns_leak() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        use std::net::ToSocketAddrs as _;
        let resolver = ("whoami.akamai.net", 80u16)
            .to_socket_addrs()
            .map_err(|e| format!("не удалось спросить резолвер: {e}"))?
            .next()
            .map(|a| a.ip().to_string())
            .ok_or_else(|| "резолвер не ответил".to_string())?;

        // и адрес, которым нас видит интернет: без него проверка неполная
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(std::time::Duration::from_secs(8)))
            .build()
            .into();
        let mut egress = String::new();
        if let Ok(mut resp) = agent.get("https://api.ipify.org").call() {
            use std::io::Read as _;
            let mut body = String::new();
            let _ = resp
                .body_mut()
                .as_reader()
                .take(64)
                .read_to_string(&mut body);
            egress = body.trim().to_string();
        }
        Ok(serde_json::json!({ "resolver": resolver, "egress": egress }))
    })
    .await
    .map_err(|e| format!("задача упала: {e}"))?
}

/// Скачивает установщик новой версии и запускает его. Проверку версии делает
/// окно, сюда приходит уже готовый адрес.
#[tauri::command]
async fn update_download(url: String) -> Result<String, String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("ссылка должна начинаться с http:// или https://".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(std::time::Duration::from_secs(600)))
            .build()
            .into();
        let mut resp = agent
            .get(&url)
            .header("User-Agent", "K4R-Neko-VPN/update")
            .call()
            .map_err(|e| format!("не удалось скачать: {e}"))?;
        let path = std::env::temp_dir().join("k4r-neko-update.exe");
        let mut file =
            std::fs::File::create(&path).map_err(|e| format!("не смог создать файл: {e}"))?;
        std::io::copy(&mut resp.body_mut().as_reader(), &mut file)
            .map_err(|e| format!("скачивание прервалось: {e}"))?;
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        if size < 1024 * 1024 {
            let _ = std::fs::remove_file(&path);
            return Err("файл слишком маленький — похоже, это не установщик".into());
        }
        drop(file);
        launch_detached(&path)?;
        Ok(path.display().to_string())
    })
    .await
    .map_err(|e| format!("задача упала: {e}"))?
}

/// Запустить скачанный установщик и выйти: иначе Windows не даст заменить файлы.
#[tauri::command]
fn update_install(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let file = std::path::PathBuf::from(&path);
    if !file.is_file() {
        return Err("установщик не найден — скачайте обновление заново".into());
    }
    std::process::Command::new(&file)
        .spawn()
        .map_err(|e| format!("не смог запустить установщик: {e}"))?;
    // Даём установщику мгновение встать в очередь и закрываемся.
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(600));
        app.exit(0);
    });
    Ok(())
}

#[tauri::command]
fn install_id(app: tauri::AppHandle) -> Result<String, String> {
    Ok(store::install_id(&data_dir(&app)?))
}

/// Что нужно kill-switch: фактические пути движка и IP-резолверы.
///
/// Имена резолверов (DoH/DoT по имени) сюда не попадают: разрешать по имени
/// нельзя, а открывать 443 «куда угодно» — дыра. Такие резолверы работают
/// через туннель, как и раньше.
fn wfp_opts(app: &tauri::AppHandle, saved: &store::AppState) -> wfp::filters::PlanOpts {
    let mut paths = vec![core_bin(app).display().to_string()];
    let bundled = engine::sidecar_path(&resources_dir(app))
        .display()
        .to_string();
    if !paths.contains(&bundled) {
        paths.push(bundled);
    }
    let raw = saved.dns_server.trim();
    let (v4, v6) = match raw {
        _ if raw.is_empty() => (None, None),
        _ => match raw.parse::<std::net::IpAddr>() {
            Ok(std::net::IpAddr::V4(ip)) => (Some(ip), None),
            Ok(std::net::IpAddr::V6(ip)) => (None, Some(ip)),
            _ => (None, None),
        },
    };
    wfp::filters::PlanOpts {
        engine_paths: paths,
        resolver_v4: v4,
        resolver_v6: v6,
        // DoT/DoH по имени не разрешаем: нет IP — нет правила
        dot: false,
        doh_v4: None,
        doh_v6: None,
    }
}

/// Самодиагностика kill-switch: 7 автопроверок вместо ручного чек-листа.
#[tauri::command]
fn kill_switch_selfcheck(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let saved = store::load(&data_dir(&app)?);
    let running = matches!(
        engine::poll(&app.state::<engine::Engine>()).state,
        engine::EngineState::Running
    );
    let checks = wfp::selfcheck::run(wfp::selfcheck::Ctx {
        opts: wfp_opts(&app, &saved),
        engine_running: running,
    });
    Ok(serde_json::json!(checks
        .into_iter()
        .map(|c| serde_json::json!({
            "id": c.id,
            "title": c.title,
            "ok": c.ok,
            "detail": c.detail,
        }))
        .collect::<Vec<_>>()))
}

/// История автовыбора лежит отдельно от состояния: её пишет и читает только
/// приложение, а общий `state_save` не должен её затирать.
fn auto_history_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("auto_history.json"))
}

/// Оркестратор: что мы знаем про пары «сервер + транспорт».
/// Показать, что лежит в папке zapret, ничего там не меняя.
#[tauri::command]
fn zapret_scan(dir: String) -> zapret_lists::Scan {
    zapret_lists::scan(&dir)
}

/// Превратить списки zapret в наши правила маршрутизации.
#[tauri::command]
fn zapret_import(dir: String, include_ips: bool) -> zapret_lists::Imported {
    zapret_lists::import(&dir, include_ips)
}

#[tauri::command]
fn orchestrator_list(app: tauri::AppHandle) -> Result<Vec<orchestrator::Row>, String> {
    let dir = data_dir(&app)?;
    Ok(orchestrator::rows(&orchestrator::load(&dir)))
}

#[tauri::command]
fn orchestrator_record(
    app: tauri::AppHandle,
    key: String,
    success: bool,
    latency_ms: u32,
) -> Result<Vec<orchestrator::Row>, String> {
    let dir = data_dir(&app)?;
    Ok(orchestrator::record(&dir, &key, success, latency_ms))
}

#[tauri::command]
fn orchestrator_reset(app: tauri::AppHandle) -> Result<Vec<orchestrator::Row>, String> {
    let dir = data_dir(&app)?;
    Ok(orchestrator::reset(&dir))
}

#[tauri::command]
fn auto_history_get(app: tauri::AppHandle) -> Vec<String> {
    let Ok(path) = auto_history_path(&app) else {
        return Vec::new();
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str::<Vec<String>>(&t).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn auto_history_add(app: tauri::AppHandle, line: String) -> Vec<String> {
    let Ok(path) = auto_history_path(&app) else {
        return Vec::new();
    };
    let mut list = auto_history_get(app.clone());
    list.push(line);
    // Храним последние 10: больше в настройках всё равно не покажем.
    while list.len() > 10 {
        list.remove(0);
    }
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(text) = serde_json::to_string_pretty(&list) {
        let _ = std::fs::write(path, text);
    }
    list
}

#[tauri::command]
fn kill_switch_status() -> wfp::Status {
    wfp::status()
}

/// Включить/выключить защиту на уровне ОС.
#[tauri::command]
fn kill_switch_set(app: tauri::AppHandle, on: bool) -> Result<wfp::Status, String> {
    if !on {
        wfp::disable()?;
        return Ok(wfp::status());
    }
    let saved = store::load(&data_dir(&app)?);
    let opts = wfp_opts(&app, &saved);
    wfp::enable(opts).map_err(|e| {
        let _ = engine::write_log_header(
            &data_dir(&app)
                .unwrap_or_default()
                .join("logs")
                .join("killswitch.log"),
            &format!("не смог включить kill-switch: {e}"),
        );
        e
    })
}

#[tauri::command]
fn engine_start(
    app: tauri::AppHandle,
    engine: State<'_, engine::Engine>,
    profile: Profile,
    excluded: Vec<String>,
    dns: String,
    mode: Option<String>,
    via: Option<Vec<String>>,
) -> Result<engine::EngineStatus, String> {
    let bin = core_bin(&app);
    let log_path = data_dir(&app)?.join("logs").join("engine.log");
    engine::write_log_header(
        &log_path,
        &format!("start {}:{} ({})", profile.host, profile.port, profile.name),
    );

    let saved = store::load(&data_dir(&app)?);
    let opts = engine::NetOptions {
        dns_mode: if saved.dns_mode.is_empty() {
            "tunnel".into()
        } else {
            saved.dns_mode.clone()
        },
        block_ipv6: saved.block_ipv6,
        dns_server: if !dns.trim().is_empty() {
            dns.trim().to_string()
        } else if !saved.dns_server.trim().is_empty() {
            saved.dns_server.trim().to_string()
        } else {
            "1.1.1.1".to_string()
        },
        api_port: engine::free_port(),
        api_secret: engine::api_secret(),
        split_mode: mode
            .filter(|m| m == "only" || m == "all")
            .unwrap_or_else(|| {
                if saved.split_mode.is_empty() {
                    "only".into()
                } else {
                    saved.split_mode.clone()
                }
            }),
        gateway: engine::default_gateway(),
        // Telegram-style manual proxy: fixed port so the app can tell the user
        // exactly what to type into the messenger, and only when asked for
        tg_port: if saved.tg_proxy { saved.tg_port } else { 0 },
        tunnel_apps: match via {
            Some(list) => list,
            None => saved
                .split
                .iter()
                .filter(|s| s.via)
                .map(|s| s.exe.clone())
                .collect(),
        },
        rules: saved.rules.clone(),
        route_ru_direct: saved.route_ru_direct,
        route_block_ads: saved.route_block_ads,
        game_mode: saved.game_mode,
        game_ports: if saved.game_ports.is_empty() {
            engine::GAME_PORTS.iter().map(|p| p.to_string()).collect()
        } else {
            saved.game_ports.clone()
        },
        // Кэш списков рядом с данными приложения: папка установки только для чтения
        cache_path: data_dir(&app)?.join("rule-sets.db").display().to_string(),
    };
    // Защита на уровне ОС ставится ДО движка: иначе есть окно, в котором
    // туннель ещё не поднят, а трафик уже не должен уходить наружу.
    if saved.kill_switch {
        match wfp::enable(wfp_opts(&app, &saved)) {
            Ok(st) => engine::write_log_header(
                &log_path,
                &format!("kill-switch: активен, фильтров {}", st.filters),
            ),
            Err(e) => {
                // Туннель всё равно поднимем: TUN-защита при обрыве работает,
                // но человек должен видеть, что ОС-блокировка не встала.
                engine::write_log_header(&log_path, &format!("kill-switch не включился: {e}"));
            }
        }
    }
    *engine.api.lock().unwrap() = Some((opts.api_port, opts.api_secret.clone()));
    *engine.last_sample.lock().unwrap() = None;

    // Honesty over a pretty status: a tunnel that carries nothing must not be
    // reported as protection. It also spares the machine a pointless adapter.
    if opts.split_mode == "only" && opts.tunnel_apps.is_empty() {
        return Err(
            "список «В VPN» пуст: добавь хотя бы одну программу, иначе туннель ничего не защищает"
                .into(),
        );
    }

    let config = engine::build_config(&profile, &excluded, &opts);
    let status = engine::start(&engine, &bin, &config, &log_path, &profile.name)?;
    supervise(app, saved.reconnect, saved.kill_switch);
    Ok(status)
}

/// Watches the engine: three silent retries, then an honest error in the UI.
fn supervise(app: tauri::AppHandle, reconnect: bool, kill_switch: bool) {
    std::thread::spawn(move || {
        let engine = app.state::<engine::Engine>();
        let mut attempts: u32 = 0;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(1200));
            if !engine.wanted.load(std::sync::atomic::Ordering::SeqCst) {
                break;
            }
            let st = engine::poll(&engine);
            match st.state {
                engine::EngineState::Idle => break,
                engine::EngineState::Error if reconnect && attempts < 3 => {
                    attempts += 1;
                    let bin = core_bin(&app);
                    let log_path = match data_dir(&app) {
                        Ok(d) => d.join("logs").join("engine.log"),
                        Err(_) => break,
                    };
                    // Kill switch: no packet may slip out in the clear while we retry.
                    if kill_switch && engine::start_hold(&engine, &bin, &log_path) {
                        let _ = app.emit(
                            "engine-event",
                            engine::EngineStatus {
                                state: engine::EngineState::Starting,
                                message: format!("туннель упал, интернет придержан ({attempts}/3)"),
                                server: st.server.clone(),
                                pid: 0,
                            },
                        );
                    }
                    let _ = app.emit(
                        "engine-event",
                        engine::EngineStatus {
                            state: engine::EngineState::Starting,
                            message: format!("переподключаемся ({attempts}/3)"),
                            server: st.server.clone(),
                            pid: 0,
                        },
                    );
                    std::thread::sleep(std::time::Duration::from_millis(1400));
                    if !engine.wanted.load(std::sync::atomic::Ordering::SeqCst) {
                        break;
                    }
                    match engine::respawn(&engine, &bin, &log_path, &st.server) {
                        Ok(ok) => {
                            attempts = 0;
                            engine::stop_hold(&engine);
                            let _ = app.emit("engine-event", ok);
                        }
                        Err(e) => {
                            let _ = app.emit(
                                "engine-event",
                                engine::EngineStatus {
                                    state: engine::EngineState::Error,
                                    message: format!("переподключение не удалось: {e}"),
                                    server: st.server.clone(),
                                    pid: 0,
                                },
                            );
                        }
                    }
                }
                engine::EngineState::Error => {
                    let mut message = st.message.clone();
                    if kill_switch {
                        let bin = core_bin(&app);
                        if let Ok(d) = data_dir(&app) {
                            if engine::start_hold(&engine, &bin, &d.join("logs").join("engine.log"))
                            {
                                message = format!(
                                    "{message}. Интернет удерживается: нажми «Отключить VPN»"
                                );
                            }
                        }
                    }
                    let _ = app.emit(
                        "engine-event",
                        engine::EngineStatus {
                            state: engine::EngineState::Error,
                            message,
                            server: st.server.clone(),
                            pid: 0,
                        },
                    );
                    break;
                }
                _ => {
                    attempts = 0;
                }
            }
        }
    });
}

#[tauri::command]
fn engine_stop(
    app: tauri::AppHandle,
    engine: State<'_, engine::Engine>,
    release: Option<bool>,
) -> engine::EngineStatus {
    let status = engine::stop(&engine);
    // Переподключение (release = false) не должно открывать интернет даже на
    // мгновение: блокировка остаётся. Явное «Отключить» — снимает.
    if release.unwrap_or(true) {
        let saved = store::load(&data_dir(&app).unwrap_or_default());
        if saved.kill_switch {
            let _ = wfp::disable();
        }
    }
    status
}

/// Ставит следующий сервер из подписки, пропуская уже проверенные.
/// Выбор владельца не перезаписываем: это обход на время, а не новая настройка.
fn switch_server(app: &tauri::AppHandle, skip: usize) -> Result<(), String> {
    let dir = data_dir(app)?;
    let mut saved = store::load(&dir);
    let len = saved.profiles.len();
    let current = saved
        .profiles
        .iter()
        .position(|p| p.id == saved.selected)
        .unwrap_or(0);
    let Some(idx) = health::next_index(current, len, skip) else {
        return Err("других серверов нет".into());
    };
    saved.selected = saved.profiles[idx].id.clone();
    let profile = saved.profiles[idx].clone();
    let excluded: Vec<String> = saved
        .split
        .iter()
        .filter(|e| !e.via)
        .map(|e| e.exe.clone())
        .collect();
    let via: Vec<String> = saved
        .split
        .iter()
        .filter(|e| e.via)
        .map(|e| e.exe.clone())
        .collect();
    let dns = if saved.dns_mode == "tunnel" {
        saved.dns_server.clone()
    } else {
        String::new()
    };
    {
        let state = app.state::<engine::Engine>();
        let _ = engine::stop(&state);
    }
    std::thread::sleep(std::time::Duration::from_millis(300));
    let state = app.state::<engine::Engine>();
    engine_start(
        app.clone(),
        state,
        profile,
        excluded,
        dns,
        Some(saved.split_mode.clone()),
        Some(via),
    )?;
    Ok(())
}

/// Поднимает туннель из сохранённого состояния: то же, что кнопка, но без окна.
/// Нужно автоподключению при запуске и сторожу сети — оба работают, когда
/// интерфейс ещё не нарисован.
fn connect_saved(app: &tauri::AppHandle) -> Result<(), String> {
    let dir = data_dir(app)?;
    let saved = store::load(&dir);
    let busy = {
        let state = app.state::<engine::Engine>();
        engine::poll(&state).state == engine::EngineState::Running
    };
    if !store::should_autoconnect(true, saved.profiles.len(), busy) {
        return Ok(());
    }
    let profile = saved
        .profiles
        .iter()
        .find(|p| p.id == saved.selected)
        .or_else(|| saved.profiles.first())
        .cloned()
        .ok_or_else(|| "нет серверов".to_string())?;
    let excluded: Vec<String> = saved
        .split
        .iter()
        .filter(|e| !e.via)
        .map(|e| e.exe.clone())
        .collect();
    let via: Vec<String> = saved
        .split
        .iter()
        .filter(|e| e.via)
        .map(|e| e.exe.clone())
        .collect();
    let dns = if saved.dns_mode == "tunnel" {
        saved.dns_server.clone()
    } else {
        String::new()
    };
    let state = app.state::<engine::Engine>();
    engine_start(
        app.clone(),
        state,
        profile,
        excluded,
        dns,
        Some(saved.split_mode.clone()),
        Some(via),
    )?;
    Ok(())
}

#[derive(serde::Serialize)]
struct UpdateInfo {
    version: String,
    url: String,
    notes: String,
}

/// Reads a tiny manifest: {"version": "0.3.1", "url": "https://...", "notes": "..."}
/// Returns None when the version we already have is the newest.
#[tauri::command]
fn update_check(manifest_url: String, current: String) -> Result<Option<UpdateInfo>, String> {
    let url = manifest_url.trim();
    if url.is_empty() {
        return Err("адрес проверки обновлений не задан".into());
    }
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(8)))
        .user_agent("K4R-Neko-VPN/update")
        .build()
        .new_agent();
    let body = agent
        .get(url)
        .call()
        .map_err(|e| format!("не удалось проверить обновления: {e}"))?
        .into_body()
        .read_to_string()
        .map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("ответ не похож на описание версии: {e}"))?;
    let version = value["version"].as_str().unwrap_or("").trim().to_string();
    if version.is_empty() {
        return Err("в описании версии нет поля version".into());
    }
    if version == current.trim() {
        return Ok(None);
    }
    Ok(Some(UpdateInfo {
        version,
        url: value["url"].as_str().unwrap_or("").to_string(),
        notes: value["notes"].as_str().unwrap_or("").to_string(),
    }))
}

/// The address the internet sees right now. While the tunnel is up the whole
/// machine goes through it, so this is the VPN address; when it is down it is the
/// provider's. No guessing: if the request fails, the caller shows nothing.
#[tauri::command]
async fn my_ip() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(std::time::Duration::from_secs(8)))
            .build()
            .into();
        let mut resp = agent
            .get("https://api.ipify.org")
            .call()
            .map_err(|e| format!("не удалось узнать адрес: {e}"))?;
        let mut body = String::new();
        use std::io::Read as _;
        resp.body_mut()
            .as_reader()
            .take(64)
            .read_to_string(&mut body)
            .map_err(|e| format!("не удалось прочитать ответ: {e}"))?;
        let ip = body.trim().to_string();
        if ip.is_empty() {
            return Err("сервис не вернул адрес".into());
        }
        Ok(ip)
    })
    .await
    .map_err(|e| format!("задача упала: {e}"))?
}

#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Opens a link in the default browser. Console stays hidden.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("ссылка должна начинаться с http".into());
    }
    let mut cmd = std::process::Command::new("cmd");
    cmd.args(["/c", "start", "", &url]);
    engine::hidden(&mut cmd);
    cmd.spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize, Default, Clone)]
struct DayTraffic {
    down: u64,
    up: u64,
}

fn stats_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(data_dir(app)?.join("stats.json"))
}

fn stats_load(app: &tauri::AppHandle) -> std::collections::BTreeMap<String, DayTraffic> {
    stats_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

/// Расход за день: прибавляем разницу счётчиков движка. Пишем по дню, потому что
/// «сколько за неделю» человеку важнее, чем «сколько за всё время».
/// Прибавка к одному дню. Вынесено отдельно от файла, чтобы это можно было
/// проверить тестом: арифметика дня — единственное место, где легко ошибиться.
fn day_merge(
    map: &mut std::collections::BTreeMap<String, DayTraffic>,
    day: &str,
    down: u64,
    up: u64,
) -> Result<(), String> {
    if down == 0 && up == 0 {
        return Ok(());
    }
    if day.len() != 10 || day.as_bytes().get(4) != Some(&b'-') {
        return Err("день должен быть в виде 2026-11-15".into());
    }
    let entry = map.entry(day.to_string()).or_default();
    entry.down = entry.down.saturating_add(down);
    entry.up = entry.up.saturating_add(up);
    // держим два месяца: больше в окне не помещается и не нужно
    while map.len() > 62 {
        let oldest = map.keys().next().cloned();
        match oldest {
            Some(k) => {
                map.remove(&k);
            }
            None => break,
        }
    }
    Ok(())
}

#[tauri::command]
fn stats_add(app: tauri::AppHandle, day: String, down: u64, up: u64) -> Result<(), String> {
    let mut map = stats_load(&app);
    day_merge(&mut map, &day, down, up)?;
    if down == 0 && up == 0 {
        return Ok(());
    }
    let text = serde_json::to_string(&map).map_err(|e| e.to_string())?;
    std::fs::write(stats_path(&app)?, text)
        .map_err(|e| format!("не смог сохранить статистику: {e}"))
}

#[tauri::command]
fn stats_read(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let map = stats_load(&app);
    let mut days: Vec<serde_json::Value> = map
        .into_iter()
        .map(|(day, v)| serde_json::json!({ "day": day, "down": v.down, "up": v.up }))
        .collect();
    days.reverse();
    Ok(serde_json::Value::Array(days))
}

/// Что настроено в самом Zapret: DNS и прокси для Telegram. Только чтение — мы
/// никогда не меняем чужие настройки, но человеку полезно видеть оба клиента.
#[tauri::command]
fn zapret_settings(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let saved = store::load(&data_dir(&app)?);
    let dir = if saved.zapret_dir.trim().is_empty() {
        zapret::detect_dir().unwrap_or_default()
    } else {
        std::path::PathBuf::from(saved.zapret_dir.trim())
    };
    if dir.as_os_str().is_empty() || !dir.exists() {
        return Err("папка Zapret не найдена — укажи её на вкладке «Защита туннеля»".into());
    }
    let rows = zapret::read_settings(&dir);
    let json_of = |section: &str| -> serde_json::Value {
        rows.iter()
            .find(|(name, _)| name == section)
            .and_then(|(_, payload)| serde_json::from_str::<serde_json::Value>(payload).ok())
            .unwrap_or(serde_json::Value::Null)
    };
    let dns = json_of("dns");
    let tg = json_of("telegram_proxy");
    Ok(serde_json::json!({
        "dir": dir.display().to_string(),
        "dns": {
            "doh_enabled": dns.get("doh_enabled").cloned().unwrap_or(serde_json::Value::Bool(false)),
            "custom_servers": dns.get("custom_servers").cloned().unwrap_or(serde_json::json!([])),
        },
        "telegram": {
            "enabled": tg.get("enabled").cloned().unwrap_or(serde_json::Value::Bool(false)),
            "mode": tg.get("mode").cloned().unwrap_or(serde_json::Value::Null),
            "port": tg.get("port").cloned().unwrap_or(serde_json::Value::Null),
            "host": tg.get("host").cloned().unwrap_or(serde_json::Value::Null),
        }
    }))
}

/// Замер скорости честный: качаем настоящий файл и считаем байты в секунду.
/// Пока туннель поднят, запрос идёт через него — значит скорость его и мерим.
#[tauri::command]
async fn speed_test() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(std::time::Duration::from_secs(5)))
            .build()
            .into();
        // маленький прогрев: TLS-рукопожатие не должно попасть в замер
        let _ = agent
            .get("https://speed.cloudflare.com/__down?bytes=1000")
            .call();
        let started = std::time::Instant::now();
        let mut resp = agent
            .get("https://speed.cloudflare.com/__down?bytes=10000000")
            .call()
            .map_err(|e| format!("не удалось скачать: {e}"))?;
        let mut buf = vec![0u8; 64 * 1024];
        let mut total: u64 = 0;
        use std::io::Read as _;
        let mut reader = resp.body_mut().as_reader();
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => total += n as u64,
                Err(e) => return Err(format!("скачивание прервалось: {e}")),
            }
        }
        let secs = started.elapsed().as_secs_f64().max(0.001);
        let mbps = total as f64 / 1024.0 / 1024.0 / secs;
        Ok(serde_json::json!({
            "bytes": total,
            "seconds": secs,
            "mbytes_per_second": mbps,
        }))
    })
    .await
    .map_err(|e| format!("задача упала: {e}"))?
}

/// Запускает файл отвязанно от нашего процесса: установщик не должен умереть
/// вместе с клиентом, который его скачал.
fn launch_detached(path: &std::path::Path) -> Result<(), String> {
    let mut cmd = std::process::Command::new(path);
    engine::hidden(&mut cmd);
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("не смог запустить установщик: {e}"))
}

#[tauri::command]
fn engine_traffic(engine: State<'_, engine::Engine>) -> engine::Traffic {
    engine::traffic(&engine)
}

#[tauri::command]
fn engine_status(engine: State<'_, engine::Engine>) -> engine::EngineStatus {
    engine::poll(&engine)
}

#[tauri::command]
fn app_is_admin() -> bool {
    engine::is_elevated()
}

#[tauri::command]
fn app_relaunch_admin(app: tauri::AppHandle) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut relaunch = std::process::Command::new("powershell");
    relaunch.args([
        "-NoProfile",
        "-Command",
        &format!("Start-Process -FilePath '{}' -Verb RunAs", exe.display()),
    ]);
    engine::hidden(&mut relaunch);
    relaunch
        .spawn()
        .map_err(|e| format!("не удалось запросить повышение прав: {e}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn zapret_detect() -> Option<String> {
    zapret::detect_dir().map(|p| p.display().to_string())
}

#[tauri::command]
fn zapret_presets(dir: String) -> Vec<String> {
    zapret::list_presets(&PathBuf::from(dir))
}

#[tauri::command]
fn zapret_status(app: tauri::AppHandle, state: State<'_, zapret::Zapret>) -> zapret::ZapretStatus {
    let status = zapret::poll(&state);
    if status.state == zapret::ZapretState::Off && zapret::external_instance_running() {
        return zapret::ZapretStatus {
            state: zapret::ZapretState::External,
            message: "Zapret уже запущен другой программой — мы его не трогаем".into(),
            preset: String::new(),
            pid: 0,
            dir: zapret::detect_dir()
                .map(|p| p.display().to_string())
                .unwrap_or_default(),
        };
    }
    let _ = app;
    status
}

#[tauri::command]
fn zapret_start(
    app: tauri::AppHandle,
    state: State<'_, zapret::Zapret>,
    dir: String,
    preset: String,
) -> Result<zapret::ZapretStatus, String> {
    let log_path = data_dir(&app)?.join("logs").join("zapret.log");
    zapret::start(&state, &PathBuf::from(dir), &preset, &log_path)
}

#[tauri::command]
fn zapret_stop(state: State<'_, zapret::Zapret>) -> zapret::ZapretStatus {
    zapret::stop(&state)
}

#[tauri::command]
fn set_tray_state(app: tauri::AppHandle, state: String) -> Result<(), String> {
    let bytes: &[u8] = match state.as_str() {
        "on" => include_bytes!("../icons/tray/tray_on_32.png"),
        "connecting" => include_bytes!("../icons/tray/tray_connecting_32.png"),
        "error" => include_bytes!("../icons/tray/tray_error_32.png"),
        _ => include_bytes!("../icons/tray/tray_off_32.png"),
    };
    let icon = tauri::image::Image::from_bytes(bytes).map_err(|e| e.to_string())?;
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_icon(Some(icon)).map_err(|e| e.to_string())?;
    }
    // подсказка говорит то же, что и значок: состояние и сервер
    refresh_tray(&app);
    Ok(())
}

#[cfg(windows)]
mod win32 {
    #[link(name = "user32")]
    extern "system" {
        pub fn IsIconic(hwnd: isize) -> i32;
        pub fn ShowWindow(hwnd: isize, cmd: i32) -> i32;
    }
    pub const SW_HIDE: i32 = 0;
}

/// Small poll instead of an event: WebView2 often swallows the minimise event,
/// and the owner asked for the same behaviour as the close button. Tauri's own
/// is_minimized() is not reliable here either, so Windows is asked directly.
fn watch_minimize(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(350));
        let Some(win) = app.get_webview_window("main") else {
            return;
        };
        let to_tray = data_dir(&app)
            .map(|d| store::load(&d).minimize_to_tray)
            .unwrap_or(true);
        if !to_tray {
            continue;
        }
        #[cfg(windows)]
        {
            if let Ok(hwnd) = win.hwnd() {
                let h = hwnd.0 as isize;
                if unsafe { win32::IsIconic(h) } != 0 {
                    unsafe {
                        win32::ShowWindow(h, win32::SW_HIDE);
                    }
                }
            }
        }
        #[cfg(not(windows))]
        {
            if win.is_minimized().unwrap_or(false) {
                let _ = win.hide();
            }
        }
    });
}

/// Меню трея: быстрые серверы сверху, дальше окно и выход.
/// Собирается заново, когда меняется список серверов, — иначе в меню остались
/// бы серверы из первой подписки.
fn tray_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let show = MenuItem::with_id(app, "show", "Показать окно", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let saved = data_dir(app).map(|d| store::load(&d)).unwrap_or_default();
    let mut items: Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>> = Vec::new();
    if let Ok(head) = MenuItem::with_id(app, "srv_head", "Серверы", false, None::<&str>) {
        items.push(Box::new(head));
    }
    // шесть — это столько строк, сколько видно в меню без прокрутки
    for (i, p) in saved.profiles.iter().take(6).enumerate() {
        let mark = if p.id == saved.selected {
            "● "
        } else {
            "   "
        };
        let label = format!("{mark}{}", p.name);
        if let Ok(item) = CheckMenuItem::with_id(
            app,
            format!("srv:{i}"),
            label,
            true,
            p.id == saved.selected,
            None::<&str>,
        ) {
            items.push(Box::new(item));
        }
    }
    if !items.is_empty() {
        items.push(Box::new(PredefinedMenuItem::separator(app)?));
    }
    let refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
        items.iter().map(|b| b.as_ref()).collect();
    let mut all: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = refs;
    all.push(&show);
    all.push(&quit);
    Menu::with_items(app, &all)
}

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let menu = tray_menu(app)?;
    TrayIconBuilder::with_id("main")
        .icon(tauri::image::Image::from_bytes(include_bytes!(
            "../icons/tray/tray_off_32.png"
        ))?)
        .tooltip(tray_tooltip(app))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let id = event.id.as_ref();
            if id == "show" {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
                return;
            }
            if id == "quit" {
                app.exit(0);
                return;
            }
            // «● Сервер» из меню: выбрать его и поднять туннель
            if let Some(rest) = id.strip_prefix("srv:") {
                if let Ok(idx) = rest.parse::<usize>() {
                    if let Err(e) = pick_server(app, idx) {
                        eprintln!("сервер из трея не поднялся: {e}");
                    }
                }
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(w) = tray.app_handle().get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
            }
        })
        .build(app)?;
    Ok(())
}

/// Подсказка трея: состояние, сервер и сколько ушло за сегодня. Всё это уже
/// есть в состоянии приложения, так что ничего лишнего не считаем.
fn tray_tooltip(app: &tauri::AppHandle) -> String {
    let Ok(dir) = data_dir(app) else {
        return "K4R Neko VPN".into();
    };
    let saved = store::load(&dir);
    let name = saved
        .profiles
        .iter()
        .find(|p| p.id == saved.selected)
        .map(|p| p.name.clone())
        .unwrap_or_default();
    let state = {
        let st = app.state::<engine::Engine>();
        engine::poll(&st).state
    };
    let head = match state {
        engine::EngineState::Running => "Защищено",
        engine::EngineState::Starting => "Подключается",
        engine::EngineState::Error => "Ошибка",
        engine::EngineState::Idle => "Выключено",
    };
    let mut text = format!("K4R Neko VPN — {head}");
    if !name.is_empty() && state == engine::EngineState::Running {
        text.push_str(&format!(" · {name}"));
    }
    text
}

/// Ставит сервер по номеру из меню трея и поднимает туннель.
fn pick_server(app: &tauri::AppHandle, idx: usize) -> Result<(), String> {
    let dir = data_dir(app)?;
    let mut saved = store::load(&dir);
    let profile = saved
        .profiles
        .get(idx)
        .cloned()
        .ok_or_else(|| "такого сервера больше нет".to_string())?;
    saved.selected = profile.id.clone();
    store::save(&dir, &saved).map_err(|e| format!("не смог сохранить выбор: {e}"))?;
    let excluded: Vec<String> = saved
        .split
        .iter()
        .filter(|e| !e.via)
        .map(|e| e.exe.clone())
        .collect();
    let via: Vec<String> = saved
        .split
        .iter()
        .filter(|e| e.via)
        .map(|e| e.exe.clone())
        .collect();
    let dns = if saved.dns_mode == "tunnel" {
        saved.dns_server.clone()
    } else {
        String::new()
    };
    {
        let state = app.state::<engine::Engine>();
        let _ = engine::stop(&state);
    }
    let state = app.state::<engine::Engine>();
    engine_start(
        app.clone(),
        state,
        profile,
        excluded,
        dns,
        Some(saved.split_mode.clone()),
        Some(via),
    )?;
    Ok(())
}

/// Что в меню трея сейчас: сколько серверов и какой выбран. Меню пересобираем
/// только когда это меняется — иначе оно дёргалось бы на каждом сохранении.
static TRAY_KEY: std::sync::Mutex<(usize, String)> = std::sync::Mutex::new((0, String::new()));

/// Обновляет подсказку и меню трея, не пересоздавая значок.
fn refresh_tray(app: &tauri::AppHandle) {
    let Some(tray) = app.tray_by_id("main") else {
        return;
    };
    let _ = tray.set_tooltip(Some(tray_tooltip(app)));
    let key = data_dir(app)
        .map(|d| {
            let saved = store::load(&d);
            (saved.profiles.len(), saved.selected.clone())
        })
        .unwrap_or((0, String::new()));
    let changed = {
        let mut last = TRAY_KEY.lock().unwrap();
        if *last == key {
            false
        } else {
            *last = key;
            true
        }
    };
    if changed {
        if let Ok(menu) = tray_menu(app) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Второй экземпляр не должен поднимать второе ядро: он просто показывает
    // окно первого и выходит. Порт-сторож держится, пока жив процесс.
    let single = match single::acquire(single::PORT) {
        Some(guard) => guard,
        None => {
            single::wake_existing(single::PORT);
            return;
        }
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .manage(engine::Engine::default())
        .manage(zapret::Zapret::default())
        .setup(move |app| {
            let handle = app.handle().clone();
            single::serve(single, move || {
                let outer = handle.clone();
                let inner = handle.clone();
                let _ = outer.run_on_main_thread(move || {
                    if let Some(win) = inner.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.unminimize();
                        let _ = win.set_focus();
                    }
                });
            });
            build_tray(app.handle())?;
            // Если защита уже стояла (helper пережил прошлый запуск) — обновляем
            // её параметры под текущие настройки, а не оставляем старые.
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let Ok(dir) = data_dir(&handle) else { return };
                    let saved = store::load(&dir);
                    // Kill-switch включён в настройках → защита обязана стоять и
                    // после перезагрузки: включаем её, даже если helper'а нет
                    // (enable поднимет его и поставит задачу на вход в Windows).
                    if saved.kill_switch {
                        let opts = wfp_opts(&handle, &saved);
                        let _ = wfp::enable(opts);
                    }
                });
            }
            // Надзор за helper'ом: упал — поднимаем; не смогли — UI красит
            // плашку в красный и честно пишет, что защита снята.
            {
                let handle = app.handle().clone();
                std::mem::forget(wfp::supervise(move |event| {
                    let label = match event {
                        wfp::Event::Restarting => "restarting",
                        wfp::Event::Restored => "on",
                        wfp::Event::Lost(_) => "lost",
                    };
                    let _ = handle.emit("killswitch", label);
                }));
            }
            // Zapret — часть нашей работы, а не отдельная программа: если
            // владелец попросил, поднимаем его сами при запуске.
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let dir = match data_dir(&handle) {
                        Ok(d) => d,
                        Err(_) => return,
                    };
                    let saved = store::load(&dir);
                    if !saved.zapret_auto {
                        return;
                    }
                    let zap_dir = if saved.zapret_dir.trim().is_empty() {
                        zapret::detect_dir()
                    } else {
                        Some(std::path::PathBuf::from(saved.zapret_dir.trim()))
                    };
                    let Some(zap_dir) = zap_dir else { return };
                    if !zapret::looks_like_zapret(&zap_dir) {
                        return;
                    }
                    // Чужой запущенный winws2 не трогаем: им управляет человек
                    if zapret::external_instance_running() {
                        return;
                    }
                    let presets = zapret::list_presets(&zap_dir);
                    let preset = if presets.iter().any(|p| p == &saved.zapret_preset) {
                        saved.zapret_preset.clone()
                    } else {
                        presets.first().cloned().unwrap_or_default()
                    };
                    if preset.is_empty() {
                        return;
                    }
                    let log = dir.join("logs").join("zapret.log");
                    let state = handle.state::<zapret::Zapret>();
                    let _ = zapret::start(&state, &zap_dir, &preset, &log);
                });
            }
            // Деградация: туннель формально поднят, а данные не идут —
            // переключаемся на следующий сервер сами, а не ждём владельца.
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let mut fails: u8 = 0;
                    let mut skip: usize = 0;
                    loop {
                        std::thread::sleep(health::CHECK_EVERY);
                        let running = {
                            let state = handle.state::<engine::Engine>();
                            engine::poll(&state).state == engine::EngineState::Running
                        };
                        if !running {
                            fails = 0;
                            skip = 0;
                            continue;
                        }
                        if health::healthy() {
                            fails = 0;
                            skip = 0;
                            continue;
                        }
                        fails += 1;
                        if fails < health::FAILS_TO_SWITCH {
                            continue;
                        }
                        fails = 0;
                        if let Err(e) = switch_server(&handle, skip) {
                            eprintln!("переключение на другой сервер не удалось: {e}");
                        }
                        skip = skip.saturating_add(1);
                        std::thread::sleep(health::AFTER_SWITCH);
                    }
                });
            }
            // Смена сети: туннель держится за старый маршрут и после переезда
            // на другой Wi-Fi или кабель молча умирает. Перезапускаем его,
            // если он был поднят — но не включаем, если человек его выключил.
            {
                let handle = app.handle().clone();
                netwatch::watch(move || {
                    let running = {
                        let state = handle.state::<engine::Engine>();
                        engine::poll(&state).state == engine::EngineState::Running
                    };
                    if !running {
                        return;
                    }
                    {
                        let state = handle.state::<engine::Engine>();
                        let _ = engine::stop(&state);
                    }
                    std::thread::sleep(std::time::Duration::from_millis(400));
                    if let Err(e) = connect_saved(&handle) {
                        eprintln!("после смены сети не переподключились: {e}");
                    }
                });
            }
            // Туннель поднимаем после старта, чтобы окно успело появиться:
            // подключение занимает секунды, и пустое окно всё это время
            // выглядело бы зависшим.
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let enabled = data_dir(&handle)
                        .map(|d| store::load(&d).connect_on_start)
                        .unwrap_or(false);
                    if !enabled {
                        return;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                    if let Err(e) = connect_saved(&handle) {
                        eprintln!("автоподключение не удалось: {e}");
                    }
                });
            }
            watch_minimize(app.handle().clone());
            // the X button hides to tray unless the user asked for a real quit
            if let Some(win) = app.get_webview_window("main") {
                let target = win.clone();
                let handle = app.handle().clone();
                win.on_window_event(move |event| match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        let to_tray = data_dir(&handle)
                            .map(|d| store::load(&d).close_to_tray)
                            .unwrap_or(true);
                        if to_tray {
                            api.prevent_close();
                            let _ = target.hide();
                        }
                    }
                    // Windows does not reliably report the minimise as a window
                    // event, so the watcher below does the real work.
                    _ => {}
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            core_info,
            core_latest,
            core_update,
            core_reset,
            set_start_with_windows,
            sub_fetch,
            install_id,
            profiles_import,
            probe_ping,
            update_check,
            update_install,
            my_ip,
            state_export,
            state_import,
            dns_leak,
            kill_switch_status,
            kill_switch_selfcheck,
            zapret_scan,
            zapret_import,
            orchestrator_list,
            orchestrator_record,
            orchestrator_reset,
            auto_history_get,
            auto_history_add,
            kill_switch_set,
            update_download,
            speed_test,
            zapret_settings,
            stats_add,
            stats_read,
            app_version,
            open_url,
            state_load,
            state_save,
            logs_tail,
            engine_start,
            engine_stop,
            engine_status,
            engine_traffic,
            app_is_admin,
            app_relaunch_admin,
            zapret_detect,
            zapret_presets,
            zapret_start,
            zapret_stop,
            zapret_status,
            set_tray_state,
            apps_scan,
            export_log
        ])
        .build(tauri::generate_context!())
        .expect("error while building K4R Neko VPN")
        .run(|app, event| {
            // Leaving the app must not leave a tunnel or a DPI bypass running.
            if let tauri::RunEvent::Exit = event {
                let engine = app.state::<engine::Engine>();
                let _ = engine::stop(&engine);
                let zapret = app.state::<zapret::Zapret>();
                let _ = zapret::stop(&zapret);
            }
        });
}

#[cfg(test)]
mod stats_tests {
    use super::{day_merge, DayTraffic};
    use std::collections::BTreeMap;

    fn map() -> BTreeMap<String, DayTraffic> {
        BTreeMap::new()
    }

    #[test]
    fn adds_to_the_same_day_and_keeps_both_directions() {
        let mut m = map();
        day_merge(&mut m, "2026-11-15", 1000, 200).unwrap();
        day_merge(&mut m, "2026-11-15", 500, 50).unwrap();
        let d = m.get("2026-11-15").unwrap();
        assert_eq!(d.down, 1500);
        assert_eq!(d.up, 250);
    }

    #[test]
    fn zero_traffic_changes_nothing() {
        let mut m = map();
        day_merge(&mut m, "2026-11-15", 0, 0).unwrap();
        assert!(m.is_empty());
    }

    #[test]
    fn refuses_a_day_that_is_not_a_date() {
        let mut m = map();
        assert!(day_merge(&mut m, "", 1, 1).is_err());
        assert!(day_merge(&mut m, "15.11.2026", 1, 1).is_err());
        assert!(m.is_empty());
    }

    #[test]
    fn keeps_two_months_and_drops_the_oldest() {
        let mut m = map();
        for day in 1..=70 {
            day_merge(&mut m, &format!("2026-{:02}-01", (day % 12) + 1), 1, 1).unwrap();
        }
        assert!(m.len() <= 62, "в карте {} дней", m.len());
    }
}

#[cfg(test)]
mod core_tests {
    use super::*;

    #[test]
    fn core_url_is_built_for_real_versions() {
        let url = core_download_url("1.14.4").unwrap();
        assert!(
            url.ends_with("/v1.14.4/sing-box-1.14.4-windows-amd64.zip"),
            "{url}"
        );
        // «v» в начале — как на GitHub, это не ошибка ввода
        assert_eq!(
            core_download_url("v1.15.0").unwrap(),
            core_download_url("1.15.0").unwrap()
        );
    }

    #[test]
    fn core_url_refuses_anything_that_is_not_a_version() {
        // Сюда нельзя вписать путь или чужой адрес: скачается чужой файл
        for bad in [
            "",
            "latest",
            "../evil",
            "1.2.3/../../x",
            "1.2.3?x=1",
            "v",
            "1.2.3-rc1",
        ] {
            assert!(core_download_url(bad).is_err(), "должно отказать: {bad:?}");
        }
        // пробелы по краям — это не ошибка ввода, их срезаем
        assert_eq!(
            core_download_url(" 1.14.4 ").unwrap(),
            core_download_url("1.14.4").unwrap()
        );
    }

    #[test]
    fn version_is_read_from_the_engine_banner() {
        let text = "sing-box version 1.14.4

Environment: go1.23.6 windows/amd64
";
        assert_eq!(engine::parse_version(text), "1.14.4");
        assert_eq!(engine::parse_version("что-то другое"), "");
    }
}
