use serde::Serialize;
use serde_json::{json, Value};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use crate::store::RouteRule;
use crate::subscription::Profile;

/// CREATE_NO_WINDOW: a console child must never flash a black window on screen.
#[cfg(windows)]
pub const HIDE_WINDOW: u32 = 0x0800_0000;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EngineState {
    Idle,
    Starting,
    Running,
    Error,
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineStatus {
    pub state: EngineState,
    pub message: String,
    pub server: String,
    pub pid: u32,
}

impl Default for EngineStatus {
    fn default() -> Self {
        Self {
            state: EngineState::Idle,
            message: String::new(),
            server: String::new(),
            pid: 0,
        }
    }
}

pub struct Engine {
    pub status: Mutex<EngineStatus>,
    pub child: Mutex<Option<Child>>,
    /// The kill-switch process: holds the tunnel adapter up and rejects traffic
    /// while we are reconnecting. Never confused with the real engine.
    pub hold: Mutex<Option<Child>>,
    pub config_path: Mutex<Option<PathBuf>>,
    /// false when the user pressed "disconnect": the supervisor must not reconnect
    pub wanted: AtomicBool,
    /// where the engine reports its own counters, and the last sample we took
    pub api: Mutex<Option<(u16, String)>>,
    pub last_sample: Mutex<Option<(u64, u64, std::time::Instant)>>,
}

impl Default for Engine {
    fn default() -> Self {
        Self {
            status: Mutex::new(EngineStatus::default()),
            child: Mutex::new(None),
            hold: Mutex::new(None),
            config_path: Mutex::new(None),
            wanted: AtomicBool::new(false),
            api: Mutex::new(None),
            last_sample: Mutex::new(None),
        }
    }
}

/// Игровые и голосовые порты по умолчанию: Steam, Discord RTC, STUN, консоли.
/// Список намеренно узкий: «всё выше 1024» отправило бы мимо туннеля весь
/// интернет, и VPN стал бы бесполезным.
pub const GAME_PORTS: &[&str] = &[
    "27015:27050", // Steam / Source / CS2 / TF2
    "3478:3481",   // STUN: голос и NAT-пробивка
    "50000:50100", // Discord voice (RTC)
    "19294:19344", // Discord voice (альтернативный диапазон)
    "3074",        // Xbox Live
    "3659",        // Battlefield / EA
    "10000:10100", // Riot / Valorant
    "5000:5500",   // Riot launcher / League
];

/// Choices that change the generated config but not the server.
#[derive(Debug, Clone)]
pub struct NetOptions {
    /// "tunnel" resolves through the tunnel, "system" keeps the provider's DNS
    pub dns_mode: String,
    pub block_ipv6: bool,
    pub dns_server: String,
    /// 0 = no monitoring endpoint (probes and tests do not need one)
    pub api_port: u16,
    pub api_secret: String,
    /// "only" = the tunnel carries just the listed programs, "all" = everything
    /// except the programs the owner sent direct
    pub split_mode: String,
    /// programs that must go through the tunnel in "only" mode
    pub tunnel_apps: Vec<String>,
    /// router address, used as the plain resolver for everything not tunnelled
    pub gateway: String,
    /// Local SOCKS5 port inside the tunnel, so Telegram (and any other client
    /// that knows proxies) can be routed by hand. 0 = off.
    pub tg_port: u16,
    /// Правила маршрутизации владельца: домены, суффиксы, ключевые слова, адреса.
    /// Применяются раньше правил разделения по программам: явное всегда сильнее.
    pub rules: Vec<RouteRule>,
    /// Домены и адреса РФ — напрямую, мимо туннеля
    pub route_ru_direct: bool,
    /// Реклама и трекеры — в блок
    pub route_block_ads: bool,
    /// Игровой режим: эти порты идут напрямую, мимо туннеля
    pub game_mode: bool,
    pub game_ports: Vec<String>,
    /// Где ядро хранит скачанные списки; пусто — без кэша
    pub cache_path: String,
}

impl Default for NetOptions {
    fn default() -> Self {
        Self {
            dns_mode: "tunnel".into(),
            block_ipv6: true,
            dns_server: "1.1.1.1".into(),
            api_port: 0,
            api_secret: String::new(),
            split_mode: "only".into(),
            tunnel_apps: Vec::new(),
            gateway: String::new(),
            tg_port: 0,
            rules: Vec::new(),
            route_ru_direct: false,
            route_block_ads: false,
            game_mode: false,
            game_ports: Vec::new(),
            cache_path: String::new(),
        }
    }
}

/// Builds a sing-box config: TUN in, VLESS out, split tunneling by process name.
/// Аутбаунд WireGuard: WARP и любые WG-серверы подключаются так же, как VLESS.
fn wireguard_outbound(profile: &Profile) -> Value {
    let mut out = json!({
        "type": "wireguard",
        "tag": "proxy",
        "server": profile.host,
        "server_port": profile.port,
        "private_key": profile.wg_private_key,
        "peer_public_key": profile.wg_peer_public_key,
        "local_address": if profile.wg_addresses.is_empty() {
            vec!["172.16.0.2/32".to_string()]
        } else {
            profile.wg_addresses.clone()
        },
        "mtu": if profile.wg_mtu == 0 { 1280 } else { profile.wg_mtu },
    });
    if !profile.wg_preshared_key.trim().is_empty() {
        out["pre_shared_key"] = json!(profile.wg_preshared_key);
    }
    if profile.wg_reserved.len() == 3 {
        // WARP: три байта, которые Cloudflare ждёт в заголовке.
        out["reserved"] = json!(profile.wg_reserved);
    }
    out
}

/// Builds a sing-box config: TUN in, one server out, split by process.
/// Протокол выбирается по `kind`: провайдеры мешают VLESS, Trojan, Shadowsocks
/// и VMess в одной подписке, и пропускать три четверти списка было бы странно.
pub fn build_config(profile: &Profile, excluded: &[String], opts: &NetOptions) -> Value {
    build_with_outbound(outbound_for(profile), profile, excluded, opts)
}

/// Исходящее соединение одного узла — независимо от того, один он или в пуле.
fn outbound_for(profile: &Profile) -> Value {
    match profile.kind.as_str() {
        "wireguard" => wireguard_outbound(profile),
        "trojan" => trojan_outbound(profile),
        "shadowsocks" => shadowsocks_outbound(profile),
        "vmess" => vmess_outbound(profile),
        _ => vless_outbound(profile),
    }
}

/// Умный пул: до трёх узлов в одном конфиге, ядро само решает, через какой идти.
///
/// Зачем: запуск ядра — самая долгая часть подключения, и она одна. Ядро меряет
/// все узлы пула и сразу отдаёт трафик лучшему, а если тот умер — через несколько
/// секунд переключается на живой. Отсюда и быстрый старт, и автолечение: не нужно
/// ни второй запуск, ни наш код-надзиратель.
pub fn build_pool_config(
    chosen: &Profile,
    pool: &[Profile],
    excluded: &[String],
    opts: &NetOptions,
) -> Value {
    // Первым в пуле всегда стоит выбранный человеком (или авто-выбором) узел:
    // если ядро ещё не успело ничего померить, трафик пойдёт через него.
    let mut nodes: Vec<&Profile> = vec![chosen];
    for p in pool {
        if nodes.len() >= SMART_POOL {
            break;
        }
        if p.id != chosen.id && !nodes.iter().any(|n| n.id == p.id) {
            nodes.push(p);
        }
    }

    let mut config = build_config(chosen, excluded, opts);
    if nodes.len() < 2 {
        return config;
    }

    let mut outs: Vec<Value> = Vec::new();
    let mut tags: Vec<String> = Vec::new();
    for (i, node) in nodes.iter().enumerate() {
        let tag = format!("proxy-{i}");
        let mut ob = outbound_for(node);
        ob["tag"] = json!(tag);
        tags.push(tag);
        outs.push(ob);
    }
    outs.push(json!({
        "type": "urltest",
        "tag": "proxy",
        "outbounds": tags,
        // 204 от Google — самый дешёвый честный ответ: есть связь или нет
        "url": "https://www.gstatic.com/generate_204",
        "interval": "3m",
        "tolerance": 50,
        "idle_timeout": "10m"
    }));
    outs.push(json!({ "type": "direct", "tag": "direct" }));
    config["outbounds"] = json!(outs);
    config
}

/// Сколько узлов держим в пуле. Три — компромисс: два обычно мало (оба могут
/// лежать), а каждый следующий узел это лишний трафик проверок.
pub const SMART_POOL: usize = 3;

/// Trojan: обычный TLS с паролем вместо UUID.
fn trojan_outbound(profile: &Profile) -> Value {
    let mut tls = json!({
        "enabled": true,
        "utls": {
            "enabled": true,
            "fingerprint": if profile.fingerprint.is_empty() { "chrome" } else { &profile.fingerprint },
        }
    });
    let sni = if profile.sni.is_empty() { &profile.host } else { &profile.sni };
    tls["server_name"] = json!(sni);
    let mut outbound = json!({
        "type": "trojan",
        "tag": "proxy",
        "server": profile.host,
        "server_port": profile.port,
        "password": profile.password,
        "tls": tls,
    });
    match profile.network.as_str() {
        "ws" => {
            let path = if profile.path.is_empty() { "/" } else { &profile.path };
            outbound["transport"] = json!({ "type": "ws", "path": path });
        }
        "grpc" => {
            let mut transport = json!({ "type": "grpc" });
            if !profile.service_name.is_empty() {
                transport["service_name"] = json!(profile.service_name);
            }
            outbound["transport"] = transport;
        }
        _ => {}
    }
    outbound
}

/// Shadowsocks: шифр и пароль, без TLS и без UUID.
fn shadowsocks_outbound(profile: &Profile) -> Value {
    json!({
        "type": "shadowsocks",
        "tag": "proxy",
        "server": profile.host,
        "server_port": profile.port,
        "method": profile.method,
        "password": profile.password,
    })
}

/// VMess: UUID плюс `alter_id`; остальное как у VLESS.
fn vmess_outbound(profile: &Profile) -> Value {
    let mut outbound = json!({
        "type": "vmess",
        "tag": "proxy",
        "server": profile.host,
        "server_port": profile.port,
        "uuid": profile.uuid,
        "security": "auto",
        "alter_id": profile.alter_id,
    });
    if matches!(profile.security.as_str(), "tls" | "reality") {
        let mut tls = json!({
            "enabled": true,
            "utls": { "enabled": true, "fingerprint": if profile.fingerprint.is_empty() { "chrome" } else { &profile.fingerprint } },
        });
        if !profile.sni.is_empty() {
            tls["server_name"] = json!(profile.sni);
        }
        outbound["tls"] = tls;
    }
    match profile.network.as_str() {
        "ws" => {
            let path = if profile.path.is_empty() { "/" } else { &profile.path };
            outbound["transport"] = json!({ "type": "ws", "path": path });
        }
        "grpc" => {
            let mut transport = json!({ "type": "grpc" });
            if !profile.service_name.is_empty() {
                transport["service_name"] = json!(profile.service_name);
            }
            outbound["transport"] = transport;
        }
        _ => {}
    }
    outbound
}

fn vless_outbound(profile: &Profile) -> Value {
    let mut outbound = json!({
        "type": "vless",
        "tag": "proxy",
        "server": profile.host,
        "server_port": profile.port,
        "uuid": profile.uuid,
    });

    if !profile.flow.trim().is_empty() {
        outbound["flow"] = json!(profile.flow);
    }

    let tls_enabled = matches!(profile.security.as_str(), "tls" | "reality");
    if tls_enabled {
        let mut tls = json!({
            "enabled": true,
            "utls": {
                "enabled": true,
                "fingerprint": if profile.fingerprint.is_empty() { "chrome" } else { &profile.fingerprint },
            }
        });
        if !profile.sni.is_empty() {
            tls["server_name"] = json!(profile.sni);
        }
        if profile.security == "reality" {
            tls["reality"] = json!({
                "enabled": true,
                "public_key": profile.public_key,
                "short_id": profile.short_id,
            });
        }
        outbound["tls"] = tls;
    }

    match profile.network.as_str() {
        "ws" => {
            let path = if profile.path.is_empty() {
                "/"
            } else {
                &profile.path
            };
            outbound["transport"] = json!({ "type": "ws", "path": path });
        }
        "grpc" => {
            let mut transport = json!({ "type": "grpc" });
            if !profile.service_name.is_empty() {
                transport["service_name"] = json!(profile.service_name);
            }
            outbound["transport"] = transport;
        }
        _ => {}
    }

    outbound
}

fn build_with_outbound(
    outbound: Value,
    profile: &Profile,
    excluded: &[String],
    opts: &NetOptions,
) -> Value {
    // Списки, которые ядро скачивает само (binary .srs) и держит в кэше.
    // Мы не вшиваем их в установщик: они обновляются чаще, чем наше приложение.
    let mut rule_sets: Vec<Value> = Vec::new();
    if opts.route_ru_direct {
        rule_sets.push(json!({
            "type": "remote", "tag": "ru-domains", "format": "binary",
            "url": "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-category-ru.srs"
        }));
        rule_sets.push(json!({
            "type": "remote", "tag": "ru-ips", "format": "binary",
            "url": "https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-ru.srs"
        }));
    }
    if opts.route_block_ads {
        rule_sets.push(json!({
            "type": "remote", "tag": "ads", "format": "binary",
            "url": "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-category-ads-all.srs"
        }));
    }

    let only_chosen = opts.split_mode == "only";
    let mut rules = vec![
        json!({ "action": "sniff" }),
        json!({ "protocol": "dns", "action": "hijack-dns" }),
        // the local network is always local, whatever the mode is
        json!({ "ip_is_private": true, "outbound": "direct" }),
    ];
    // Правила владельца идут раньше разделения по программам: если человек
    // сказал «этот домен напрямую», спорить с ним не о чем.
    for rule in &opts.rules {
        if !rule.enabled {
            continue;
        }
        let value = rule.value.trim();
        let key = match rule.kind.as_str() {
            "domain" => "domain",
            "suffix" => "domain_suffix",
            "keyword" => "domain_keyword",
            "ip" => "ip_cidr",
            _ => continue,
        };
        if value.is_empty() {
            continue;
        }
        let mut one = json!({ key: [value] });
        match rule.action.as_str() {
            "block" => {
                one["action"] = json!("reject");
            }
            "direct" => {
                one["outbound"] = json!("direct");
            }
            "proxy" => {
                one["outbound"] = json!("proxy");
            }
            _ => continue,
        }
        rules.push(one);
    }
    if opts.game_mode {
        // Игры и голос — напрямую: задержка важнее, а прятать игровой трафик
        // в туннеле всё равно бессмысленно.
        let ports: Vec<String> = opts
            .game_ports
            .iter()
            .map(|p| p.trim().replace('-', ":"))
            .filter(|p| !p.is_empty())
            .collect();
        if !ports.is_empty() {
            rules.push(json!({ "port": ports, "outbound": "direct" }));
        }
    }
    if opts.route_ru_direct {
        rules.push(json!({ "rule_set": ["ru-domains", "ru-ips"], "outbound": "direct" }));
    }
    if opts.route_block_ads {
        rules.push(json!({ "rule_set": ["ads"], "action": "reject" }));
    }
    if only_chosen {
        if opts.block_ipv6 && !opts.tunnel_apps.is_empty() {
            // a tunnelled program keeps no IPv6 of its own: that would leak
            rules.push(json!({
                "process_name": opts.tunnel_apps,
                "ip_version": 6,
                "action": "reject"
            }));
        }
        if !opts.tunnel_apps.is_empty() {
            rules.push(json!({ "process_name": opts.tunnel_apps, "outbound": "proxy" }));
        }
    } else {
        if !excluded.is_empty() {
            // First, before anything else: a program the owner sends direct keeps
            // its own stack, including IPv6. Otherwise the IPv6 reject would cut it.
            rules.push(json!({ "process_name": excluded, "outbound": "direct" }));
        }
        if opts.block_ipv6 {
            // IPv6 would otherwise leave outside the tunnel: that is a leak
            rules.push(json!({ "ip_version": 6, "action": "reject" }));
        }
    }

    let dns = if opts.dns_mode == "system" {
        json!({
            "servers": [{ "type": "local", "tag": "system" }],
            "final": "system",
            "strategy": if opts.block_ipv6 { "ipv4_only" } else { "prefer_ipv4" }
        })
    } else {
        // A plain address becomes DNS over HTTPS (nobody on the way can read it),
        // "https://" and "tls://" are taken as written, so the owner can point at
        // any resolver they trust.
        let raw = opts.dns_server.trim();
        let remote = if let Some(rest) = raw.strip_prefix("https://") {
            let (host, path) = match rest.split_once('/') {
                Some((h, p)) => (h, format!("/{p}")),
                None => (rest, "/dns-query".to_string()),
            };
            let mut server = json!({ "type": "https", "tag": "remote", "server": host, });
            if path != "/dns-query" {
                server["path"] = json!(path);
            }
            server
        } else if let Some(rest) = raw.strip_prefix("tls://") {
            json!({ "type": "tls", "tag": "remote", "server": rest, })
        } else if raw.is_empty() {
            json!({ "type": "https", "tag": "remote", "server": "1.1.1.1", })
        } else {
            json!({ "type": "https", "tag": "remote", "server": raw, })
        };
        let strategy = if opts.block_ipv6 {
            "ipv4_only"
        } else {
            "prefer_ipv4"
        };
        // One encrypted resolver for every program. Resolving through the tunnel
        // itself proved unreliable (the server may not relay DNS), and a plain
        // "system" resolver would ask our own adapter and loop.
        json!({
            "servers": [remote, { "type": "local", "tag": "system" }],
            "final": "remote",
            "strategy": strategy
        })
    };
    let resolver = if opts.dns_mode == "system" {
        "system"
    } else {
        "remote"
    };

    let mut config = json!({
        "log": { "level": "info", "timestamp": true },
        "dns": dns,
        "inbounds": [{
            "type": "tun",
            "tag": "tun-in",
            "address": ["172.19.0.1/30"],
            "mtu": 1350,
            "auto_route": true,
            "strict_route": true,
            "stack": "mixed"
        }],
        "outbounds": [outbound, { "type": "direct", "tag": "direct" }],
        "route": {
            "rules": rules,
            // "only the chosen programs" means everything else really is direct
            "final": if only_chosen { "direct" } else { "proxy" },
            "auto_detect_interface": true,
            "default_domain_resolver": resolver
        }
    });
    // «experimental» собираем по кусочкам: раньше endpoint для счётчиков затирал
    // кэш списков, и ядро качало их заново при каждом запуске — это лишние
    // секунды до готового туннеля.
    let mut experimental = serde_json::Map::new();
    if !rule_sets.is_empty() {
        config["route"]["rule_set"] = json!(rule_sets);
        if !opts.cache_path.trim().is_empty() {
            experimental.insert(
                "cache_file".into(),
                json!({ "enabled": true, "path": opts.cache_path.trim() }),
            );
        }
    }
    if opts.tg_port != 0 {
        // Zapret solves Telegram with a local proxy on 1353; we do the same, only
        // the traffic goes through the tunnel instead of a separate MTProto link.
        config["inbounds"]
            .as_array_mut()
            .expect("inbounds is an array")
            .push(json!({
                "type": "mixed",
                "tag": "socks-in",
                "listen": "127.0.0.1",
                "listen_port": opts.tg_port
            }));
        let rules = config["route"]["rules"]
            .as_array_mut()
            .expect("rules is an array");
        // everything that arrives on the local proxy is tunnelled, otherwise the
        // split rules would send it direct and the proxy would be pointless
        rules.insert(0, json!({ "inbound": ["socks-in"], "outbound": "proxy" }));
    }
    if opts.api_port != 0 {
        // Our own loopback endpoint: the only way to read real traffic counters.
        experimental.insert(
            "clash_api".into(),
            json!({
                "external_controller": format!("127.0.0.1:{}", opts.api_port),
                "secret": opts.api_secret
            }),
        );
    }
    if !experimental.is_empty() {
        config["experimental"] = serde_json::Value::Object(experimental);
    }
    config
}

/// The router address, read from the routing table. Hidden, ~10 ms, no console.
pub fn default_gateway() -> String {
    let mut cmd = Command::new("route");
    cmd.args(["print", "-4", "0.0.0.0"]);
    hidden(&mut cmd);
    let Ok(out) = cmd.output() else {
        return String::new();
    };
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    // Several adapters may claim a default route (Radmin, Hyper-V, a second NIC).
    // Windows uses the one with the lowest metric, so we must too.
    let mut best: Option<(u32, String)> = None;
    for line in text.lines() {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() >= 5 && cols[0] == "0.0.0.0" && cols[1] == "0.0.0.0" {
            let gw = cols[2];
            let Ok(metric) = cols[4].parse::<u32>() else {
                continue;
            };
            if gw.parse::<std::net::Ipv4Addr>().is_ok()
                && best.as_ref().map(|(m, _)| metric < *m).unwrap_or(true)
            {
                best = Some((metric, gw.to_string()));
            }
        }
    }
    best.map(|(_, gw)| gw).unwrap_or_default()
}

/// Free loopback port for the monitoring endpoint.
pub fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(9090)
}

/// Short random secret so nothing else on the machine can read our counters.
pub fn api_secret() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0),
    );
    format!("{:016x}", h.finish())
}

#[derive(Debug, Clone, serde::Serialize, Default)]
pub struct Traffic {
    /// bytes per second, measured between two polls
    pub down: f64,
    pub up: f64,
    pub total_down: u64,
    pub total_up: u64,
}

/// Reads the counters the engine keeps for us. Never touches anyone else's API.
pub fn traffic(engine: &Engine) -> Traffic {
    let Some((port, secret)) = engine.api.lock().unwrap().clone() else {
        return Traffic::default();
    };
    let url = format!("http://127.0.0.1:{port}/connections");
    let body = match ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_millis(1500)))
        .build()
        .new_agent()
        .get(&url)
        .header("Authorization", &format!("Bearer {secret}"))
        .call()
    {
        Ok(res) => res.into_body().read_to_string().unwrap_or_default(),
        Err(_) => return Traffic::default(),
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&body) else {
        return Traffic::default();
    };
    let down = value["downloadTotal"].as_u64().unwrap_or(0);
    let up = value["uploadTotal"].as_u64().unwrap_or(0);

    let mut last = engine.last_sample.lock().unwrap();
    let mut out = Traffic {
        total_down: down,
        total_up: up,
        ..Traffic::default()
    };
    if let Some((prev_down, prev_up, at)) = *last {
        let secs = at.elapsed().as_secs_f64().max(0.2);
        out.down = down.saturating_sub(prev_down) as f64 / secs;
        out.up = up.saturating_sub(prev_up) as f64 / secs;
    }
    *last = Some((down, up, std::time::Instant::now()));
    out
}

pub fn is_elevated() -> bool {
    // Writing to the hosts file is admin-only; read-only check, nothing is changed.
    std::fs::OpenOptions::new()
        .append(true)
        .open("C:\\Windows\\System32\\drivers\\etc\\hosts")
        .is_ok()
}

/// Finds the bundled engine in every layout we ship: installed, portable, dev.
/// Путь к обновлённому ядру в данных приложения (`<data>/core/sing-box.exe`).
/// Так обновление ядра не требует прав администратора и не трогает
/// установленную программу: рядом с установкой живёт то, что поставили мы.
pub fn updated_core(data_dir: &Path) -> PathBuf {
    data_dir.join("core").join("sing-box.exe")
}

pub fn sidecar_path(resource_dir: &Path) -> PathBuf {
    sidecar_with_core(resource_dir, None)
}

/// Как [`sidecar_path`], но с учётом обновлённого ядра — если оно на месте.
pub fn sidecar_with_core(resource_dir: &Path, data_dir: Option<&Path>) -> PathBuf {
    if let Some(dir) = data_dir {
        let own = updated_core(dir);
        if own.exists() {
            return own;
        }
    }
    let mut candidates = vec![
        resource_dir.join("bin").join("sing-box.exe"),
        resource_dir
            .join("resources")
            .join("bin")
            .join("sing-box.exe"),
    ];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("bin").join("sing-box.exe"));
            candidates.push(dir.join("resources").join("bin").join("sing-box.exe"));
        }
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("bin")
            .join("sing-box.exe"),
    );
    candidates
        .iter()
        .find(|p| p.exists())
        .cloned()
        .unwrap_or_else(|| candidates[0].clone())
}

/// Версия ядра из первой строки `sing-box version`:
/// `sing-box version 1.14.4`. Отдельная функция — чтобы её проверял тест.
pub fn parse_version(text: &str) -> String {
    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("sing-box version ") {
            return rest.split_whitespace().next().unwrap_or("").to_string();
        }
    }
    String::new()
}

/// Спросить у самого ядра, какая у него версия. Пусто — не смогли.
pub fn core_version(bin: &Path) -> String {
    if !bin.exists() {
        return String::new();
    }
    let mut cmd = Command::new(bin);
    cmd.arg("version");
    hidden(&mut cmd);
    let out = cmd.output();
    match out {
        Ok(o) => parse_version(&String::from_utf8_lossy(&o.stdout)),
        Err(_) => String::new(),
    }
}

/// Every console program we start must be invisible: no black window may flash.
pub fn hidden(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    cmd.creation_flags(HIDE_WINDOW);
    cmd
}

pub fn check_config(bin: &Path, config: &Path) -> Result<(), String> {
    let mut cmd = Command::new(bin);
    cmd.arg("check").arg("-c").arg(config);
    hidden(&mut cmd);
    let out = cmd
        .output()
        .map_err(|e| format!("движок не запускается: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!(
            "движок отверг конфиг: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ))
    }
}

/// Есть ли интернет вообще, без туннеля. Пустой адрес — нет маршрута наружу.
fn have_internet() -> bool {
    let Ok(sock) = std::net::UdpSocket::bind("0.0.0.0:0") else {
        return false;
    };
    sock.connect("1.1.1.1:53").is_ok()
        && sock
            .local_addr()
            .map(|a| !a.ip().is_unspecified())
            .unwrap_or(false)
}

/// Адрес сервера из конфига: первый outbound с полем server.
fn config_server(config: &Value) -> Option<(String, u16)> {
    let list = config.get("outbounds")?.as_array()?;
    for ob in list {
        // `?` здесь нельзя: у селектора и прямого выхода поля server нет,
        // и первый же такой выход оборвал бы поиск
        let Some(host) = ob.get("server").and_then(|v| v.as_str()) else {
            continue;
        };
        let port = ob
            .get("server_port")
            .and_then(|v| v.as_u64())
            .unwrap_or(443) as u16;
        return Some((host.to_string(), port));
    }
    None
}

/// Можно ли дозвониться до сервера напрямую. Отвечает на вопрос «сервер мёртв
/// или у нас нет сети» — это разные беды и разные слова для владельца.
fn server_reachable(config: &Value) -> bool {
    let Some((host, port)) = config_server(config) else {
        return false;
    };
    let Ok(addrs) = std::net::ToSocketAddrs::to_socket_addrs(&(host.as_str(), port)) else {
        return false;
    };
    for addr in addrs.take(3) {
        if std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_secs(4)).is_ok() {
            return true;
        }
    }
    false
}

/// Понятная причина вместо кода выхода движка.
fn failure_reason(config: &Value, server_name: &str, tail: &str, kind: &str) -> String {
    if !have_internet() {
        return "нет интернета: проверь Wi-Fi или кабель, затем попробуй снова".into();
    }
    if !server_reachable(config) {
        return format!(
            "сервер «{server_name}» не отвечает: попробуй другой сервер или обнови подписку"
        );
    }
    if tail.is_empty() {
        kind.to_string()
    } else {
        format!("{kind}: {tail}")
    }
}

pub fn start(
    engine: &Engine,
    bin: &Path,
    config: &Value,
    log_path: &Path,
    server_name: &str,
) -> Result<EngineStatus, String> {
    stop(engine);

    if !bin.exists() {
        return Err("не найден движок sing-box.exe".into());
    }
    if !is_elevated() {
        return Err(
            "нужны права администратора: перезапусти приложение от имени администратора".into(),
        );
    }

    if let Some(dir) = log_path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }

    let cfg_path = std::env::temp_dir()
        .join("k4r-neko-vpn")
        .join("config.json");
    if let Some(dir) = cfg_path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("не удалось создать каталог: {e}"))?;
    }
    std::fs::write(
        &cfg_path,
        serde_json::to_vec_pretty(config).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("не удалось записать конфиг: {e}"))?;

    check_config(bin, &cfg_path)?;

    let log_offset = std::fs::metadata(log_path).map(|m| m.len()).unwrap_or(0);
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .map_err(|e| format!("не удалось открыть журнал: {e}"))?;

    let mut cmd = Command::new(bin);
    cmd.arg("run")
        .arg("-c")
        .arg(&cfg_path)
        .stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?))
        .stderr(Stdio::from(log))
        .stdin(Stdio::null());
    // No console window may flash when the tunnel starts.
    #[cfg(windows)]
    cmd.creation_flags(HIDE_WINDOW);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("движок не запустился: {e}"))?;

    // Give it a moment: sing-box exits immediately on bad config or busy TUN.
    std::thread::sleep(std::time::Duration::from_millis(900));
    if let Ok(Some(code)) = child.try_wait() {
        let tail = read_tail(log_path, 6);
        return Err(failure_reason(
            config,
            server_name,
            &tail,
            &format!("движок завершился с кодом {code}"),
        ));
    }
    if !wait_tunnel_ready(log_path, log_offset, std::time::Duration::from_secs(8)) {
        let _ = child.kill();
        let _ = child.wait();
        let tail = read_tail(log_path, 4);
        return Err(failure_reason(
            config,
            server_name,
            &tail,
            "движок запустился, но туннель не поднялся",
        ));
    }

    let status = EngineStatus {
        state: EngineState::Running,
        message: "туннель поднят".into(),
        server: server_name.to_string(),
        pid: child.id(),
    };

    *engine.child.lock().unwrap() = Some(child);
    *engine.config_path.lock().unwrap() = Some(cfg_path.clone());
    *engine.status.lock().unwrap() = status.clone();
    engine.wanted.store(true, Ordering::SeqCst);
    Ok(status)
}

pub fn stop(engine: &Engine) -> EngineStatus {
    stop_hold(engine);
    if let Some(mut child) = engine.child.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    engine.wanted.store(false, Ordering::SeqCst);
    let status = EngineStatus::default();
    *engine.status.lock().unwrap() = status.clone();
    status
}

/// Restarts the engine from the config already on disk (used by the supervisor).
pub fn respawn(
    engine: &Engine,
    bin: &Path,
    log_path: &Path,
    server_name: &str,
) -> Result<EngineStatus, String> {
    let cfg_path = engine
        .config_path
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "нет сохранённого конфига".to_string())?;
    if !cfg_path.exists() {
        return Err("конфиг пропал".into());
    }
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .map_err(|e| format!("не удалось открыть журнал: {e}"))?;
    let log_offset = std::fs::metadata(log_path).map(|m| m.len()).unwrap_or(0);
    let mut cmd = Command::new(bin);
    cmd.arg("run")
        .arg("-c")
        .arg(&cfg_path)
        .stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?))
        .stderr(Stdio::from(log))
        .stdin(Stdio::null());
    hidden(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("движок не запустился: {e}"))?;
    std::thread::sleep(std::time::Duration::from_millis(900));
    if let Ok(Some(code)) = child.try_wait() {
        return Err(format!("движок завершился с кодом {code}"));
    }
    if !wait_tunnel_ready(log_path, log_offset, std::time::Duration::from_secs(8)) {
        let _ = child.kill();
        let _ = child.wait();
        return Err("движок запустился, но туннель не поднялся".into());
    }
    let mut st = engine.status.lock().unwrap();
    st.state = EngineState::Running;
    st.message = "туннель восстановлен".into();
    st.server = server_name.to_string();
    st.pid = child.id();
    let out = st.clone();
    drop(st);
    *engine.child.lock().unwrap() = Some(child);
    Ok(out)
}

/// What we run when the tunnel dropped: the adapter stays up and everything
/// beyond the local network is refused, so no packet leaves in the clear.
pub fn hold_config() -> Value {
    json!({
        "log": { "level": "info", "timestamp": true },
        "dns": { "servers": [{ "type": "local", "tag": "local" }] },
        "inbounds": [{
            "type": "tun",
            "tag": "tun-in",
            "address": ["172.19.0.1/30"],
            "mtu": 1350,
            "auto_route": true,
            "strict_route": true,
            "stack": "mixed"
        }],
        "outbounds": [{ "type": "direct", "tag": "direct" }],
        "route": {
            // local network keeps working (printer, router, own PC), everything
            // else is refused until the tunnel is back
            "rules": [
                { "ip_cidr": ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "127.0.0.0/8"], "action": "route", "outbound": "direct" },
                { "ip_cidr": ["fc00::/7", "fe80::/10", "::1/128"], "action": "route", "outbound": "direct" },
                { "ip_cidr": ["0.0.0.0/0", "::/0"], "action": "reject" }
            ],
            "final": "direct",
            "auto_detect_interface": true
        }
    })
}

pub fn holding(engine: &Engine) -> bool {
    let mut guard = engine.hold.lock().unwrap();
    if let Some(child) = guard.as_mut() {
        if let Ok(Some(_)) = child.try_wait() {
            *guard = None;
            return false;
        }
        return true;
    }
    false
}

/// Brings the block up. Returns true when the process is running.
pub fn start_hold(engine: &Engine, bin: &Path, log_path: &Path) -> bool {
    if holding(engine) {
        return true;
    }
    let cfg = hold_config();
    let path = std::env::temp_dir().join("k4r-neko-vpn").join("hold.json");
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if std::fs::write(&path, serde_json::to_vec_pretty(&cfg).unwrap_or_default()).is_err() {
        return false;
    }
    let log = match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
    {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut cmd = Command::new(bin);
    cmd.arg("run")
        .arg("-c")
        .arg(&path)
        .stdout(Stdio::from(
            log.try_clone()
                .unwrap_or_else(|_| std::fs::File::create(log_path).unwrap()),
        ))
        .stderr(Stdio::from(log))
        .stdin(Stdio::null());
    hidden(&mut cmd);
    match cmd.spawn() {
        Ok(child) => {
            *engine.hold.lock().unwrap() = Some(child);
            true
        }
        Err(_) => false,
    }
}

pub fn stop_hold(engine: &Engine) {
    if let Some(mut child) = engine.hold.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

pub fn poll(engine: &Engine) -> EngineStatus {
    let mut guard = engine.child.lock().unwrap();
    if let Some(child) = guard.as_mut() {
        if let Ok(Some(code)) = child.try_wait() {
            let mut st = engine.status.lock().unwrap();
            if st.state == EngineState::Running {
                let log = engine
                    .config_path
                    .lock()
                    .unwrap()
                    .clone()
                    .map(|p| read_tail(&p.with_file_name("engine.log"), 4))
                    .unwrap_or_default();
                st.state = EngineState::Error;
                st.message = format!(
                    "туннель упал (код {code}){}{}",
                    if log.is_empty() { "" } else { ": " },
                    log
                );
            }
            *guard = None;
        }
    }
    engine.status.lock().unwrap().clone()
}

/// A running process is not the same as a working tunnel: sing-box happily
/// runs a config with no tun in it. We only call it connected when the engine
/// has really brought the adapter up.
fn wait_tunnel_ready(log_path: &Path, from: u64, timeout: std::time::Duration) -> bool {
    use std::io::{Read, Seek, SeekFrom};
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if let Ok(mut f) = std::fs::File::open(log_path) {
            if f.seek(SeekFrom::Start(from)).is_ok() {
                let mut text = String::new();
                if f.read_to_string(&mut text).is_ok() {
                    if crate::store::strip_ansi(&text).contains("started at tun") {
                        return true;
                    }
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
    false
}

fn read_tail(path: &Path, lines: usize) -> String {
    let Ok(text) = std::fs::read_to_string(path) else {
        return String::new();
    };
    let all: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    let start = all.len().saturating_sub(lines);
    all[start..].join(" | ")
}

pub fn write_log_header(path: &Path, header: &str) {
    // Разросшийся журнал убираем до открытия: на Windows открытый файл
    // переименовать нельзя, а копить его без предела нельзя тем более
    crate::store::rotate_log(path);
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(f, "\n=== {header} ===");
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn server_address_comes_from_the_first_outbound() {
        let cfg: Value = serde_json::from_str(
            r#"{"outbounds":[{"type":"selector"},{"type":"vless","server":"example.invalid","server_port":8443}]}"#,
        )
        .unwrap();
        assert_eq!(config_server(&cfg), Some(("example.invalid".into(), 8443)));
    }

    #[test]
    fn config_without_a_server_has_no_address() {
        let cfg: Value = serde_json::from_str(r#"{"outbounds":[{"type":"direct"}]}"#).unwrap();
        assert_eq!(config_server(&cfg), None);
        // недостижимый сервер без адреса — не повод говорить «сеть виновата»
        assert!(!server_reachable(&cfg));
    }

    #[test]
    fn reason_is_words_not_an_exit_code() {
        let cfg: Value = serde_json::from_str(r#"{"outbounds":[{"type":"direct"}]}"#).unwrap();
        let why = failure_reason(&cfg, "Токио", "", "движок завершился с кодом 1");
        assert!(
            why.contains("интернет") || why.contains("не отвечает"),
            "причина: {why}"
        );
    }

    use super::*;

    fn sample() -> Profile {
        Profile {
            id: "x".into(),
            name: "Test".into(),
            from_sub: true,
            host: "example.com".into(),
            port: 443,
            uuid: "11111111-2222-3333-4444-555555555555".into(),
            flow: "xtls-rprx-vision".into(),
            security: "reality".into(),
            network: "tcp".into(),
            sni: "example.com".into(),
            public_key: "jNXHt1yRo0vDuchQlIP6Z0ZvjT3KtzVI-T4E7RoLJS0".into(),
            short_id: "ab".into(),
            fingerprint: "chrome".into(),
            service_name: "api".into(),
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
    fn trojan_goes_out_as_trojan() {
        let mut profile = sample();
        profile.kind = "trojan".into();
        profile.password = "pw".into();
        let cfg = build_config(&profile, &[], &NetOptions::default());
        let out = &cfg["outbounds"][0];
        assert_eq!(out["type"], "trojan");
        assert_eq!(out["password"], "pw");
        assert_eq!(out["tls"]["enabled"], true);
    }

    #[test]
    fn shadowsocks_goes_out_as_shadowsocks() {
        let mut profile = sample();
        profile.kind = "shadowsocks".into();
        profile.method = "aes-256-gcm".into();
        profile.password = "sspw".into();
        let cfg = build_config(&profile, &[], &NetOptions::default());
        let out = &cfg["outbounds"][0];
        assert_eq!(out["type"], "shadowsocks");
        assert_eq!(out["method"], "aes-256-gcm");
        assert_eq!(out["password"], "sspw");
    }

    #[test]
    fn vmess_goes_out_as_vmess() {
        let mut profile = sample();
        profile.kind = "vmess".into();
        profile.network = "ws".into();
        profile.path = "/vm".into();
        let cfg = build_config(&profile, &[], &NetOptions::default());
        let out = &cfg["outbounds"][0];
        assert_eq!(out["type"], "vmess");
        assert_eq!(out["alter_id"], 0);
        assert_eq!(out["security"], "auto");
        assert_eq!(out["transport"]["type"], "ws");
    }

    #[test]
    fn ipv6_is_rejected_when_requested() {
        let opts = NetOptions {
            split_mode: "all".into(),
            ..NetOptions::default()
        };
        let cfg = build_config(&sample(), &[], &opts);
        let rules = cfg["route"]["rules"].as_array().unwrap();
        let has_v6_block = rules
            .iter()
            .any(|r| r["ip_version"] == serde_json::json!(6) && r["action"] == "reject");
        assert!(has_v6_block, "IPv6 must not leave the tunnel");
    }

    #[test]
    fn system_dns_mode_uses_the_operator_resolver() {
        let opts = NetOptions {
            dns_mode: "system".into(),
            block_ipv6: true,
            dns_server: "1.1.1.1".into(),
            ..NetOptions::default()
        };
        let cfg = build_config(&sample(), &[], &opts);
        assert_eq!(cfg["dns"]["final"], "system");
        assert_eq!(cfg["route"]["default_domain_resolver"], "system");
        assert!(cfg["dns"]["servers"].as_array().unwrap().len() == 1);
    }

    #[test]
    fn tunnel_dns_mode_prefers_our_resolver() {
        // "all traffic" mode: everything resolves through our resolver
        let opts = NetOptions {
            split_mode: "all".into(),
            ..NetOptions::default()
        };
        let cfg = build_config(&sample(), &[], &opts);
        assert_eq!(cfg["dns"]["final"], "remote");
        assert_eq!(cfg["dns"]["strategy"], "ipv4_only");
    }

    #[test]
    fn whitelist_mode_resolves_privately_only_for_chosen_programs() {
        let opts = NetOptions {
            split_mode: "only".into(),
            tunnel_apps: vec!["telegram.exe".into()],
            ..NetOptions::default()
        };
        let cfg = build_config(&sample(), &[], &opts);
        // one encrypted resolver, and it must not be dialled through the tunnel
        assert_eq!(cfg["dns"]["final"], "remote");
        assert!(cfg["dns"]["servers"][0].get("detour").is_none());
        assert_eq!(cfg["route"]["default_domain_resolver"], "remote");
    }

    #[test]
    fn generated_config_is_accepted_by_the_engine() {
        let bin = sidecar_path(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources"));
        // Ядро весит десятки мегабайт и в git не лежит: в CI на его месте
        // пустая заглушка, и проверять конфиг настоящим движком нечем.
        // Пропускаем вслух, а не притворяемся, что проверили.
        let real = std::fs::metadata(&bin).map(|m| m.len()).unwrap_or(0) > 1_000_000;
        if !real {
            eprintln!("sing-box нет рядом — проверка конфига движком пропущена");
            return;
        }
        let cfg = build_config(
            &sample(),
            &["steam.exe".to_string()],
            &NetOptions::default(),
        );
        let path = std::env::temp_dir().join("k4r-neko-vpn-test-config.json");
        std::fs::write(&path, serde_json::to_vec_pretty(&cfg).unwrap()).unwrap();
        check_config(&bin, &path).expect("engine rejected the generated config");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn own_rule_sends_a_domain_directly() {
        let opts = NetOptions {
            rules: vec![RouteRule {
                kind: "suffix".into(),
                value: "ozon.ru".into(),
                action: "direct".into(),
                enabled: true,
            }],
            ..NetOptions::default()
        };
        let cfg = build_config(&sample(), &[], &opts);
        let rules = cfg["route"]["rules"].as_array().unwrap();
        let found = rules
            .iter()
            .find(|r| r["domain_suffix"][0] == "ozon.ru")
            .expect("правило не попало в конфиг");
        assert_eq!(found["outbound"], "direct");
    }

    #[test]
    fn blocked_rule_rejects_instead_of_routing() {
        let opts = NetOptions {
            rules: vec![RouteRule {
                kind: "domain".into(),
                value: "ads.example".into(),
                action: "block".into(),
                enabled: true,
            }],
            ..NetOptions::default()
        };
        let cfg = build_config(&sample(), &[], &opts);
        let rules = cfg["route"]["rules"].as_array().unwrap();
        let found = rules
            .iter()
            .find(|r| r["domain"][0] == "ads.example")
            .unwrap();
        assert_eq!(found["action"], "reject");
        assert!(found.get("outbound").is_none());
    }

    #[test]
    fn disabled_and_broken_rules_are_skipped() {
        let opts = NetOptions {
            rules: vec![
                RouteRule {
                    kind: "suffix".into(),
                    value: "off.example".into(),
                    action: "proxy".into(),
                    enabled: false,
                },
                RouteRule {
                    kind: "suffix".into(),
                    value: "   ".into(),
                    action: "proxy".into(),
                    enabled: true,
                },
                RouteRule {
                    kind: "nonsense".into(),
                    value: "x.example".into(),
                    action: "proxy".into(),
                    enabled: true,
                },
                RouteRule {
                    kind: "suffix".into(),
                    value: "bad.example".into(),
                    action: "teleport".into(),
                    enabled: true,
                },
            ],
            ..NetOptions::default()
        };
        let cfg = build_config(&sample(), &[], &opts);
        let rules = cfg["route"]["rules"].as_array().unwrap();
        assert!(!rules.iter().any(|r| r.get("domain_suffix").is_some()));
    }

    #[test]
    fn own_rules_come_before_program_split() {
        // «этот домен напрямую» не должен проигрывать правилу «эта программа в туннель»
        let opts = NetOptions {
            split_mode: "only".into(),
            tunnel_apps: vec!["browser.exe".into()],
            rules: vec![RouteRule {
                kind: "suffix".into(),
                value: "gosuslugi.ru".into(),
                action: "direct".into(),
                enabled: true,
            }],
            ..NetOptions::default()
        };
        let cfg = build_config(&sample(), &[], &opts);
        let rules = cfg["route"]["rules"].as_array().unwrap();
        let own = rules
            .iter()
            .position(|r| r.get("domain_suffix").is_some())
            .unwrap();
        let program = rules
            .iter()
            .position(|r| r.get("process_name").is_some())
            .unwrap();
        assert!(own < program);
    }

    fn wg_sample() -> Profile {
        Profile {
            kind: "wireguard".into(),
            password: String::new(),
            method: String::new(),
            alter_id: 0,
            host: "engage.cloudflareclient.com".into(),
            port: 2408,
            wg_private_key: "priv".into(),
            wg_peer_public_key: "peer".into(),
            wg_addresses: vec!["172.16.0.2/32".into()],
            wg_mtu: 1280,
            wg_reserved: vec![1, 2, 3],
            ..sample()
        }
    }

    #[test]
    fn wireguard_profile_builds_wireguard_outbound() {
        let cfg = build_config(&wg_sample(), &[], &NetOptions::default());
        let out = &cfg["outbounds"][0];
        assert_eq!(out["type"], "wireguard");
        assert_eq!(out["server"], "engage.cloudflareclient.com");
        assert_eq!(out["server_port"], 2408);
        assert_eq!(out["mtu"], 1280);
        assert_eq!(out["local_address"][0], "172.16.0.2/32");
        assert_eq!(out["reserved"], json!([1, 2, 3]));
        // у WireGuard нет ни UUID, ни TLS — их быть не должно
        assert!(out.get("uuid").is_none());
        assert!(out.get("tls").is_none());
    }

    #[test]
    fn plain_wireguard_has_no_reserved_field() {
        let mut profile = wg_sample();
        profile.wg_reserved.clear();
        profile.wg_mtu = 0;
        let cfg = build_config(&profile, &[], &NetOptions::default());
        let out = &cfg["outbounds"][0];
        assert!(out.get("reserved").is_none());
        // нулевой MTU заменяется рабочим значением, иначе ядро ругается
        assert_eq!(out["mtu"], 1280);
    }

    #[test]
    fn game_mode_sends_its_ports_direct() {
        // Игровой режим не должен утаскивать в туннель голос и игровые порты.
        let opts = NetOptions {
            game_mode: true,
            game_ports: GAME_PORTS.iter().map(|p| p.to_string()).collect(),
            ..NetOptions::default()
        };
        let cfg = build_config(&sample(), &[], &opts);
        let rules = cfg["route"]["rules"].as_array().unwrap();
        let game = rules
            .iter()
            .find(|r| r.get("port").is_some())
            .expect("game rule");
        assert_eq!(game["outbound"], "direct");
        let ports: Vec<String> = game["port"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect();
        assert!(ports.iter().any(|p| p == "27015:27050"));
        // Разделитель обязан быть в формате sing-box, а не дефисом.
        assert!(ports.iter().all(|p| !p.contains('-')));
    }

    #[test]
    fn game_mode_off_adds_no_port_rule() {
        let opts = NetOptions::default();
        let cfg = build_config(&sample(), &[], &opts);
        let rules = cfg["route"]["rules"].as_array().unwrap();
        assert!(!rules.iter().any(|r| r.get("port").is_some()));
    }

    #[test]
    fn ru_direct_preset_adds_lists_and_cache() {
        let opts = NetOptions {
            route_ru_direct: true,
            cache_path: "C:/data/rule-sets.db".into(),
            ..NetOptions::default()
        };
        let cfg = build_config(&sample(), &[], &opts);
        let sets = cfg["route"]["rule_set"].as_array().unwrap();
        let tags: Vec<&str> = sets.iter().map(|s| s["tag"].as_str().unwrap()).collect();
        assert_eq!(tags, vec!["ru-domains", "ru-ips"]);
        assert_eq!(sets[0]["format"], "binary");
        assert_eq!(
            cfg["experimental"]["cache_file"]["path"],
            "C:/data/rule-sets.db"
        );
        let rules = cfg["route"]["rules"].as_array().unwrap();
        assert!(rules
            .iter()
            .any(|r| r["rule_set"][0] == "ru-domains" && r["outbound"] == "direct"));
    }

    /// Кэш списков и endpoint счётчиков должны жить вместе: иначе ядро качает
    /// списки при каждом запуске, и туннель поднимается заметно дольше.
    #[test]
    fn cache_and_api_live_together() {
        let opts = NetOptions {
            route_ru_direct: true,
            cache_path: "C:/data/rule-sets.db".into(),
            api_port: 9999,
            api_secret: "s3cret".into(),
            ..NetOptions::default()
        };
        let cfg = build_config(&sample(), &[], &opts);
        assert_eq!(cfg["experimental"]["cache_file"]["path"], "C:/data/rule-sets.db");
        assert_eq!(
            cfg["experimental"]["clash_api"]["external_controller"],
            "127.0.0.1:9999"
        );
        assert_eq!(cfg["experimental"]["clash_api"]["secret"], "s3cret");
    }

    #[test]
    fn ads_preset_rejects_and_no_lists_no_cache() {
        let plain = build_config(&sample(), &[], &NetOptions::default());
        assert!(plain["route"].get("rule_set").is_none());
        assert!(plain.get("experimental").is_none());

        let opts = NetOptions {
            route_block_ads: true,
            game_mode: false,
            game_ports: Vec::new(),
            ..NetOptions::default()
        };
        let cfg = build_config(&sample(), &[], &opts);
        let rules = cfg["route"]["rules"].as_array().unwrap();
        assert!(rules
            .iter()
            .any(|r| r["rule_set"][0] == "ads" && r["action"] == "reject"));
    }

    #[test]
    fn engine_accepts_a_config_with_routing_rules() {
        let bin = sidecar_path(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources"));
        let real = std::fs::metadata(&bin).map(|m| m.len()).unwrap_or(0) > 1_000_000;
        if !real {
            eprintln!("sing-box нет рядом — проверка правил движком пропущена");
            return;
        }
        let opts = NetOptions {
            rules: vec![
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
                    enabled: true,
                },
                RouteRule {
                    kind: "keyword".into(),
                    value: "tracker".into(),
                    action: "proxy".into(),
                    enabled: true,
                },
            ],
            route_ru_direct: true,
            route_block_ads: true,
            cache_path: std::env::temp_dir()
                .join("k4r-rule-sets.db")
                .display()
                .to_string(),
            ..NetOptions::default()
        };
        let cfg = build_config(&sample(), &["steam.exe".to_string()], &opts);
        let path = std::env::temp_dir().join("k4r-neko-vpn-rules-test.json");
        std::fs::write(&path, serde_json::to_vec_pretty(&cfg).unwrap()).unwrap();
        check_config(&bin, &path).expect("engine rejected a config with routing rules");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn grpc_transport_carries_service_name() {
        let mut p = sample();
        p.network = "grpc".into();
        let cfg = build_config(&p, &[], &NetOptions::default());
        assert_eq!(cfg["outbounds"][0]["transport"]["type"], "grpc");
        assert_eq!(cfg["outbounds"][0]["transport"]["service_name"], "api");
        assert_eq!(
            cfg["outbounds"][0]["tls"]["reality"]["public_key"],
            "jNXHt1yRo0vDuchQlIP6Z0ZvjT3KtzVI-T4E7RoLJS0"
        );
    }

    #[test]
    fn start_reports_missing_engine_instead_of_panicking() {
        let engine = Engine::default();
        let missing = std::env::temp_dir().join("k4r-no-such-sing-box.exe");
        let cfg = build_config(&sample(), &[], &NetOptions::default());
        let log = std::env::temp_dir().join("k4r-neko-vpn-test.log");
        let err = start(&engine, &missing, &cfg, &log, "Test").unwrap_err();
        assert!(err.contains("sing-box"), "unexpected error: {err}");
        assert_eq!(poll(&engine).state, EngineState::Idle);
    }

    #[test]
    fn split_rule_reaches_direct_outbound() {
        let opts = NetOptions {
            split_mode: "all".into(),
            ..NetOptions::default()
        };
        let cfg = build_config(&sample(), &["steam.exe".to_string()], &opts);
        let rules = cfg["route"]["rules"].as_array().unwrap();
        assert!(rules
            .iter()
            .any(|r| r["outbound"] == "direct" && r["process_name"][0] == "steam.exe"));
        assert_eq!(cfg["route"]["final"], "proxy");
        // direct wins over the IPv6 reject, or an excluded app would lose its stack
        let direct_at = rules
            .iter()
            .position(|r| r["outbound"] == "direct" && r.get("process_name").is_some())
            .unwrap();
        let v6_at = rules.iter().position(|r| r["ip_version"] == 6).unwrap();
        assert!(
            direct_at < v6_at,
            "process rule must come before the IPv6 reject"
        );
    }

    #[test]
    fn dns_server_accepts_plain_address_and_doh_url() {
        let plain = NetOptions {
            dns_server: "9.9.9.9".into(),
            ..NetOptions::default()
        };
        let cfg = build_config(&sample(), &[], &plain);
        assert_eq!(cfg["dns"]["servers"][0]["type"], "https");
        assert_eq!(cfg["dns"]["servers"][0]["server"], "9.9.9.9");

        let doh = NetOptions {
            dns_server: "https://dns.google/dns-query".into(),
            ..NetOptions::default()
        };
        let cfg = build_config(&sample(), &[], &doh);
        assert_eq!(cfg["dns"]["servers"][0]["type"], "https");
        assert_eq!(cfg["dns"]["servers"][0]["server"], "dns.google");

        let dot = NetOptions {
            dns_server: "tls://1.1.1.1".into(),
            ..NetOptions::default()
        };
        let cfg = build_config(&sample(), &[], &dot);
        assert_eq!(cfg["dns"]["servers"][0]["type"], "tls");
    }

    #[test]
    fn only_chosen_programs_go_through_the_tunnel() {
        let opts = NetOptions {
            split_mode: "only".into(),
            tunnel_apps: vec!["telegram.exe".into()],
            ..NetOptions::default()
        };
        let cfg = build_config(&sample(), &[], &opts);
        assert_eq!(
            cfg["route"]["final"], "direct",
            "everything else must stay direct"
        );
        let rules = cfg["route"]["rules"].as_array().unwrap();
        let tunnel_rule = rules
            .iter()
            .position(|r| r["outbound"] == "proxy" && r["process_name"][0] == "telegram.exe")
            .expect("chosen program must have a proxy rule");
        // the local network rule comes first so LAN keeps working
        let lan_rule = rules
            .iter()
            .position(|r| r["ip_is_private"] == true)
            .expect("private networks must stay direct");
        assert!(lan_rule < tunnel_rule);
        // IPv6 is only refused for the tunnelled program, never for everyone
        let v6 = rules.iter().find(|r| r["ip_version"] == 6);
        if let Some(rule) = v6 {
            assert!(
                rule.get("process_name").is_some(),
                "IPv6 reject must be scoped to the chosen programs"
            );
        }
    }

    #[test]
    fn empty_whitelist_tunnels_nothing() {
        let opts = NetOptions {
            split_mode: "only".into(),
            ..NetOptions::default()
        };
        let cfg = build_config(&sample(), &[], &opts);
        let rules = cfg["route"]["rules"].as_array().unwrap();
        assert!(!rules.iter().any(|r| r["outbound"] == "proxy"));
        assert_eq!(cfg["route"]["final"], "direct");
    }
}
