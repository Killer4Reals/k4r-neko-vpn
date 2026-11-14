use serde::Serialize;
use std::net::{TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

use crate::subscription::Profile;

#[derive(Debug, Clone, Serialize)]
pub struct PingResult {
    pub id: String,
    pub ms: Option<u32>,
}

/// TCP handshake time to the server. Cheap, no login, no traffic, no side effects.
pub fn ping(host: &str, port: u16, attempts: u8) -> Option<u32> {
    let addr = (host, port).to_socket_addrs().ok()?.next()?;
    let mut best: Option<u32> = None;
    for _ in 0..attempts.max(1) {
        let start = Instant::now();
        match TcpStream::connect_timeout(&addr, Duration::from_millis(1500)) {
            Ok(_) => {
                let ms = start.elapsed().as_millis() as u32;
                best = Some(best.map_or(ms, |b: u32| b.min(ms)));
            }
            Err(_) => continue,
        }
    }
    best
}

pub fn ping_all(profiles: &[Profile]) -> Vec<PingResult> {
    profiles
        .iter()
        .map(|p| PingResult {
            id: p.id.clone(),
            ms: ping(&p.host, p.port, 2),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measures_latency_to_a_local_listener() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for _ in 0..4 {
                let _ = listener.accept();
            }
        });
        let ms = ping("127.0.0.1", port, 2).expect("localhost must answer");
        assert!(ms < 1000, "unexpected latency: {ms}");
    }

    #[test]
    fn closed_port_returns_none() {
        assert!(ping("127.0.0.1", 9, 1).is_none());
    }
}
