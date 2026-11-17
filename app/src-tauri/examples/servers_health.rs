// Проверяет несколько серверов подряд: жив ли прокси вообще или дело в аккаунте.
use k4r_neko_vpn_lib::{engine, store};

fn ip() -> String {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| String::from(r"C:\Windows"));
    let curl = format!(r"{root}\System32\curl.exe");
    let out = std::process::Command::new(&curl)
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

fn main() {
    let dir = std::env::var("APPDATA")
        .map(std::path::PathBuf::from)
        .unwrap()
        .join("ink.k4r.nekoneko.vpn");
    let st = store::load(&dir);
    let bin =
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/bin/sing-box.exe");
    let log = dir.join("logs").join("engine.log");
    println!("всего профилей: {}", st.profiles.len());
    for profile in st.profiles.iter().take(4) {
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
            ..engine::NetOptions::default()
        };
        let cfg = engine::build_config(profile, &[], &opts);
        let eng = engine::Engine::default();
        *eng.api.lock().unwrap() = Some((opts.api_port, opts.api_secret.clone()));
        print!("{} ({}:{}) -> ", profile.name, profile.host, profile.port);
        match engine::start(&eng, &bin, &cfg, &log, &profile.name) {
            Ok(_) => {
                std::thread::sleep(std::time::Duration::from_secs(4));
                println!("{}", ip());
            }
            Err(e) => println!("старт не удался: {e}"),
        }
        engine::stop(&eng);
        std::thread::sleep(std::time::Duration::from_secs(2));
    }
}
