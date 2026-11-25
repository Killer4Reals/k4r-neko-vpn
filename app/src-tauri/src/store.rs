use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::subscription::Profile;

/// Bumped whenever a stored file needs a one-time fix on load.
pub const SCHEMA: u32 = 3;

/// Где приложение смотрит, не вышла ли новая версия. Маленький манифест в
/// репозитории: одно поле версии и ссылка на установщик. Пусто у тех, кто
/// сознательно очистил поле, — их выбор не переписываем.
pub const UPDATE_URL: &str =
    "https://raw.githubusercontent.com/Killer4Reals/k4r-neko-vpn/master/version.json";

fn yes() -> bool {
    true
}

/// Everything the app needs to work without any external program.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct AppState {
    /// Stable per-install id, sent as X-HWID. Providers use it as the device slot.
    pub hwid: String,
    pub profiles: Vec<Profile>,
    /// Kept for files written before multiple subscriptions existed.
    pub sub_url: String,
    pub sub_ua: String,
    pub subs: Vec<SubSource>,
    pub selected: String,
    pub split: Vec<SplitEntry>,
    pub zapret_dir: String,
    pub zapret_preset: String,
    /// Поднимать Zapret вместе с приложением, а не отдельной программой
    #[serde(default)]
    pub zapret_auto: bool,
    /// "tunnel" or "system"
    pub dns_mode: String,
    pub block_ipv6: bool,
    pub reconnect: bool,
    pub hotkey: String,
    pub close_to_tray: bool,
    /// minimize button also hides the window to the tray, like Zapret does
    #[serde(default = "yes")]
    pub minimize_to_tray: bool,
    /// remembered preference; the real WFP block ships later
    pub kill_switch: bool,
    /// "only" = the tunnel carries just the chosen programs, "all" = everything
    /// except the programs marked direct
    pub split_mode: String,
    /// resolver used inside the tunnel: plain address, https:// or tls:// URL
    pub dns_server: String,
    /// how often to re-fetch subscriptions, hours; 0 = only by hand
    pub sub_refresh_hours: u32,
    /// where to look for a newer build: a small json manifest; empty = not set up
    pub update_url: String,
    /// local SOCKS5 proxy inside the tunnel, for Telegram and friends
    #[serde(default)]
    pub tg_proxy: bool,
    /// its port; kept fixed so the address stays the same between runs
    #[serde(default = "default_tg_port")]
    pub tg_port: u16,
    pub notify: bool,
    pub autostart: bool,
    /// поднимать туннель сразу при запуске приложения (не только автозапуск)
    #[serde(default)]
    pub connect_on_start: bool,
    /// Автовыбор сервера: как часто перемерять, минуты; 0 — выключено.
    /// По умолчанию выключено: у существующих пользователей поведение не
    /// меняется, пока они сами не включат.
    #[serde(default)]
    pub auto_select: u32,
    /// Перемерять и переключаться при потере соединения, не дожидаясь таймера
    #[serde(default)]
    pub auto_select_on_loss: bool,
    /// Уходить на другой узел, когда текущий заметно просел по замеру.
    /// По умолчанию выключено: переключать человека за спиной нельзя.
    #[serde(default)]
    pub auto_switch_slow: bool,
    /// Правила маршрутизации, в порядке применения
    #[serde(default)]
    pub rules: Vec<RouteRule>,
    /// Домены и адреса РФ — напрямую, мимо туннеля
    #[serde(default)]
    pub route_ru_direct: bool,
    /// Реклама и трекеры — в блок
    #[serde(default)]
    pub route_block_ads: bool,
    /// Игровой режим: игровой и голосовой трафик идёт напрямую, мимо туннеля.
    /// Так меньше задержка и не рвётся голос, когда VPN переключается.
    #[serde(default)]
    pub game_mode: bool,
    /// Порты игрового режима. Пусто — берём встроенный список.
    #[serde(default)]
    pub game_ports: Vec<String>,
    /// 0 = written before the settings existed; bumped when defaults change
    pub schema: u32,
}

/// Одно правило маршрутизации: признак трафика и что с ним делать.
///
/// Порядок в списке — порядок применения: первое совпавшее правило решает.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct RouteRule {
    /// "domain" (точный), "suffix" (и поддомены), "keyword" (вхождение), "ip" (CIDR)
    pub kind: String,
    pub value: String,
    /// "proxy" (в туннель), "direct" (напрямую), "block" (в блок)
    pub action: String,
    #[serde(default = "yes")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct SubSource {
    pub url: String,
    pub ua: String,
    pub name: String,
    /// unix seconds of the last successful refresh
    pub refreshed: u64,
    /// remaining traffic and expiry, as the provider last reported them
    #[serde(default)]
    pub info: Option<crate::subscription::SubInfo>,
}

/// Поднимать ли туннель сразу при запуске.
///
/// Три условия, и все три обязательны: человек включил галочку, серверы есть и
/// сейчас ничего не подключено. Иначе приложение полезло бы в сеть само —
/// а это ровно то, чего от VPN-клиента не ждут.
pub fn should_autoconnect(enabled: bool, profiles: usize, busy: bool) -> bool {
    enabled && profiles > 0 && !busy
}

/// Zapret uses 1353 for its Telegram proxy; we stay out of its way and take the
/// next port, so both can run at once without a fight.
pub fn default_tg_port() -> u16 {
    1354
}

impl AppState {
    /// First run defaults: what a normal person expects from a VPN client.
    pub fn with_defaults() -> Self {
        Self {
            dns_mode: "tunnel".into(),
            block_ipv6: true,
            reconnect: true,
            tg_proxy: false,
            tg_port: default_tg_port(),
            hotkey: "Ctrl+Alt+V".into(),
            close_to_tray: true,
            minimize_to_tray: true,
            kill_switch: true,
            split_mode: "only".into(),
            dns_server: "1.1.1.1".into(),
            sub_refresh_hours: 12,
            update_url: UPDATE_URL.into(),
            notify: true,
            // opt-in: a portable app must not register itself behind the owner's back
            autostart: false,
            connect_on_start: false,
            schema: SCHEMA,
            ..Self::default()
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct SplitEntry {
    /// file name the engine matches, e.g. "discord.exe"
    pub exe: String,
    /// readable label kept even if the program is uninstalled later
    pub name: String,
    /// true = through the tunnel, false = direct
    pub via: bool,
}

/// 16 hex chars, stable for this installation, generated once.
///
/// A fresh install derives the id from this PC (so two people never share one),
/// and remembers it, so reinstalling the app keeps the same id. If Windows gives
/// us nothing to hash we fall back to a random value.
pub fn install_id(data_dir: &Path) -> String {
    let state = load(data_dir);
    if !state.hwid.is_empty() {
        return state.hwid;
    }
    let id = machine_id().unwrap_or_else(random_hex);
    if let Ok(mut st) = std::fs::read_to_string(state_path(data_dir))
        .ok()
        .and_then(|t| serde_json::from_str::<AppState>(&t).ok())
        .ok_or(())
    {
        st.hwid = id.clone();
        let _ = save(data_dir, &st);
        return id;
    }
    let mut st = AppState::with_defaults();
    st.hwid = id.clone();
    let _ = save(data_dir, &st);
    id
}

/// What Windows says about this PC: the install GUID plus the computer name.
/// Stable across app reinstalls, different on every machine.
fn machine_id() -> Option<String> {
    let mut cmd = std::process::Command::new("reg");
    cmd.args([
        "query",
        r"HKLM\SOFTWARE\Microsoft\Cryptography",
        "/v",
        "MachineGuid",
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    let guid = text
        .lines()
        .find(|l| l.contains("MachineGuid"))?
        .split_whitespace()
        .last()?
        .to_string();
    if guid.len() < 8 {
        return None;
    }
    let host = std::env::var("COMPUTERNAME").unwrap_or_default();
    Some(fnv_hex(&format!("{guid}|{host}")))
}

/// Two FNV-1a passes so the id is 16 hex chars, not one weak 32-bit value.
fn fnv_hex(input: &str) -> String {
    let mut a: u64 = 0xcbf2_9ce4_8422_2325;
    for b in input.as_bytes() {
        a ^= *b as u64;
        a = a.wrapping_mul(0x0000_0100_0000_01b3);
    }
    let mut b: u64 = 0x9e37_79b9_7f4a_7c15;
    for byte in input.as_bytes().iter().rev() {
        b ^= *byte as u64;
        b = b.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{a:016X}{b:016X}")[..16].to_string()
}

fn random_hex() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let mut out = String::new();
    for salt in 0..2u64 {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(salt);
        h.write_u128(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0),
        );
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out.truncate(16);
    out
}

/// Новый id устройства: провайдер увидит его как другое устройство, старое
/// освобождается в его кабинете. Нужно, когда слоты кончились или человек
/// сменил компьютер.
pub fn reset_install_id(data_dir: &Path) -> String {
    let id = random_hex();
    let mut st = load(data_dir);
    st.hwid = id.clone();
    let _ = save(data_dir, &st);
    id
}

pub fn state_path(data_dir: &Path) -> PathBuf {
    data_dir.join("state.json")
}

pub fn load(data_dir: &Path) -> AppState {
    let mut st: AppState = std::fs::read_to_string(state_path(data_dir))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(AppState::with_defaults);
    if st.schema == 0 {
        // 0.1 files predate the settings: give them the intended defaults
        let d = AppState::with_defaults();
        st.block_ipv6 = d.block_ipv6;
        st.reconnect = d.reconnect;
        st.close_to_tray = d.close_to_tray;
        st.kill_switch = d.kill_switch;
        st.notify = d.notify;
        st.autostart = d.autostart;
        st.connect_on_start = d.connect_on_start;
        st.schema = 1;
    }
    if st.schema < 2 {
        // 0.1 wrote every scanned program into the list, so nothing there was a real choice
        st.split.clear();
        // именно 2, а не SCHEMA: следующие шаги миграции должны выполниться тоже
        st.schema = 2;
    }
    if st.schema < 3 {
        // До 1.6.1 поле было пустым, и проверка обновлений молчала у всех.
        // Ставим адрес один раз; если человек потом очистит его сам — не трогаем.
        if st.update_url.trim().is_empty() {
            st.update_url = UPDATE_URL.into();
        }
        st.schema = SCHEMA;
    }
    // Правила, которые нечего применять, не храним: пустое значение или
    // незнакомое действие — это не правило, а мусор от старой версии.
    st.rules.retain(|r| {
        !r.value.trim().is_empty()
            && matches!(r.kind.as_str(), "domain" | "suffix" | "keyword" | "ip")
            && matches!(r.action.as_str(), "proxy" | "direct" | "block")
    });
    if st.dns_mode.is_empty() {
        st.dns_mode = "tunnel".into();
    }
    if st.hotkey.is_empty() {
        st.hotkey = "Ctrl+Alt+V".into();
    }
    st
}

pub fn save(data_dir: &Path, state: &AppState) -> Result<(), String> {
    std::fs::create_dir_all(data_dir)
        .map_err(|e| format!("не удалось создать каталог данных: {e}"))?;
    let tmp = state_path(data_dir).with_extension("json.tmp");
    std::fs::write(
        &tmp,
        serde_json::to_vec_pretty(state).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("не удалось сохранить настройки: {e}"))?;
    std::fs::rename(&tmp, state_path(data_dir))
        .map_err(|e| format!("не удалось заменить настройки: {e}"))
}

/// The engine paints its log with ANSI colour codes; the window and the
/// exported file want plain text.
pub fn strip_ansi(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('\u{1b}') {
        out.push_str(&rest[..start]);
        let tail = &rest[start..];
        match tail.find('m') {
            Some(end) => rest = &tail[end + 1..],
            None => {
                rest = "";
                break;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Last `lines` lines of one of our own log files. Never reads foreign programs.
/// Предел журнала: всё, что больше, уезжает в `*.log.1`. Журнал пишется
/// дозаписью и ничем не ограничен, а sing-box на каждом запуске добавляет
/// десятки строк — без потолка файл растёт годами и однажды ломает чтение.
pub const LOG_LIMIT: u64 = 4 * 1024 * 1024;

/// Убирает разросшийся журнал в `.log.1` (один предыдущий кусок).
/// Вызывается до запуска ядра, когда файл никто не держит открытым:
/// на Windows переименовать открытый файл нельзя.
/// Возвращает true, если файл действительно убран.
pub fn rotate_log(path: &Path) -> bool {
    rotate_log_at(path, LOG_LIMIT)
}

pub fn rotate_log_at(path: &Path, limit: u64) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    if meta.len() <= limit {
        return false;
    }
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "log".into());
    let backup = path.with_file_name(format!("{name}.1"));
    // старый предыдущий кусок больше не нужен: два файла — уже история
    let _ = std::fs::remove_file(&backup);
    std::fs::rename(path, &backup).is_ok()
}

pub fn tail(data_dir: &Path, which: &str, lines: usize) -> String {
    let name = match which {
        "zapret" => "zapret.log",
        _ => "engine.log",
    };
    let path = data_dir.join("logs").join(name);
    let Ok(text) = std::fs::read_to_string(path) else {
        return String::new();
    };
    let text = strip_ansi(&text);
    let all: Vec<&str> = text.lines().collect();
    let start = all.len().saturating_sub(lines);
    all[start..].join("\n")
}

#[cfg(test)]
mod tests {

    #[test]
    fn старая_запись_получает_адрес_обновлений() {
        let dir = std::env::temp_dir().join("k4r-update-url-migrate");
        let _ = std::fs::remove_dir_all(&dir);
        let mut st = AppState::with_defaults();
        st.schema = 2;
        st.update_url = String::new();
        save(&dir, &st).unwrap();
        assert_eq!(load(&dir).update_url, UPDATE_URL);
    }

    #[test]
    fn очищенный_вручную_адрес_не_возвращается() {
        let dir = std::env::temp_dir().join("k4r-update-url-kept");
        let _ = std::fs::remove_dir_all(&dir);
        let mut st = AppState::with_defaults();
        st.update_url = String::new();
        save(&dir, &st).unwrap();
        assert_eq!(load(&dir).update_url, "");
    }

    #[test]
    fn новые_настройки_сразу_смотрят_за_обновлениями() {
        assert_eq!(AppState::with_defaults().update_url, UPDATE_URL);
    }

    #[test]
    fn правила_маршрутизации_переживают_запись() {
        let dir = std::env::temp_dir().join("k4r-rules-roundtrip");
        let _ = std::fs::remove_dir_all(&dir);
        let mut st = AppState::with_defaults();
        st.rules = vec![
            RouteRule {
                kind: "suffix".into(),
                value: "ozon.ru".into(),
                action: "direct".into(),
                enabled: true,
            },
            RouteRule {
                kind: "ip".into(),
                value: "5.255.255.0/24".into(),
                action: "block".into(),
                enabled: false,
            },
        ];
        st.route_ru_direct = true;
        st.route_block_ads = true;
        save(&dir, &st).unwrap();
        let back = load(&dir);
        assert_eq!(back.rules, st.rules);
        assert!(back.route_ru_direct);
        assert!(back.route_block_ads);
    }

    #[test]
    fn мусорные_правила_отбрасываются_при_загрузке() {
        let dir = std::env::temp_dir().join("k4r-rules-junk");
        let _ = std::fs::remove_dir_all(&dir);
        let mut st = AppState::with_defaults();
        st.rules = vec![
            RouteRule {
                kind: "suffix".into(),
                value: "  ".into(),
                action: "direct".into(),
                enabled: true,
            },
            RouteRule {
                kind: "nonsense".into(),
                value: "a.example".into(),
                action: "direct".into(),
                enabled: true,
            },
            RouteRule {
                kind: "domain".into(),
                value: "b.example".into(),
                action: "teleport".into(),
                enabled: true,
            },
            RouteRule {
                kind: "domain".into(),
                value: "ok.example".into(),
                action: "proxy".into(),
                enabled: true,
            },
        ];
        save(&dir, &st).unwrap();
        let back = load(&dir);
        assert_eq!(back.rules.len(), 1);
        assert_eq!(back.rules[0].value, "ok.example");
    }

    use super::*;

    fn sample() -> Profile {
        Profile {
            id: "a".into(),
            name: "A".into(),
            from_sub: true,
            host: "example.com".into(),
            port: 443,
            uuid: "u".into(),
            flow: String::new(),
            security: "tls".into(),
            network: "tcp".into(),
            sni: String::new(),
            public_key: String::new(),
            short_id: String::new(),
            fingerprint: String::new(),
            service_name: String::new(),
            path: String::new(),
            kind: String::new(),
            password: String::new(),
            method: String::new(),
            alter_id: 0,
            wg_private_key: String::new(),
            wg_peer_public_key: String::new(),
            wg_preshared_key: String::new(),
            wg_addresses: Vec::new(),
            wg_mtu: 0,
            wg_reserved: Vec::new(),
            reserve: false,
            cc: String::new(),
        }
    }

    #[test]
    fn round_trips_state() {
        let dir = std::env::temp_dir().join("k4r-state-test");
        let _ = std::fs::remove_dir_all(&dir);
        let mut st = AppState::with_defaults();
        st.profiles.push(sample());
        st.sub_ua = "K4R-Neko-VPN/0.1".into();
        st.hwid = "abc123".into();
        st.split.push(SplitEntry {
            exe: "steam.exe".into(),
            name: "Steam".into(),
            via: false,
        });
        save(&dir, &st).unwrap();

        let back = load(&dir);
        assert_eq!(back.profiles.len(), 1);
        assert_eq!(back.sub_ua, "K4R-Neko-VPN/0.1");
        assert_eq!(back.split[0].exe, "steam.exe");
        assert_eq!(back.split[0].name, "Steam");
        assert!(!back.split[0].via);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn old_scan_dump_is_dropped_once() {
        let dir = std::env::temp_dir().join("k4r-split-migration");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let old = r#"{"schema":1,"split":[{"exe":"discord.exe","via":true},{"exe":"steam.exe","via":false}]}"#;
        std::fs::write(state_path(&dir), old).unwrap();

        let st = load(&dir);
        assert!(
            st.split.is_empty(),
            "0.1 auto-filled the whole scan, nothing was chosen"
        );
        assert_eq!(st.schema, SCHEMA);

        // the owner's own picks survive the next launch
        let mut next = st.clone();
        next.split.push(SplitEntry {
            exe: "steam.exe".into(),
            name: "Steam".into(),
            via: false,
        });
        save(&dir, &next).unwrap();
        assert_eq!(load(&dir).split.len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn log_colours_are_stripped() {
        let raw = "\u{1b}[36mINFO\u{1b}[0m plain \u{1b}[38;5;105m1234\u{1b}[0m end";
        assert_eq!(strip_ansi(raw), "INFO plain 1234 end");
        assert_eq!(strip_ansi("no codes here"), "no codes here");
    }

    #[test]
    fn missing_state_is_not_an_error() {
        let dir = std::env::temp_dir().join("k4r-state-missing");
        let st = load(&dir);
        assert!(st.profiles.is_empty());
    }

    #[test]
    fn install_id_is_generated_once_and_kept() {
        let dir = std::env::temp_dir().join("k4r-hwid-test");
        let _ = std::fs::remove_dir_all(&dir);
        let first = install_id(&dir);
        let second = install_id(&dir);
        assert_eq!(first.len(), 16);
        assert_eq!(first, second, "install id must be stable");
        assert!(first.chars().all(|c| c.is_ascii_hexdigit()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn install_id_survives_a_save_without_it() {
        let dir = std::env::temp_dir().join("k4r-hwid-keep");
        let _ = std::fs::remove_dir_all(&dir);
        let id = install_id(&dir);
        let mut st = load(&dir);
        st.hwid = String::new();
        save(&dir, &st).unwrap();
        // the app re-injects it on save; the helper must then return the same value
        let again = install_id(&dir);
        assert_eq!(again.len(), 16);
        assert_eq!(load(&dir).hwid, again);
        assert!(!id.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tail_returns_empty_for_unknown_log() {
        let dir = std::env::temp_dir().join("k4r-logs-missing");
        assert_eq!(tail(&dir, "engine", 10), "");
    }

    #[test]
    fn small_log_is_not_rotated() {
        let dir = std::env::temp_dir().join("k4r-log-small");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("engine.log");
        std::fs::write(
            &path,
            "строка
",
        )
        .unwrap();
        assert!(!rotate_log_at(&path, 1024));
        assert!(path.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn big_log_moves_to_dot_one_and_starts_fresh() {
        let dir = std::env::temp_dir().join("k4r-log-big");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("engine.log");
        let old = "старое
"
        .repeat(100);
        std::fs::write(&path, &old).unwrap();
        assert!(rotate_log_at(&path, 100));
        assert!(!path.exists(), "свежий журнал начинается с пустого файла");
        let backup = dir.join("engine.log.1");
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), old);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn second_rotation_replaces_previous_backup() {
        let dir = std::env::temp_dir().join("k4r-log-twice");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("engine.log");
        std::fs::write(
            &path,
            "первый
"
            .repeat(50),
        )
        .unwrap();
        assert!(rotate_log_at(&path, 100));
        std::fs::write(
            &path,
            "второй
"
            .repeat(50),
        )
        .unwrap();
        assert!(rotate_log_at(&path, 100));
        // держим ровно один предыдущий кусок, иначе каталог растёт бесконечно
        assert_eq!(
            std::fs::read_to_string(dir.join("engine.log.1")).unwrap(),
            "второй
"
            .repeat(50)
        );
        assert!(!dir.join("engine.log.2").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rotation_survives_missing_file() {
        let dir = std::env::temp_dir().join("k4r-log-none");
        let _ = std::fs::remove_dir_all(&dir);
        assert!(!rotate_log_at(&dir.join("engine.log"), 100));
    }

    #[test]
    fn autoconnect_needs_all_three_conditions() {
        // включено + есть серверы + ничего не запущено
        assert!(should_autoconnect(true, 5, false));
        // выключено — не лезем в сеть сами
        assert!(!should_autoconnect(false, 5, false));
        // серверов нет — подключаться некуда
        assert!(!should_autoconnect(true, 0, false));
        // уже подключено — второй раз не начинаем
        assert!(!should_autoconnect(true, 5, true));
    }
}
