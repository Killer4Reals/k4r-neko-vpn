use serde::Serialize;
use serde_json::{json, Value};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

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
    pub config_path: Mutex<Option<PathBuf>>,
    /// false when the user pressed "disconnect": the supervisor must not reconnect
    pub wanted: AtomicBool,
}

impl Default for Engine {
    fn default() -> Self {
        Self {
            status: Mutex::new(EngineStatus::default()),
            child: Mutex::new(None),
            config_path: Mutex::new(None),
            wanted: AtomicBool::new(false),
        }
    }
}

/// Choices that change the generated config but not the server.
#[derive(Debug, Clone)]
pub struct NetOptions {
    /// "tunnel" resolves through the tunnel, "system" keeps the provider's DNS
    pub dns_mode: String,
    pub block_ipv6: bool,
    pub dns_server: String,
}

impl Default for NetOptions {
    fn default() -> Self {
        Self {
            dns_mode: "tunnel".into(),
            block_ipv6: true,
            dns_server: "1.1.1.1".into(),
        }
    }
}

/// Builds a sing-box config: TUN in, VLESS out, split tunneling by process name.
pub fn build_config(profile: &Profile, excluded: &[String], opts: &NetOptions) -> Value {
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

    let mut rules = vec![
        json!({ "action": "sniff" }),
        json!({ "protocol": "dns", "action": "hijack-dns" }),
        json!({ "ip_is_private": true, "outbound": "direct" }),
    ];
    if !excluded.is_empty() {
        // First, before anything else: a program the owner sends direct keeps its
        // own stack, including IPv6. Otherwise the IPv6 reject below would cut it.
        rules.push(json!({ "process_name": excluded, "outbound": "direct" }));
    }
    if opts.block_ipv6 {
        // IPv6 would otherwise leave outside the tunnel: that is a leak
        rules.push(json!({ "ip_version": 6, "action": "reject" }));
    }

    let dns = if opts.dns_mode == "system" {
        json!({
            "servers": [{ "type": "local", "tag": "system" }],
            "final": "system",
            "strategy": if opts.block_ipv6 { "ipv4_only" } else { "prefer_ipv4" }
        })
    } else {
        json!({
            "servers": [
                { "type": "https", "tag": "remote", "server": opts.dns_server },
                { "type": "local", "tag": "system" }
            ],
            "final": "remote",
            "strategy": if opts.block_ipv6 { "ipv4_only" } else { "prefer_ipv4" }
        })
    };
    let resolver = if opts.dns_mode == "system" { "system" } else { "remote" };

    json!({
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
            "final": "proxy",
            "auto_detect_interface": true,
            "default_domain_resolver": resolver
        }
    })
}

pub fn is_elevated() -> bool {
    // Writing to the hosts file is admin-only; read-only check, nothing is changed.
    std::fs::OpenOptions::new()
        .append(true)
        .open("C:\\Windows\\System32\\drivers\\etc\\hosts")
        .is_ok()
}

/// Finds the bundled engine in every layout we ship: installed, portable, dev.
pub fn sidecar_path(resource_dir: &Path) -> PathBuf {
    let mut candidates = vec![
        resource_dir.join("bin").join("sing-box.exe"),
        resource_dir.join("resources").join("bin").join("sing-box.exe"),
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

pub fn check_config(bin: &Path, config: &Path) -> Result<(), String> {
    let out = Command::new(bin)
        .arg("check")
        .arg("-c")
        .arg(config)
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
        return Err("нужны права администратора: перезапусти приложение от имени администратора".into());
    }

    if let Some(dir) = log_path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }

    let cfg_path = std::env::temp_dir().join("k4r-neko-vpn").join("config.json");
    if let Some(dir) = cfg_path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("не удалось создать каталог: {e}"))?;
    }
    std::fs::write(
        &cfg_path,
        serde_json::to_vec_pretty(config).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("не удалось записать конфиг: {e}"))?;

    check_config(bin, &cfg_path)?;

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
        return Err(format!(
            "движок завершился с кодом {code}{}",
            if tail.is_empty() { String::new() } else { format!(": {tail}") }
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
    std::thread::sleep(std::time::Duration::from_millis(900));
    if let Ok(Some(code)) = child.try_wait() {
        return Err(format!("движок завершился с кодом {code}"));
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

fn read_tail(path: &Path, lines: usize) -> String {
    let Ok(text) = std::fs::read_to_string(path) else {
        return String::new();
    };
    let all: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    let start = all.len().saturating_sub(lines);
    all[start..].join(" | ")
}

pub fn write_log_header(path: &Path, header: &str) {
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
    use super::*;

    fn sample() -> Profile {
        Profile {
            id: "x".into(),
            name: "Test".into(),
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
        }
    }

    #[test]
    fn ipv6_is_rejected_when_requested() {
        let cfg = build_config(&sample(), &[], &NetOptions::default());
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
        };
        let cfg = build_config(&sample(), &[], &opts);
        assert_eq!(cfg["dns"]["final"], "system");
        assert_eq!(cfg["route"]["default_domain_resolver"], "system");
        assert!(cfg["dns"]["servers"].as_array().unwrap().len() == 1);
    }

    #[test]
    fn tunnel_dns_mode_prefers_our_resolver() {
        let cfg = build_config(&sample(), &[], &NetOptions::default());
        assert_eq!(cfg["dns"]["final"], "remote");
        assert_eq!(cfg["dns"]["strategy"], "ipv4_only");
    }

    #[test]
    fn generated_config_is_accepted_by_the_engine() {
        let bin = sidecar_path(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources"));
        assert!(bin.exists(), "sing-box.exe missing at {}", bin.display());
        let cfg = build_config(&sample(), &["steam.exe".to_string()], &NetOptions::default());
        let path = std::env::temp_dir().join("k4r-neko-vpn-test-config.json");
        std::fs::write(&path, serde_json::to_vec_pretty(&cfg).unwrap()).unwrap();
        check_config(&bin, &path).expect("engine rejected the generated config");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn grpc_transport_carries_service_name() {
        let mut p = sample();
        p.network = "grpc".into();
        let cfg = build_config(&p, &[], &NetOptions::default());
        assert_eq!(cfg["outbounds"][0]["transport"]["type"], "grpc");
        assert_eq!(cfg["outbounds"][0]["transport"]["service_name"], "api");
        assert_eq!(cfg["outbounds"][0]["tls"]["reality"]["public_key"], "jNXHt1yRo0vDuchQlIP6Z0ZvjT3KtzVI-T4E7RoLJS0");
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
        let cfg = build_config(&sample(), &["steam.exe".to_string()], &NetOptions::default());
        let rules = cfg["route"]["rules"].as_array().unwrap();
        assert!(rules.iter().any(|r| r["outbound"] == "direct" && r["process_name"][0] == "steam.exe"));
        assert_eq!(cfg["route"]["final"], "proxy");
        // direct wins over the IPv6 reject, or an excluded app would lose its stack
        let direct_at = rules.iter().position(|r| r["outbound"] == "direct" && r.get("process_name").is_some()).unwrap();
        let v6_at = rules.iter().position(|r| r["ip_version"] == 6).unwrap();
        assert!(direct_at < v6_at, "process rule must come before the IPv6 reject");
    }
}
