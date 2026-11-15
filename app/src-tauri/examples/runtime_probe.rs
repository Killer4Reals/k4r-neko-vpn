//! Live check of the settings that only matter with a tunnel up:
//! DNS mode, IPv6 blocking and teardown. Reads the real app state, builds the
//! same config the GUI builds, and always kills the engine afterwards.
//!
//! cargo run --example runtime_probe -- <out-file>

use k4r_neko_vpn_lib::engine;
use k4r_neko_vpn_lib::store;
use std::path::PathBuf;
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

fn sh(cmd: &str, args: &[&str]) -> String {
    match Command::new(cmd).args(args).output() {
        Ok(o) => {
            let mut s = String::from_utf8_lossy(&o.stdout).to_string();
            s.push_str(&String::from_utf8_lossy(&o.stderr));
            s.trim().to_string()
        }
        Err(e) => format!("error: {e}"),
    }
}

fn ipinfo() -> String {
    let body = sh(
        "curl",
        &["-sS", "--ssl-no-revoke", "-m", "15", "https://1.1.1.1/cdn-cgi/trace"],
    );
    let get = |k: &str| {
        body.lines()
            .find(|l| l.starts_with(&format!("{k}=")))
            .map(|l| l[k.len() + 1..].to_string())
            .unwrap_or_else(|| "?".into())
    };
    format!("ip={} loc={}", get("ip"), get("loc"))
}

fn main() {
    let out_file = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "runtime-probe.txt".into());
    // programs the owner routes direct, comma separated — proves process rules work
    let extra_excluded: Vec<String> = std::env::var("K4R_EXCLUDED")
        .unwrap_or_default()
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let mut log = String::new();
    macro_rules! say {
        ($($t:tt)*) => {{
            let line = format!($($t)*);
            println!("{line}");
            log.push_str(&line);
            log.push('\n');
        }};
    }

    let dir = PathBuf::from(std::env::var("APPDATA").unwrap()).join("ink.k4r.nekoneko.vpn");
    let st = store::load(&dir);
    say!("elevated: {}", engine::is_elevated());
    say!(
        "settings: dns_mode={} block_ipv6={} profiles={}",
        st.dns_mode,
        st.block_ipv6,
        st.profiles.len()
    );
    if st.profiles.is_empty() {
        say!("no servers in state: run seed_state first");
        std::fs::write(&out_file, log).ok();
        return;
    }

    let profile = st
        .profiles
        .iter()
        .find(|p| p.id == st.selected)
        .or_else(|| st.profiles.first())
        .unwrap()
        .clone();
    say!("server: {} ({}:{})", profile.name, profile.host, profile.port);

    say!("before: {}", ipinfo());

    // what a leaky machine answers without the tunnel
    let v6 = ["-6", "-sS", "-m", "8", "https://[2606:4700:4700::1111]/cdn-cgi/trace"];
    say!("ipv6 before: {}", sh("curl", &v6));

    let opts = engine::NetOptions {
        dns_mode: st.dns_mode.clone(),
        block_ipv6: st.block_ipv6,
        dns_server: "1.1.1.1".into(),
        api_port: 0,
        api_secret: String::new(),
        split_mode: "only".into(),
        tunnel_apps: Vec::new(),
        gateway: engine::default_gateway(),
    };
    let mut excluded = st
        .split
        .iter()
        .filter(|s| !s.via)
        .map(|s| s.exe.clone())
        .collect::<Vec<_>>();
    excluded.extend(extra_excluded.iter().cloned());
    let config = engine::build_config(&profile, &excluded, &opts);
    let cfg_path = std::env::temp_dir().join("k4r-runtime-probe.json");
    std::fs::write(&cfg_path, serde_json::to_vec_pretty(&config).unwrap()).unwrap();
    let bin = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("bin")
        .join("sing-box.exe");
    if let Err(e) = engine::check_config(&bin, &cfg_path) {
        say!("config rejected: {e}");
        std::fs::write(&out_file, log).ok();
        return;
    }
    say!("config accepted");

    let guard = KillOnDrop(match Command::new(&bin)
        .arg("run")
        .arg("-c")
        .arg(&cfg_path)
        .stdout(Stdio::null())
        .stderr(Stdio::from(
            std::fs::File::create(std::env::temp_dir().join("k4r-runtime-probe.log")).unwrap(),
        ))
        .spawn()
    {
        Ok(c) => Some(c),
        Err(e) => {
            say!("spawn failed: {e}");
            std::fs::write(&out_file, log).ok();
            return;
        }
    });
    say!("tunnel pid: {:?}", guard.0.as_ref().map(|c| c.id()));
    std::thread::sleep(Duration::from_secs(10));

    say!("excluded processes: {:?}", excluded);
    say!("through tunnel: {}", ipinfo());
    if !excluded.is_empty() {
        // Same curl, different file name: only the excluded name keeps the direct
        // route, so the difference proves the process rule really matched.
        let alt_dir = std::env::temp_dir().join("k4r-split-probe");
        std::fs::create_dir_all(&alt_dir).ok();
        let alt = alt_dir.join("curltest.exe");
        let _ = std::fs::copy(r"C:\Windows\System32\curl.exe", &alt);
        let alt_trace = sh(
            alt.to_str().unwrap_or("curltest.exe"),
            &["-sS", "--ssl-no-revoke", "-m", "20", "https://ifconfig.co/ip"],
        );
        let alt_ip = alt_trace.trim().to_string();
        say!("same tool, not excluded (curltest.exe): ip={alt_ip}");
    }
    say!("ipv6 through tunnel: {}", sh("curl", &v6));

    // who answers our DNS queries? a public-resolver answer means the query left the tunnel
    let dns = sh("nslookup", &["whoami.akamai.net"]);
    say!("dns check:\n{dns}");

    drop(guard);
    std::thread::sleep(Duration::from_secs(3));
    say!("after teardown: {}", ipinfo());
    say!("ipv6 after teardown: {}", sh("curl", &v6));

    std::fs::write(&out_file, log).ok();
}
