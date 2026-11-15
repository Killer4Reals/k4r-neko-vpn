// Проверяет, жив ли сам прокси: режим «весь трафик», DNS системный.
use k4r_neko_vpn_lib::{engine, store};

fn ip(exe: &str) -> String {
    let out = std::process::Command::new(exe)
        .args(["-sS", "--ssl-no-revoke", "-m", "12", "https://api.ipify.org"])
        .output();
    match out {
        Ok(o) => {
            let t = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if t.is_empty() { format!("FAIL({:?})", o.status.code()) } else { t }
        }
        Err(e) => format!("ERR {e}"),
    }
}

fn main() {
    let dir = std::env::var("APPDATA").map(std::path::PathBuf::from).unwrap().join("ink.k4r.nekoneko.vpn");
    let st = store::load(&dir);
    let profile = st.profiles.iter()
        .find(|p| format!("{}:{}:{}", p.host, p.port, p.uuid) == st.selected)
        .or_else(|| st.profiles.first()).cloned().expect("нет профилей");
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| String::from(r"C:\Windows"));
    let curl = format!(r"{root}\System32\curl.exe");

    let opts = engine::NetOptions {
        dns_mode: "system".into(),
        block_ipv6: false,
        dns_server: "1.1.1.1".into(),
        api_port: engine::free_port(),
        api_secret: engine::api_secret(),
        split_mode: "all".into(),
        tunnel_apps: Vec::new(),
        gateway: engine::default_gateway(),
        tg_port: 0,
    };
    let cfg = engine::build_config(&profile, &[], &opts);
    let bin = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/bin/sing-box.exe");
    let log = dir.join("logs").join("engine.log");
    let eng = engine::Engine::default();
    *eng.api.lock().unwrap() = Some((opts.api_port, opts.api_secret.clone()));

    println!("до: {}", ip(&curl));
    match engine::start(&eng, &bin, &cfg, &log, &profile.name) {
        Ok(_) => {
            std::thread::sleep(std::time::Duration::from_secs(4));
            println!("через прокси: {}", ip(&curl));
            let t = engine::traffic(&eng);
            println!("счётчики: down {} up {}", t.total_down, t.total_up);
        }
        Err(e) => println!("старт не удался: {e}"),
    }
    engine::stop(&eng);
}
