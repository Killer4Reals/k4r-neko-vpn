// Перебирает варианты DNS внутри режима «только выбранные» и говорит, какой
// реально работает с нашим сервером. Туннель поднимается и гасится сам.
use k4r_neko_vpn_lib::{engine, store};
use std::io::Write;

fn ip(exe: &str) -> String {
    let out = std::process::Command::new(exe)
        .args([
            "-sS",
            "--ssl-no-revoke",
            "-m",
            "10",
            "https://api.ipify.org",
        ])
        .output();
    match out {
        Ok(o) => {
            let t = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if t.is_empty() {
                format!("FAIL({:?})", o.status.code())
            } else {
                t
            }
        }
        Err(e) => format!("ERR {e}"),
    }
}

fn variant(cfg: &mut serde_json::Value, kind: &str, server: &str, detour: bool, rules: bool) {
    let mut srv = serde_json::json!({ "type": kind, "tag": "remote", "server": server });
    if detour {
        srv["detour"] = serde_json::json!("proxy");
    }
    let plain = serde_json::json!({ "type": "udp", "tag": "plain", "server": server });
    let mut dns = serde_json::json!({
        "servers": [srv, plain],
        "final": if rules { "plain" } else { "remote" },
        "strategy": "ipv4_only"
    });
    if rules {
        dns["rules"] =
            serde_json::json!([{ "process_name": ["curltest.exe"], "server": "remote" }]);
    }
    cfg["dns"] = dns;
}

fn main() {
    let dir = std::env::var("APPDATA")
        .map(std::path::PathBuf::from)
        .unwrap()
        .join("ink.k4r.nekoneko.vpn");
    let st = store::load(&dir);
    let profile = st
        .profiles
        .iter()
        .find(|p| format!("{}:{}:{}", p.host, p.port, p.uuid) == st.selected)
        .or_else(|| st.profiles.first())
        .cloned()
        .expect("нет профилей");

    let probe_dir = std::env::temp_dir().join("k4r-dns-matrix");
    let _ = std::fs::create_dir_all(&probe_dir);
    let copy = probe_dir.join("curltest.exe");
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| String::from(r"C:\Windows"));
    let real = format!(r"{root}\System32\curl.exe");
    let _ = std::fs::copy(&real, &copy);
    let copy = copy.to_string_lossy().to_string();

    let gateway = engine::default_gateway();

    let opts = engine::NetOptions {
        dns_mode: "tunnel".into(),
        block_ipv6: true,
        dns_server: "1.1.1.1".into(),
        api_port: engine::free_port(),
        api_secret: engine::api_secret(),
        split_mode: "only".into(),
        tunnel_apps: vec!["curltest.exe".into()],
        gateway: gateway.clone(),
        tg_port: 0,
        ..engine::NetOptions::default()
    };
    let bin =
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/bin/sing-box.exe");
    let log = dir.join("logs").join("engine.log");

    let cases: Vec<(&str, &str, &str, bool, bool)> = vec![
        ("only, DoH via proxy", "https", "1.1.1.1", true, true),
        (
            "only, DoH via proxy, dns.google",
            "https",
            "dns.google",
            true,
            true,
        ),
        ("only, UDP 1.1.1.1 via proxy", "udp", "1.1.1.1", true, true),
        ("only, everyone via router", "https", "1.1.1.1", true, false),
    ];

    let mut out = String::new();
    let direct_before = ip(&real);
    out += &format!("напрямую: {direct_before}\nроутер: {gateway}\n\n");

    for (name, kind, server, detour, rules) in cases {
        let eng = engine::Engine::default();
        *eng.api.lock().unwrap() = Some((opts.api_port, opts.api_secret.clone()));
        let mut cfg = engine::build_config(&profile, &[], &opts);
        variant(&mut cfg, kind, server, detour, rules);
        match engine::start(&eng, &bin, &cfg, &log, &profile.name) {
            Ok(_) => {
                std::thread::sleep(std::time::Duration::from_secs(3));
                let tunnelled = ip(&copy);
                let direct = ip(&real);
                out += &format!("{name}:\n  в списке: {tunnelled}\n  напрямую: {direct}\n");
            }
            Err(e) => out += &format!("{name}: старт не удался: {e}\n"),
        }
        engine::stop(&eng);
        std::thread::sleep(std::time::Duration::from_secs(2));
    }

    print!("{out}");
    let _ = std::fs::File::create(probe_dir.join("result.txt"))
        .and_then(|mut f| f.write_all(out.as_bytes()));
}
