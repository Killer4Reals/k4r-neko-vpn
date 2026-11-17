// Проверка прокси для Telegram: поднимаем туннель так же, как приложение, и
// заходим в интернет через локальный SOCKS5 — адрес должен стать адресом VPN.
use k4r_neko_vpn_lib::{engine, store};
use std::io::Write;

fn ip(args: &[&str]) -> String {
    let out = std::process::Command::new("curl.exe").args(args).output();
    match out {
        Ok(o) => {
            let text = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if text.is_empty() {
                let err = String::from_utf8_lossy(&o.stderr).to_string();
                format!(
                    "пусто: {}",
                    err.lines().rev().take(2).collect::<Vec<_>>().join(" | ")
                )
            } else {
                text
            }
        }
        Err(e) => format!("curl не запустился: {e}"),
    }
}

fn main() {
    let dir = std::env::var("APPDATA")
        .map(std::path::PathBuf::from)
        .unwrap()
        .join("ink.k4r.nekoneko.vpn");
    let st = store::load(&dir);
    let Some(profile) = st
        .profiles
        .iter()
        .find(|p| p.host.starts_with("bisw222"))
        .or_else(|| st.profiles.first())
        .cloned()
    else {
        println!("нет профилей");
        return;
    };

    let opts = engine::NetOptions {
        dns_mode: "tunnel".into(),
        block_ipv6: true,
        dns_server: "1.1.1.1".into(),
        api_port: engine::free_port(),
        api_secret: engine::api_secret(),
        split_mode: "only".into(),
        tunnel_apps: vec!["curltest.exe".into()],
        gateway: engine::default_gateway(),
        tg_port: 1354,
        ..engine::NetOptions::default()
    };
    let cfg = engine::build_config(&profile, &[], &opts);
    let bin =
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/bin/sing-box.exe");
    let log = dir.join("logs").join("engine.log");
    let eng = engine::Engine::default();
    *eng.api.lock().unwrap() = Some((opts.api_port, opts.api_secret.clone()));

    let mut out = String::new();
    out += &format!(
        "до туннеля: {}\n",
        ip(&["-sS", "-m", "12", "https://api.ipify.org"])
    );
    match engine::start(&eng, &bin, &cfg, &log, &profile.name) {
        Ok(s) => out += &format!("туннель: {:?}\n", s.state),
        Err(e) => {
            out += &format!("ошибка старта: {e}\n");
            print!("{out}");
            return;
        }
    }
    std::thread::sleep(std::time::Duration::from_secs(7));

    out += &format!(
        "через SOCKS5 127.0.0.1:1354: {}\n",
        ip(&[
            "-sS",
            "-m",
            "15",
            "--socks5-hostname",
            "127.0.0.1:1354",
            "https://api.ipify.org"
        ])
    );
    out += &format!(
        "напрямую в это время: {}\n",
        ip(&["-sS", "-m", "12", "https://api.ipify.org"])
    );

    engine::stop(&eng);
    std::thread::sleep(std::time::Duration::from_millis(900));
    out += &format!(
        "после остановки: {}\n",
        ip(&["-sS", "-m", "12", "https://api.ipify.org"])
    );

    print!("{out}");
    let _ = std::fs::File::create(std::env::temp_dir().join("k4r-tg-probe.txt"))
        .and_then(|mut f| f.write_all(out.as_bytes()));
}
