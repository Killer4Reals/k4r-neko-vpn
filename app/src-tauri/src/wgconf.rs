//! Разбор обычного WireGuard-конфига (`*.conf`), в том числе от WARP.
//!
//! Зачем: WARP и любые WireGuard-серверы — это готовый резервный канал.
//! Пользователь вставляет текст конфига, мы превращаем его в профиль, а
//! sing-box поднимает обычный WireGuard-аутбаунд.

use crate::subscription::Profile;

/// Строки секции: ключ и значение, как в SimpleINI.
type Entries = Vec<(String, String)>;

/// SimpleINI: секции `[Interface]` и `[Peer]`, ключи через `=`.
fn parse_ini(text: &str) -> (Entries, Entries) {
    let mut iface = Vec::new();
    let mut peer = Vec::new();
    let mut section = "";
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            section = if line[1..line.len() - 1].eq_ignore_ascii_case("interface") {
                "interface"
            } else if line[1..line.len() - 1].eq_ignore_ascii_case("peer") {
                "peer"
            } else {
                ""
            };
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let item = (key.trim().to_lowercase(), value.trim().to_string());
        match section {
            "interface" => iface.push(item),
            "peer" => peer.push(item),
            _ => {}
        }
    }
    (iface, peer)
}

fn get(list: &[(String, String)], key: &str) -> String {
    list.iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.clone())
        .unwrap_or_default()
}

/// Разделить `host:port`, корректно обработав IPv6 в квадратных скобках.
fn split_endpoint(value: &str) -> (String, u16) {
    let value = value.trim();
    if let Some(rest) = value.strip_prefix('[') {
        if let Some((host, tail)) = rest.split_once(']') {
            let port = tail.trim_start_matches(':').trim().parse().unwrap_or(51820);
            return (host.to_string(), port);
        }
    }
    match value.rsplit_once(':') {
        Some((host, port)) => (host.to_string(), port.trim().parse().unwrap_or(51820)),
        None => (value.to_string(), 51820),
    }
}

fn addresses(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// `reserved` в конфиге WARP иногда приходит как base64 из трёх байт.
fn reserved_from_base64(value: &str) -> Vec<u8> {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::new();
    let mut buffer: u32 = 0;
    let mut bits = 0;
    for ch in value.bytes() {
        if ch == b'=' {
            break;
        }
        let Some(index) = ALPHABET.iter().position(|c| *c == ch) else {
            continue;
        };
        buffer = (buffer << 6) | index as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buffer >> bits) & 0xFF) as u8);
        }
    }
    out.truncate(3);
    out
}

/// Разобрать конфиг. Ошибка — человеческим языком, без «parse error at 3:17».
pub fn parse(text: &str, id: &str) -> Result<Profile, String> {
    let (iface, peer) = parse_ini(text);
    if iface.is_empty() {
        return Err("это не похоже на WireGuard-конфиг: нет секции [Interface]".into());
    }
    if peer.is_empty() {
        return Err("в конфиге нет секции [Peer] — некуда подключаться".into());
    }
    let private_key = get(&iface, "privatekey");
    if private_key.is_empty() {
        return Err("в [Interface] нет PrivateKey".into());
    }
    let peer_public = get(&peer, "publickey");
    if peer_public.is_empty() {
        return Err("в [Peer] нет PublicKey".into());
    }
    let endpoint = get(&peer, "endpoint");
    if endpoint.is_empty() {
        return Err("в [Peer] нет Endpoint (адрес сервера)".into());
    }
    let (host, port) = split_endpoint(&endpoint);
    let addrs = addresses(&get(&iface, "address"));
    let mtu: u16 = get(&iface, "mtu").parse().unwrap_or(1280);
    let reserved = {
        let raw = get(&peer, "reserved");
        if raw.is_empty() {
            Vec::new()
        } else if raw.contains(',') {
            raw.split(',')
                .filter_map(|p| p.trim().parse::<u8>().ok())
                .collect()
        } else {
            reserved_from_base64(&raw)
        }
    };
    // WARP-адреса всегда /32 и /128: без них ядро не поднимется.
    let name = if host.contains("cloudflare") || !reserved.is_empty() {
        "WARP".to_string()
    } else {
        format!("WireGuard {host}")
    };
    Ok(Profile {
        id: id.to_string(),
        name,
        host,
        port,
        uuid: String::new(),
        flow: String::new(),
        security: String::new(),
        network: "udp".into(),
        sni: String::new(),
        public_key: String::new(),
        short_id: String::new(),
        fingerprint: String::new(),
        service_name: String::new(),
        path: String::new(),
        kind: "wireguard".into(),
        password: String::new(),
        method: String::new(),
        alter_id: 0,
        wg_private_key: private_key,
        wg_peer_public_key: peer_public,
        wg_preshared_key: get(&peer, "presharedkey"),
        wg_addresses: addrs,
        wg_mtu: mtu,
        wg_reserved: reserved,
        reserve: false,
        cc: String::new(),
        from_sub: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const WARP: &str = "\
[Interface]
PrivateKey = aGVsbG8tcHJpdmF0ZS1rZXktZm9yLXRlc3RzLTAwMDA=
Address = 172.16.0.2/32, 2606:4700:110:8a1a:1c2d:3e4f:5a6b:7c8d/128
DNS = 1.1.1.1
MTU = 1280

[Peer]
PublicKey = Ym1vUHVibGljS2V5Rm9yVGVzdHNPbmx5MDAwMDAwMDA=
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = engage.cloudflareclient.com:2408
";

    #[test]
    fn parses_warp_style_config() {
        let p = parse(WARP, "w1").unwrap();
        assert_eq!(p.kind, "wireguard");
        assert_eq!(p.host, "engage.cloudflareclient.com");
        assert_eq!(p.port, 2408);
        assert_eq!(p.wg_mtu, 1280);
        assert_eq!(p.wg_addresses.len(), 2);
        assert_eq!(p.name, "WARP");
        assert!(p.wg_private_key.starts_with("aGVsbG8"));
    }

    #[test]
    fn handles_ipv6_endpoint_and_port() {
        let text = "[Interface]\nPrivateKey=k\nAddress=10.0.0.2/32\n[Peer]\nPublicKey=p\nEndpoint=[2606:4700::1]:2408\n";
        let p = parse(text, "w2").unwrap();
        assert_eq!(p.host, "2606:4700::1");
        assert_eq!(p.port, 2408);
    }

    #[test]
    fn plain_wireguard_keeps_host_name() {
        let text = "[Interface]\nPrivateKey=k\nAddress=10.0.0.2/32\n[Peer]\nPublicKey=p\nEndpoint=vpn.example.com:51820\n";
        let p = parse(text, "w3").unwrap();
        assert_eq!(p.name, "WireGuard vpn.example.com");
        assert_eq!(p.wg_mtu, 1280);
    }

    #[test]
    fn complains_about_missing_parts() {
        assert!(parse("мусор", "x").unwrap_err().contains("Interface"));
        assert!(parse("[Interface]\nPrivateKey=k\n", "x")
            .unwrap_err()
            .contains("Peer"));
        assert!(parse(
            "[Interface]\nAddress=1.2.3.4/32\n[Peer]\nPublicKey=p\nEndpoint=h:1\n",
            "x"
        )
        .unwrap_err()
        .contains("PrivateKey"));
    }

    #[test]
    fn reserved_parses_both_ways() {
        assert_eq!(reserved_from_base64("AQID"), vec![1, 2, 3]);
        let text = "[Interface]\nPrivateKey=k\nAddress=10.0.0.2/32\n[Peer]\nPublicKey=p\nEndpoint=h:2408\nReserved=1,2,3\n";
        assert_eq!(parse(text, "x").unwrap().wg_reserved, vec![1, 2, 3]);
    }
}
