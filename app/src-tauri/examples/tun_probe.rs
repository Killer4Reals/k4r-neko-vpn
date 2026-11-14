//! Real TUN test: builds the exact config the app ships (TUN + auto_route),
//! keeps the owner's browser on the direct path, checks the exit IP and always
//! tears the tunnel down. Must run elevated.
//!
//! cargo run --example tun_probe -- <sub-url> <hwid> <name-filter> <out-file> [extra-exe,...]

use k4r_neko_vpn_lib::engine;
use k4r_neko_vpn_lib::subscription::{self, SubHeader};
use std::io::Write;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

struct KillOnDrop(Option<Child>);
impl Drop for KillOnDrop {
    fn drop(&mut self) {
        if let Some(mut c) = self.0.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

fn curl(args: &[&str]) -> String {
    let out = Command::new("curl")
        .args(args)
        .args(["-sS", "--ssl-no-revoke", "-m", "20", "https://1.1.1.1/cdn-cgi/trace"])
        .output();
    match out {
        Ok(o) => String::from_utf8_lossy(&o.stdout).to_string(),
        Err(e) => format!("curl error: {e}"),
    }
}

fn field(body: &str, key: &str) -> String {
    body.lines()
        .find(|l| l.starts_with(&format!("{key}=")))
        .map(|l| l.trim_start_matches(&format!("{key}=")).to_string())
        .unwrap_or_else(|| "?".into())
}

fn main() {
    let mut a = std::env::args().skip(1);
    let url = a.next().expect("sub url");
    let hwid = a.next().expect("hwid");
    let filter = a.next().unwrap_or_default();
    let out_file = a.next().unwrap_or_else(|| "tun-probe.txt".into());
    let extra = a.next().unwrap_or_else(|| "browser.exe".into());

    let mut log = String::new();
    macro_rules! say {
        ($($t:tt)*) => {{
            let line = format!($($t)*);
            println!("{line}");
            log.push_str(&line);
            log.push('\n');
        }};
    }

    say!("elevated: {}", engine::is_elevated());
    let before = curl(&[]);
    say!("direct: ip={} colo={}", field(&before, "ip"), field(&before, "colo"));

    let res = match subscription::fetch(
        &url,
        "K4R-Neko-VPN/0.1",
        &[SubHeader { name: "X-HWID".into(), value: hwid }],
    ) {
        Ok(r) => r,
        Err(e) => {
            say!("subscription failed: {e}");
            std::fs::write(&out_file, log).ok();
            return;
        }
    };
    say!("profiles: {}", res.profiles.len());

    let profile = res
        .profiles
        .iter()
        .find(|p| p.name.contains(&filter))
        .unwrap_or(&res.profiles[1])
        .clone();
    say!("server: {} ({}:{})", profile.name, profile.host, profile.port);

    let excluded: Vec<String> = extra.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    let config = engine::build_config(&profile, &excluded, &engine::NetOptions::default());
    let cfg_path = std::env::temp_dir().join("k4r-tun-probe.json");
    std::fs::write(&cfg_path, serde_json::to_vec_pretty(&config).unwrap()).unwrap();

    let bin = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("bin")
        .join("sing-box.exe");
    if let Err(e) = engine::check_config(&bin, &cfg_path) {
        say!("config rejected: {e}");
        std::fs::write(&out_file, log).ok();
        return;
    }
    say!("config accepted by engine");

    let child = Command::new(&bin)
        .arg("run")
        .arg("-c")
        .arg(&cfg_path)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn();
    let guard = KillOnDrop(match child {
        Ok(c) => Some(c),
        Err(e) => {
            say!("spawn failed: {e}");
            std::fs::write(&out_file, log).ok();
            return;
        }
    });
    say!("tunnel pid: {:?}", guard.0.as_ref().map(|c| c.id()));

    std::thread::sleep(Duration::from_secs(6));

    let during = curl(&[]);
    let ip_after = field(&during, "ip");
    let colo_after = field(&during, "colo");
    say!("through tun: ip={ip_after} colo={colo_after}");
    say!("ip changed: {}", field(&before, "ip") != ip_after);

    // browser must stay outside the tunnel: same process name is excluded
    say!("excluded processes: {:?}", excluded);

    drop(guard);
    std::thread::sleep(Duration::from_secs(2));
    let after = curl(&[]);
    say!("after teardown: ip={} colo={}", field(&after, "ip"), field(&after, "colo"));
    say!("restored: {}", field(&after, "ip") == field(&before, "ip"));

    std::fs::write(&out_file, log).ok();
}
