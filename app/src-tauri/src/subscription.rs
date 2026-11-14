use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::io::Read;

/// One usable server. Everything the engine needs to build a tunnel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub uuid: String,
    #[serde(default)]
    pub flow: String,
    pub security: String,
    pub network: String,
    #[serde(default)]
    pub sni: String,
    #[serde(default)]
    pub public_key: String,
    #[serde(default)]
    pub short_id: String,
    #[serde(default)]
    pub fingerprint: String,
    /// gRPC service name (VLESS + gRPC) — required by most modern providers.
    #[serde(default)]
    pub service_name: String,
    /// WebSocket path.
    #[serde(default)]
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct SubResult {
    pub profiles: Vec<Profile>,
    /// Non-fatal notes shown to the user (e.g. provider returned placeholders).
    pub warnings: Vec<String>,
    pub format: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SubHeader {
    pub name: String,
    pub value: String,
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(25)))
        .build()
        .into()
}

pub fn fetch(
    url: &str,
    user_agent: &str,
    headers: &[SubHeader],
) -> Result<SubResult, String> {
    let agent = agent();
    let mut req = agent.get(url);
    if !user_agent.is_empty() {
        req = req.header("User-Agent", user_agent);
    }
    for h in headers {
        if !h.name.trim().is_empty() && !h.value.trim().is_empty() {
            req = req.header(h.name.trim(), h.value.trim());
        }
    }

    let mut resp = req.call().map_err(|e| match e {
        ureq::Error::StatusCode(code) => format!("сервер ответил {code}"),
        other => format!("сеть недоступна: {other}"),
    })?;

    let mut body = String::new();
    resp.body_mut()
        .as_reader()
        .take(8 * 1024 * 1024)
        .read_to_string(&mut body)
        .map_err(|e| format!("не удалось прочитать ответ: {e}"))?;

    parse(&body)
}

/// Import from pasted text: one or many `vless://` links, plain or base64-wrapped.
/// This is the path that makes the app work without any subscription at all.
pub fn import_text(text: &str) -> Result<Vec<Profile>, String> {
    let raw = text.trim();
    if raw.is_empty() {
        return Err("пусто: вставь ссылку vless://…".into());
    }

    let decoded = base64::engine::general_purpose::STANDARD
        .decode(raw)
        .or_else(|_| base64::engine::general_purpose::STANDARD_NO_PAD.decode(raw))
        .ok()
        .and_then(|b| String::from_utf8(b).ok())
        .unwrap_or_else(|| raw.to_string());

    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    let mut errors = Vec::new();

    for token in decoded.split_whitespace() {
        if !token.starts_with("vless://") {
            continue;
        }
        match parse_link(token) {
            Ok(p) => {
                if seen.insert(p.id.clone()) {
                    out.push(p);
                }
            }
            Err(e) => errors.push(e),
        }
    }

    if out.is_empty() {
        let detail = errors.first().cloned().unwrap_or_else(|| "ссылок vless:// не найдено".into());
        return Err(format!("не удалось импортировать: {detail}"));
    }
    Ok(out)
}

pub fn parse(body: &str) -> Result<SubResult, String> {
    let text = body.trim();

    if text.starts_with('{') || text.starts_with('[') {
        return parse_json(text);
    }
    if text.contains("proxies:") {
        return Err("провайдер отдал Clash YAML — этот формат пока не поддержан".into());
    }

    // base64 body with a list of vless:// links
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(text)
        .or_else(|_| base64::engine::general_purpose::STANDARD_NO_PAD.decode(text))
        .ok()
        .and_then(|b| String::from_utf8(b).ok())
        .unwrap_or_else(|| text.to_string());

    let mut profiles = Vec::new();
    for line in decoded.lines() {
        let line = line.trim();
        if line.starts_with("vless://") {
            if let Ok(p) = parse_link(line) {
                profiles.push(p);
            }
        }
    }

    if profiles.is_empty() {
        return Err("в ответе нет серверов: проверь ссылку подписки и заголовки клиента".into());
    }

    let mut warnings = Vec::new();
    if profiles.iter().all(is_placeholder) {
        warnings.push(
            "Провайдер вернул заглушку вместо серверов: нужен заголовок клиента, которому он доверяет"
                .to_string(),
        );
    }

    Ok(SubResult {
        profiles,
        warnings,
        format: "links".into(),
    })
}

fn is_placeholder(p: &Profile) -> bool {
    p.host.starts_with("0.0.0.0") || p.uuid.starts_with("00000000-0000")
}

fn parse_json(text: &str) -> Result<SubResult, String> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("некорректный JSON: {e}"))?;

    let configs: Vec<&serde_json::Value> = match &value {
        serde_json::Value::Array(items) => items.iter().collect(),
        obj @ serde_json::Value::Object(_) => vec![obj],
        _ => return Err("неизвестный формат подписки".into()),
    };

    let mut profiles = Vec::new();
    for cfg in configs {
        let remarks = cfg
            .get("remarks")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let Some(outbounds) = cfg.get("outbounds").and_then(|v| v.as_array()) else {
            continue;
        };
        for ob in outbounds {
            if ob.get("protocol").and_then(|v| v.as_str()) != Some("vless") {
                continue;
            }
            if let Some(p) = profile_from_xray(ob, &remarks) {
                profiles.push(p);
            }
        }
    }

    if profiles.is_empty() {
        return Err("в конфиге подписки не нашлось VLESS-серверов".into());
    }

    let mut warnings = Vec::new();
    if profiles.iter().all(is_placeholder) {
        warnings.push(
            "Провайдер вернул заглушку вместо серверов: нужен заголовок клиента, которому он доверяет"
                .to_string(),
        );
    }

    Ok(SubResult {
        profiles,
        warnings,
        format: "xray-json".into(),
    })
}

fn profile_from_xray(ob: &serde_json::Value, remarks: &str) -> Option<Profile> {
    let vnext = ob.get("settings")?.get("vnext")?.as_array()?.first()?;
    let host = vnext.get("address")?.as_str()?.to_string();
    let port = vnext.get("port")?.as_u64()? as u16;
    let user = vnext.get("users")?.as_array()?.first()?;
    let uuid = user.get("id")?.as_str()?.to_string();
    let flow = user
        .get("flow")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let stream = ob.get("streamSettings");
    let network = stream
        .and_then(|s| s.get("network"))
        .and_then(|v| v.as_str())
        .unwrap_or("tcp")
        .to_string();
    let security = stream
        .and_then(|s| s.get("security"))
        .and_then(|v| v.as_str())
        .unwrap_or("none")
        .to_string();

    let tls = stream.and_then(|s| s.get("tlsSettings"));
    let reality = stream.and_then(|s| s.get("realitySettings"));

    let sni = reality
        .and_then(|r| r.get("serverName"))
        .or_else(|| tls.and_then(|t| t.get("serverName")))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let public_key = reality
        .and_then(|r| r.get("publicKey"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let short_id = reality
        .and_then(|r| r.get("shortId"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let fingerprint = reality
        .and_then(|r| r.get("fingerprint"))
        .or_else(|| tls.and_then(|t| t.get("fingerprint")))
        .and_then(|v| v.as_str())
        .unwrap_or("chrome")
        .to_string();

    let service_name = stream
        .and_then(|s| s.get("grpcSettings"))
        .and_then(|g| g.get("serviceName"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let path = stream
        .and_then(|s| s.get("wsSettings"))
        .and_then(|w| w.get("path"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let name = if remarks.is_empty() {
        host.clone()
    } else {
        remarks.to_string()
    };

    Some(Profile {
        id: format!("{host}:{port}:{uuid}"),
        name,
        host,
        port,
        uuid,
        flow,
        security,
        network,
        sni,
        public_key,
        short_id,
        fingerprint,
        service_name,
        path,
    })
}

pub fn parse_link(link: &str) -> Result<Profile, String> {
    let url = url::Url::parse(link).map_err(|e| format!("битая ссылка: {e}"))?;
    if url.scheme() != "vless" {
        return Err("поддерживаются только vless-ссылки".into());
    }
    let uuid = url.username().to_string();
    let host = url
        .host_str()
        .ok_or_else(|| "в ссылке нет адреса сервера".to_string())?
        .to_string();
    let port = url.port().unwrap_or(443);

    let q: std::collections::HashMap<String, String> = url.query_pairs().into_owned().collect();
    let get = |k: &str| q.get(k).cloned().unwrap_or_default();

    let security = if get("security").is_empty() {
        "none".to_string()
    } else {
        get("security")
    };
    let network = if get("type").is_empty() {
        "tcp".to_string()
    } else {
        get("type")
    };

    let fragment = percent_encoding::percent_decode_str(url.fragment().unwrap_or(""))
        .decode_utf8_lossy()
        .to_string();
    let name = if fragment.trim().is_empty() {
        format!("{host}:{port}")
    } else {
        fragment
    };

    Ok(Profile {
        id: format!("{host}:{port}:{uuid}"),
        name,
        host,
        port,
        uuid,
        flow: get("flow"),
        security,
        network,
        sni: get("sni"),
        public_key: get("pbk"),
        short_id: get("sid"),
        fingerprint: if get("fp").is_empty() {
            "chrome".to_string()
        } else {
            get("fp")
        },
        service_name: get("serviceName"),
        path: get("path"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_vless_link() {
        let p = parse_link(
            "vless://11111111-2222-3333-4444-555555555555@example.com:443?type=tcp&security=tls&sni=example.com#Berlin",
        )
        .unwrap();
        assert_eq!(p.host, "example.com");
        assert_eq!(p.port, 443);
        assert_eq!(p.security, "tls");
        assert_eq!(p.sni, "example.com");
        assert_eq!(p.name, "Berlin");
    }

    #[test]
    fn parses_reality_link() {
        let p = parse_link("vless://u@1.2.3.4:8443?security=reality&pbk=KEY&sid=ab&fp=chrome&flow=xtls-rprx-vision&type=tcp#R").unwrap();
        assert_eq!(p.public_key, "KEY");
        assert_eq!(p.short_id, "ab");
        assert_eq!(p.flow, "xtls-rprx-vision");
    }

    #[test]
    fn parses_xray_json_stub() {
        let body = r#"[{"remarks":"Test","outbounds":[{"protocol":"vless","settings":{"vnext":[{"address":"5.6.7.8","port":443,"users":[{"id":"abc","flow":""}]}]},"streamSettings":{"network":"tcp","security":"reality","realitySettings":{"serverName":"a.com","publicKey":"k","shortId":"s"}}}]}]"#;
        let r = parse(body).unwrap();
        assert_eq!(r.profiles.len(), 1);
        assert_eq!(r.profiles[0].host, "5.6.7.8");
        assert_eq!(r.profiles[0].public_key, "k");
    }

    #[test]
    fn reads_grpc_service_name_from_xray_json() {
        let body = r#"[{"remarks":"DE","outbounds":[{"protocol":"vless","settings":{"vnext":[{"address":"1.2.3.4","port":10121,"users":[{"id":"u","flow":""}]}]},"streamSettings":{"network":"grpc","grpcSettings":{"serviceName":"api"},"security":"reality","realitySettings":{"serverName":"deepl.com","publicKey":"k","shortId":"s","fingerprint":"firefox"}}}]}]"#;
        let r = parse(body).unwrap();
        assert_eq!(r.profiles[0].service_name, "api");
        assert_eq!(r.profiles[0].network, "grpc");
        assert_eq!(r.profiles[0].fingerprint, "firefox");
    }

    #[test]
    fn imports_several_links_and_skips_duplicates() {
        let text = "vless://u@1.2.3.4:443?security=tls&sni=a.com#One
                    vless://u@1.2.3.4:443?security=tls&sni=a.com#One-again
                    vless://u2@5.6.7.8:8443?security=reality&pbk=k&sid=s#Two";
        let list = import_text(text).unwrap();
        assert_eq!(list.len(), 2, "duplicate must be dropped");
        assert_eq!(list[1].host, "5.6.7.8");
    }

    #[test]
    fn imports_base64_wrapped_links() {
        use base64::Engine as _;
        let plain = "vless://u@9.9.9.9:443?security=none#B64";
        let encoded = base64::engine::general_purpose::STANDARD.encode(plain);
        let list = import_text(&encoded).unwrap();
        assert_eq!(list[0].host, "9.9.9.9");
    }

    #[test]
    fn reports_garbage_instead_of_panicking() {
        assert!(import_text("hello world").is_err());
        assert!(import_text("   ").is_err());
    }

    #[test]
    fn flags_placeholder_subscription() {
        let body = r#"[{"remarks":"Stub","outbounds":[{"protocol":"vless","settings":{"vnext":[{"address":"0.0.0.0","port":1,"users":[{"id":"00000000-0000-0000-0000-000000000000"}]}]},"streamSettings":{"network":"tcp","security":"none"}}]}]"#;
        let r = parse(body).unwrap();
        assert_eq!(r.warnings.len(), 1);
    }
}

#[cfg(test)]
mod net_tests {
    use super::*;

    /// Live check against the owner's subscription. Ignored by default.
    #[test]
    #[ignore]
    fn fetches_real_subscription() {
        let r = fetch("https://example.invalid/subscription", "Happ/4.7.2", &[]).unwrap();
        println!("format={} profiles={} warnings={:?}", r.format, r.profiles.len(), r.warnings);
        assert!(!r.profiles.is_empty());
    }
}
