// Проверка «придержать интернет»: поднимаем hold-конфиг на 4 секунды и смотрим,
// что наружу ничего не уходит, а локальная сеть жива. Проба сама всё выключает.
use std::io::Write;
use std::net::{TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

fn reachable(host: &str, port: u16) -> bool {
    let Ok(mut addrs) = (host, port).to_socket_addrs() else {
        return false;
    };
    let Some(addr) = addrs.next() else { return false };
    TcpStream::connect_timeout(&addr, Duration::from_millis(2500)).is_ok()
}

fn main() {
    let dir = std::env::temp_dir().join("k4r-hold-probe");
    let _ = std::fs::create_dir_all(&dir);
    let log = dir.join("hold.log");
    let bin = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources/bin/sing-box.exe");

    let engine = k4r_neko_vpn_lib::engine::Engine::default();
    let started = k4r_neko_vpn_lib::engine::start_hold(&engine, &bin, &log);

    let mut out = String::new();
    out += &format!("hold started: {started}\n");

    // ждём, пока адаптер реально появится
    let mut tun_up = false;
    let began = Instant::now();
    while began.elapsed() < Duration::from_secs(8) {
        if let Ok(text) = std::fs::read_to_string(&log) {
            let clean = k4r_neko_vpn_lib::store::strip_ansi(&text);
            if clean.contains("started at tun") {
                tun_up = true;
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    out += &format!("tun adapter up: {tun_up}\n");
    std::thread::sleep(Duration::from_millis(1200));

    let public = reachable("1.1.1.1", 443);
    let lan = reachable("192.168.1.1", 80);
    out += &format!("outside reachable (должно быть false): {public}\n");
    out += &format!("local network reachable (должно быть true): {lan}\n");

    k4r_neko_vpn_lib::engine::stop_hold(&engine);
    std::thread::sleep(Duration::from_millis(800));
    let after = reachable("1.1.1.1", 443);
    out += &format!("after stop, outside reachable (должно быть true): {after}\n");

    print!("{out}");
    let _ = std::fs::File::create(dir.join("result.txt"))
        .and_then(|mut f| f.write_all(out.as_bytes()));
}
