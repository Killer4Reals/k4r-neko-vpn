// Проверяет, что новый контроль «туннель реально поднялся» не мешает подключению.
// Свои процессы исключены, чтобы не оборвать связь этой машины.
use k4r_neko_vpn_lib::{engine, store};

fn main() {
    let dir = std::env::var("APPDATA").map(std::path::PathBuf::from).unwrap().join("ink.k4r.nekoneko.vpn");
    let st = store::load(&dir);
    let Some(profile) = st
        .profiles
        .iter()
        .find(|p| format!("{}:{}:{}", p.host, p.port, p.uuid) == st.selected)
        .or_else(|| st.profiles.first())
        .cloned()
    else {
        println!("нет профилей в состоянии");
        return;
    };
    let opts = engine::NetOptions {
        dns_mode: "tunnel".into(),
        block_ipv6: true,
        dns_server: "1.1.1.1".into(),
        api_port: engine::free_port(),
        api_secret: engine::api_secret(),
        split_mode: "only".into(),
        tunnel_apps: Vec::new(),
    };
    let excluded = vec![
        "deepai code.exe".to_string(),
        "node.exe".to_string(),
        "bun.exe".to_string(),
        "curl.exe".to_string(),
        "powershell.exe".to_string(),
        "pwsh.exe".to_string(),
    ];
    let cfg = engine::build_config(&profile, &excluded, &opts);
    let bin = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/bin/sing-box.exe");
    let log = dir.join("logs").join("engine.log");
    let eng = engine::Engine::default();
    *eng.api.lock().unwrap() = Some((opts.api_port, opts.api_secret.clone()));

    let began = std::time::Instant::now();
    match engine::start(&eng, &bin, &cfg, &log, &profile.name) {
        Ok(status) => {
            println!("start ok: {:?} через {:?}", status.state, began.elapsed());
            std::thread::sleep(std::time::Duration::from_secs(3));
            let t = engine::traffic(&eng);
            println!("счётчики читаются: down {} up {}", t.total_down, t.total_up);
            let st2 = engine::poll(&eng);
            println!("состояние через 3с: {:?} ({})", st2.state, st2.message);
        }
        Err(e) => println!("start failed: {e}"),
    }
    engine::stop(&eng);
    println!("остановлено");
}
