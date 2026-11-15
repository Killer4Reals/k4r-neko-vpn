// Проверка режима «только выбранные программы»: посторонний процесс идёт
// напрямую, а копия curl с другим именем — через VPN. Туннель глушится сам.
use k4r_neko_vpn_lib::{engine, store};
use std::io::Write;

fn ip_via(exe: &str, socks_ok: bool) -> String {
    let out = std::process::Command::new(exe)
        .args(["-sS", "-v", "--ssl-no-revoke", "-m", "15", "https://api.ipify.org"])
        .output();
    match out {
        Ok(o) if socks_ok => {
            let text = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if text.is_empty() {
                let err = String::from_utf8_lossy(&o.stderr).to_string();
                let tail: String = err.lines().rev().take(4).collect::<Vec<_>>().join(" | ");
                format!("пусто (код {:?}): {tail}", o.status.code())
            } else {
                format!("{text} (строк лога: {})", String::from_utf8_lossy(&o.stderr).lines().count())
            }
        }
        _ => "n/a".into(),
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
        .find(|p| format!("{}:{}:{}", p.host, p.port, p.uuid) == st.selected)
        .or_else(|| st.profiles.first())
        .cloned()
    else {
        println!("нет профилей");
        return;
    };

    // только наша тестовая копия идёт в туннель
    let probe_dir = std::env::temp_dir().join("k4r-whitelist-probe");
    let _ = std::fs::create_dir_all(&probe_dir);
    let copy = probe_dir.join("curltest.exe");
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| String::from(r"C:\Windows"));
    let real_curl = format!(r"{root}\System32\curl.exe");
    let _ = std::fs::copy(&real_curl, &copy);

    let opts = engine::NetOptions {
        dns_mode: "tunnel".into(),
        block_ipv6: true,
        dns_server: "1.1.1.1".into(),
        api_port: engine::free_port(),
        api_secret: engine::api_secret(),
        split_mode: "all".into(),
        tunnel_apps: Vec::new(),
        gateway: engine::default_gateway(),
    };
    let cfg = engine::build_config(&profile, &[], &opts);
    let bin = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/bin/sing-box.exe");
    let log = dir.join("logs").join("engine.log");
    let eng = engine::Engine::default();
    *eng.api.lock().unwrap() = Some((opts.api_port, opts.api_secret.clone()));

    let mut out = String::new();
    let before = ip_via(&real_curl, true);
    out += &format!("до туннеля, обычный curl: {before}\n");

    match engine::start(&eng, &bin, &cfg, &log, &profile.name) {
        Ok(s) => out += &format!("туннель: {:?}\n", s.state),
        Err(e) => {
            out += &format!("ошибка старта: {e}\n");
            print!("{out}");
            return;
        }
    }
    std::thread::sleep(std::time::Duration::from_secs(3));

    let tunnelled = ip_via(&copy.to_string_lossy(), true);
    let direct = ip_via(&real_curl, true);
    out += &format!("в списке (curltest.exe): {tunnelled}\n");
    out += &format!("не в списке (curl.exe):   {direct}\n");

    engine::stop(&eng);
    std::thread::sleep(std::time::Duration::from_millis(800));
    let after = ip_via(&real_curl, true);
    out += &format!("после остановки, обычный curl: {after}\n");
    out += &format!(
        "вердикт: {}\n",
        if tunnelled != direct && tunnelled != before && direct == before {
            "OK — в списке идёт через VPN, остальное напрямую"
        } else {
            "ПРОВЕРИТЬ — адреса не совпали с ожиданием"
        }
    );

    print!("{out}");
    let _ = std::fs::File::create(probe_dir.join("result.txt"))
        .and_then(|mut f| f.write_all(out.as_bytes()));
}
