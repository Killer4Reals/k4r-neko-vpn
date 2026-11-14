//! Live end-to-end probe: fetch a real subscription, build a sing-box config with
//! the same code the app uses, run it against a SOCKS inbound (no TUN, no admin)
//! and check that the traffic really leaves through the provider.
//!
//! Usage: cargo run --example live_probe -- <sub-url> <hwid> [host-filter]

use k4r_neko_vpn_lib::engine;
use k4r_neko_vpn_lib::subscription::{self, SubHeader};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::process::{Command, Stdio};
use std::time::Duration;

fn main() {
    let mut args = std::env::args().skip(1);
    let url = args.next().expect("sub url");
    let hwid = args.next().expect("hwid");
    let filter = args.next().unwrap_or_default();

    let res = subscription::fetch(
        &url,
        "K4R-Neko-VPN/0.1",
        &[SubHeader {
            name: "X-HWID".into(),
            value: hwid,
        }],
    )
    .expect("subscription fetch");

    println!("format={} profiles={}", res.format, res.profiles.len());
    for p in &res.profiles {
        println!(
            "  {} | {}:{} | {} {} | grpc={}",
            p.name, p.host, p.port, p.network, p.security, p.service_name
        );
    }

    let profile = res
        .profiles
        .iter()
        .find(|p| p.name.contains(&filter))
        .unwrap_or(&res.profiles[1])
        .clone();

    let mut config = engine::build_config(&profile, &[], &engine::NetOptions::default());
    config["inbounds"] = serde_json::json!([{
        "type": "socks",
        "tag": "socks-in",
        "listen": "127.0.0.1",
        "listen_port": 1081
    }]);

    let cfg_path = std::env::temp_dir().join("k4r-live-probe.json");
    std::fs::write(&cfg_path, serde_json::to_vec_pretty(&config).unwrap()).unwrap();

    let bin = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("bin")
        .join("sing-box.exe");
    engine::check_config(&bin, &cfg_path).expect("engine rejects config");

    let mut child = Command::new(&bin)
        .arg("run")
        .arg("-c")
        .arg(&cfg_path)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn engine");
    std::thread::sleep(Duration::from_millis(1500));

    let result = curl_through_socks();

    let _ = child.kill();
    let _ = child.wait();

    match result {
        Ok(body) => {
            let payload = body.split("\r\n\r\n").nth(1).unwrap_or(&body).trim().to_string();
            let masked = match payload.split('.').next() {
                Some(first) if first.chars().all(|c| c.is_ascii_digit()) => {
                    let parts: Vec<&str> = payload.split('.').collect();
                    format!("{}.{}.x.x", parts[0], parts[1])
                }
                _ => format!("unexpected answer: {}", payload.chars().take(120).collect::<String>()),
            };
            println!("\nTHROUGH TUNNEL: ip={masked}");
        }
        Err(e) => {
            eprintln!("\nFAILED: {e}");
            std::process::exit(1);
        }
    }
    let _ = std::fs::remove_file(&cfg_path);
}

fn curl_through_socks() -> Result<String, String> {
    let out = Command::new("curl")
        .args([
            "-sS",
            "--ssl-no-revoke",
            "-m",
            "25",
            "--socks5-hostname",
            "127.0.0.1:1081",
            "https://1.1.1.1/cdn-cgi/trace",
        ])
        .output()
        .map_err(|e| format!("curl: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    if text.is_empty() {
        return Err(format!("curl failed: {}", String::from_utf8_lossy(&out.stderr)));
    }
    Ok(text)
}

#[allow(dead_code)]
fn http_over_socks_domain(host: &str, port: u16, domain: &str, dport: u16, path: &str) -> Result<String, String> {
    let mut s = TcpStream::connect((host, port)).map_err(|e| format!("socks connect: {e}"))?;
    s.set_read_timeout(Some(Duration::from_secs(20))).ok();

    s.write_all(&[5, 1, 0]).map_err(|e| e.to_string())?;
    let mut buf = [0u8; 2];
    s.read_exact(&mut buf).map_err(|e| e.to_string())?;
    if buf[0] != 5 || buf[1] != 0 {
        return Err("socks: no acceptable auth".into());
    }

    let mut req = vec![5, 1, 0, 3, domain.len() as u8];
    req.extend_from_slice(domain.as_bytes());
    req.extend_from_slice(&dport.to_be_bytes());
    s.write_all(&req).map_err(|e| e.to_string())?;

    let mut head = [0u8; 4];
    s.read_exact(&mut head).map_err(|e| format!("socks reply: {e}"))?;
    if head[1] != 0 {
        return Err(format!("socks: code {}", head[1]));
    }
    match head[3] {
        1 => {
            let mut skip = [0u8; 6];
            s.read_exact(&mut skip).ok();
        }
        3 => {
            let mut len = [0u8; 1];
            s.read_exact(&mut len).ok();
            let mut skip = vec![0u8; len[0] as usize + 2];
            s.read_exact(&mut skip).ok();
        }
        4 => {
            let mut skip = [0u8; 18];
            s.read_exact(&mut skip).ok();
        }
        _ => return Err("socks: bad address type".into()),
    }

    let get = format!("GET {path} HTTP/1.1\r\nHost: 1.1.1.1\r\nConnection: close\r\n\r\n");
    s.write_all(get.as_bytes()).map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    s.read_to_end(&mut out).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out).to_string();
    Ok(text)
}
