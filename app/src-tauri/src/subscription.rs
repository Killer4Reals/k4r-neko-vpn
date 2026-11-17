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

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct SubInfo {
    /// Bytes already spent, as reported by the provider.
    pub upload: u64,
    pub download: u64,
    /// Total allowance in bytes, 0 when the provider does not say.
    pub total: u64,
    /// Expiry as unix seconds, 0 when the provider does not say.
    pub expire: u64,
}

#[derive(Debug, Serialize)]
pub struct SubResult {
    pub profiles: Vec<Profile>,
    /// Non-fatal notes shown to the user (e.g. provider returned placeholders).
    pub warnings: Vec<String>,
    pub format: String,
    /// Remaining traffic and expiry from the `subscription-userinfo` header.
    pub info: Option<SubInfo>,
    /// Human name of the subscription, if the provider sends one.
    pub title: String,
    /// How often the provider suggests refreshing, in hours (0 = no opinion).
    pub refresh_hint: u32,
    /// Имя клиента, которым провайдер согласился ответить. Панели часто пускают
    /// только знакомые UA, отвечая остальным 502 — тогда это не наша вина.
    pub ua_used: String,
}

/// Providers announce the allowance in a header: `upload=..; download=..;
/// total=..; expire=..`. Values are bytes and unix seconds; anything missing
/// simply stays zero, because a made-up number is worse than no number.
/// `profile-title` is either plain text or `base64:<encoded utf-8>`.
pub fn parse_title(raw: &str) -> String {
    let raw = raw.trim();
    let decoded = raw
        .strip_prefix("base64:")
        .and_then(|b| base64::engine::general_purpose::STANDARD.decode(b.trim()).ok())
        .or_else(|| base64::engine::general_purpose::STANDARD.decode(raw).ok())
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .unwrap_or_else(|| raw.to_string());
    decoded.trim().to_string()
}

pub fn parse_userinfo(raw: &str) -> SubInfo {
    let mut info = SubInfo::default();
    for part in raw.split(';') {
        let mut it = part.splitn(2, '=');
        let (Some(key), Some(value)) = (it.next(), it.next()) else {
            continue;
        };
        let value = value.trim().trim_end_matches(|c: char| !c.is_ascii_digit());
        let Ok(num) = value.parse::<u64>() else { continue };
        match key.trim().to_ascii_lowercase().as_str() {
            "upload" => info.upload = num,
            "download" => info.download = num,
            "total" => info.total = num,
            "expire" => info.expire = num,
            _ => {}
        }
    }
    info
}

#[derive(Debug, Clone, Deserialize)]
pub struct SubHeader {
    pub name: String,
    pub value: String,
}

/// Какая ошибка полезнее человеку. Провайдер, сказавший «лимит устройств 5/5»,
/// объясняет больше, чем «сервер ответил 502» или «это YAML».
fn more_useful(current: &str, candidate: &str) -> bool {
    fn rank(e: &str) -> u8 {
        // «провайдер: …» — это слова самого провайдера, они всего полезнее.
        // «провайдер отдал Clash YAML» — наша формулировка, она ценнее не всех.
        if e.starts_with("провайдер:") {
            3
        } else if e.starts_with("сервер ответил") || e.starts_with("сеть недоступна") {
            2
        } else if e.is_empty() {
            0
        } else {
            1
        }
    }
    rank(candidate) > rank(current)
}

/// Клиенты, которых панели узнают. Порядок не случайный: `v2rayNG` почти
/// всегда получает обычный список ссылок, который мы умеем читать; остальные —
/// на случай, если панель знает только их.
pub const UA_KNOWN: [&str; 3] = [
    "v2rayNG/1.9.0",
    "Streisand/1.6.0",
    "ClashMetaForAndroid/2.11.1",
];

/// Порядок попыток: сперва то, что стоит у человека в настройках (там может
/// быть его личный UA), потом известные клиенты. Повторы не нужны.
pub fn ua_chain(custom: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let custom = custom.trim();
    if !custom.is_empty() {
        out.push(custom.to_string());
    }
    for d in UA_KNOWN {
        if !out.iter().any(|u| u.eq_ignore_ascii_case(d)) {
            out.push(d.to_string());
        }
    }
    out
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
    // Панели узнают клиента по User-Agent и чужим отвечают 502 или 403 —
    // со стороны человека это выглядит как «сервер сломался». Пробуем
    // по очереди: сначала его настройку, потом знакомых клиентов.
    let mut best_error = String::new();
    for (attempt, ua) in ua_chain(user_agent).into_iter().enumerate() {
        match fetch_as(url, &ua, headers) {
            Ok(mut result) => {
                result.ua_used = ua.clone();
                if attempt > 0 {
                    result.warnings.push(format!(
                        "провайдер не принял клиента «{user_agent}»: подписка загружена как {ua}"
                    ));
                }
                return Ok(result);
            }
            Err(e) => {
                if more_useful(&best_error, &e) || best_error.is_empty() {
                    best_error = e;
                }
            }
        }
    }
    Err(best_error)
}

/// Один запрос конкретным клиентом.
fn fetch_as(url: &str, user_agent: &str, headers: &[SubHeader]) -> Result<SubResult, String> {
    let agent = agent();
    let mut req = agent.get(url);
    req = req.header("User-Agent", user_agent);
    for h in headers {
        if !h.name.trim().is_empty() && !h.value.trim().is_empty() {
            req = req.header(h.name.trim(), h.value.trim());
        }
    }

    let mut resp = req.call().map_err(|e| match e {
        ureq::Error::StatusCode(code) => format!("сервер ответил {code}"),
        other => format!("сеть недоступна: {other}"),
    })?;

    let info = resp
        .headers()
        .get("subscription-userinfo")
        .and_then(|v| v.to_str().ok())
        .map(parse_userinfo);
    let title = resp
        .headers()
        .get("profile-title")
        .and_then(|v| v.to_str().ok())
        .map(parse_title)
        .unwrap_or_default();
    let refresh_hint = resp
        .headers()
        .get("profile-update-interval")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<u32>().ok())
        .unwrap_or(0);

    let mut body = String::new();
    resp.body_mut()
        .as_reader()
        .take(8 * 1024 * 1024)
        .read_to_string(&mut body)
        .map_err(|e| format!("не удалось прочитать ответ: {e}"))?;

    let mut parsed = parse(&body)?;
    // Заглушка вместо серверов — это отказ провайдера, а не список серверов.
    // Возвращаем ошибку с его словами: иначе рабочий список затрётся пустышкой.
    if let Some(reason) = placeholder_reason(&parsed.profiles) {
        return Err(format!("провайдер: {reason}"));
    }
    parsed.info = info;
    parsed.title = title;
    parsed.refresh_hint = refresh_hint;
    parsed.ua_used = String::new();
    Ok(parsed)
}

/// Import from pasted text: one or many `vless://` links, plain or base64-wrapped.
/// This is the path that makes the app work without any subscription at all.
pub fn import_text(text: &str) -> Result<Vec<Profile>, String> {
    let raw = text.trim();
    if raw.is_empty() {
        return Err("пусто: вставь ссылку vless://…".into());
    }
    // Вставить могут и целый конфиг: тогда это тот же разбор, что и у подписки
    if raw.starts_with('{') || raw.starts_with('[') {
        return parse(raw).map(|result| result.profiles);
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
        info: None,
        title: String::new(),
        refresh_hint: 0,
        format: "links".into(),
        ua_used: String::new(),
    })
}

/// Если все серверы в ответе — заглушка, возвращаем то, что провайдер написал
/// в её имени («Достигнут предел количества устройств» и подобное).
pub fn placeholder_reason(profiles: &[Profile]) -> Option<String> {
    if profiles.is_empty() || !profiles.iter().all(is_placeholder) {
        return None;
    }
    let text = profiles
        .iter()
        .map(|p| p.name.trim())
        .find(|n| !n.is_empty())
        .unwrap_or("серверов нет");
    Some(text.to_string())
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
            // Два разных JSON: sing-box (`type`) и Xray (`protocol`).
            // Провайдеры отдают и тот, и другой — понимаем оба.
            if let Some(p) = profile_from_singbox(ob).or_else(|| {
                if ob.get("protocol").and_then(|v| v.as_str()) == Some("vless") {
                    profile_from_xray(ob, &remarks)
                } else {
                    None
                }
            }) {
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
        info: None,
        title: String::new(),
        refresh_hint: 0,
        format: "xray-json".into(),
        ua_used: String::new(),
    })
}

/// Сервер из конфига sing-box: `{"type":"vless","server":...,"server_port":...}`.
/// Это родной формат нашего ядра, и часть провайдеров отдаёт подписку именно так.
fn profile_from_singbox(ob: &serde_json::Value) -> Option<Profile> {
    let kind = ob.get("type").and_then(|v| v.as_str())?;
    if kind != "vless" {
        return None;
    }
    let host = ob.get("server").and_then(|v| v.as_str())?.to_string();
    let port = ob.get("server_port").and_then(|v| v.as_u64())? as u16;
    let uuid = ob.get("uuid").and_then(|v| v.as_str())?.to_string();
    if host.is_empty() || uuid.is_empty() {
        return None;
    }
    let flow = ob.get("flow").and_then(|v| v.as_str()).unwrap_or("").to_string();

    let tls = ob.get("tls");
    let reality = tls.and_then(|t| t.get("reality"));
    let security = if reality.is_some() {
        "reality"
    } else if tls.and_then(|t| t.get("enabled")).and_then(|v| v.as_bool()).unwrap_or(false) {
        "tls"
    } else {
        "none"
    }
    .to_string();

    let transport = ob.get("transport");
    let network = transport
        .and_then(|t| t.get("type"))
        .and_then(|v| v.as_str())
        .and_then(|t| match t {
            "ws" => Some("ws"),
            "grpc" => Some("grpc"),
            "http" | "httpupgrade" => Some("ws"),
            _ => None,
        })
        .unwrap_or("tcp")
        .to_string();

    let sni = tls
        .and_then(|t| t.get("server_name"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let public_key = reality
        .and_then(|r| r.get("public_key"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let short_id = reality
        .and_then(|r| r.get("short_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let fingerprint = tls
        .and_then(|t| t.get("utls"))
        .and_then(|u| u.get("fingerprint"))
        .and_then(|v| v.as_str())
        .unwrap_or("chrome")
        .to_string();
    let service_name = transport
        .and_then(|t| t.get("service_name"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let path = transport
        .and_then(|t| t.get("path"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let tag = ob.get("tag").and_then(|v| v.as_str()).unwrap_or("");
    let name = if tag.is_empty() { host.clone() } else { tag.to_string() };

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
    fn placeholder_answer_is_an_error_not_a_server_list() {
        // Провайдер отвечает заглушкой, когда не узнал клиента или кончились
        // слоты устройств. Такой ответ нельзя показывать как сервер.
        let body = "dmxlc3M6Ly8wMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDBAMC4wLjAuMDoxP2VuY3J5cHRpb249bm9uZSZ0eXBlPXRjcCZzZWN1cml0eT1ub25lIyVEMCU5NCVEMCVCRSVEMSU4MSVEMSU4MiVEMCVCOCVEMCVCMyVEMCVCRCVEMSU4MyVEMSU4MiUyMCVEMCVCRiVEMSU4MCVEMCVCNSVEMCVCNCVEMCVCNSVEMCVCQiUyMCVEMSU4MyVEMSU4MSVEMSU4MiVEMSU4MCVEMCVCRSVEMCVCOSVEMSU4MSVEMSU4MiVEMCVCMg==";
        let parsed = parse(body).expect("тело разбирается");
        let reason = placeholder_reason(&parsed.profiles).expect("заглушка распознана");
        assert!(reason.contains("предел"), "причина: {reason}");
    }

    #[test]
    fn real_servers_are_not_mistaken_for_a_placeholder() {
        let body = "dmxlc3M6Ly8xOGM1YjkyMC0yMWE2LTQzYjEtODkzNi1lOGRjYjY5YTU0NzlAYmlzdzIyMi5heGlub2RlLnNicy4xMDEyMT9lbmNyeXB0aW9uPW5vbmUjJUQwJUE0JUQwJUI4JUQwJUJEJUQwJUJCJUQwJUI1JUQwJUJEJUQwJUI0JUQwJUI4JUQxJThG";
        let parsed = parse(body).expect("тело разбирается");
        assert!(placeholder_reason(&parsed.profiles).is_none());
    }

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
    #[test]
    fn reads_usage_and_expiry_from_the_header() {
        let info = parse_userinfo("upload=1024; download=2048; total=1048576; expire=1796462447");
        assert_eq!(info.upload, 1024);
        assert_eq!(info.download, 2048);
        assert_eq!(info.total, 1048576);
        assert_eq!(info.expire, 1796462447);
    }

    #[test]
    fn missing_or_broken_usage_fields_stay_zero() {
        let info = parse_userinfo("download=abc; total=; expire=1796462447");
        assert_eq!(info.download, 0);
        assert_eq!(info.total, 0);
        assert_eq!(info.expire, 1796462447);
        assert_eq!(parse_userinfo("").total, 0);
    }

    #[test]
    fn subscription_title_comes_from_plain_or_base64_header() {
        // "Happ VPN (RayTun)" → providers often wrap it in base64
        assert_eq!(parse_title("base64:SEFQUCBWUE4gKFJheVR1bik="), "HAPP VPN (RayTun)");
        assert_eq!(parse_title("Мой провайдер"), "Мой провайдер");
        assert_eq!(parse_title(""), "");
    }

    const SINGBOX_JSON: &str = r#"{
      "outbounds": [
        {
          "type": "vless",
          "tag": "Финляндия",
          "server": "fi1.example.invalid",
          "server_port": 443,
          "uuid": "11111111-1111-1111-1111-111111111111",
          "flow": "xtls-rprx-vision",
          "tls": {
            "enabled": true,
            "server_name": "www.example.invalid",
            "reality": { "enabled": true, "public_key": "PUB", "short_id": "ab" },
            "utls": { "enabled": true, "fingerprint": "chrome" }
          }
        },
        {
          "type": "vless",
          "tag": "Нидерланды",
          "server": "nl1.example.invalid",
          "server_port": 8443,
          "uuid": "22222222-2222-2222-2222-222222222222",
          "transport": { "type": "ws", "path": "/vless" }
        },
        { "type": "direct", "tag": "direct" }
      ]
    }"#;

    #[test]
    fn singbox_json_reality_becomes_a_profile() {
        let result = parse(SINGBOX_JSON).expect("конфиг sing-box должен разобраться");
        assert_eq!(result.profiles.len(), 2, "direct пропускается, два сервера остаются");
        let fi = &result.profiles[0];
        assert_eq!(fi.name, "Финляндия");
        assert_eq!(fi.host, "fi1.example.invalid");
        assert_eq!(fi.port, 443);
        assert_eq!(fi.security, "reality");
        assert_eq!(fi.network, "tcp");
        assert_eq!(fi.sni, "www.example.invalid");
        assert_eq!(fi.public_key, "PUB");
        assert_eq!(fi.short_id, "ab");
        assert_eq!(fi.flow, "xtls-rprx-vision");
    }

    #[test]
    fn singbox_json_ws_transport_is_kept() {
        let result = parse(SINGBOX_JSON).unwrap();
        let nl = &result.profiles[1];
        assert_eq!(nl.network, "ws");
        assert_eq!(nl.path, "/vless");
        // без tls в конфиге — без шифрования, а не «на всякий случай reality»
        assert_eq!(nl.security, "none");
    }

    #[test]
    fn singbox_json_without_servers_is_an_error() {
        let empty = r#"{ "outbounds": [ { "type": "direct", "tag": "d" } ] }"#;
        let err = parse(empty).unwrap_err();
        assert!(err.contains("VLESS"), "ошибка должна говорить, чего не хватает: {err}");
    }

    #[test]
    fn pasted_singbox_json_is_imported_like_a_link() {
        // «Импорт ссылки» принимает и конфиг: один и тот же разбор
        let profiles = import_text(SINGBOX_JSON).expect("вставка конфига должна работать");
        assert_eq!(profiles.len(), 2);
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

    #[test]
    fn client_chain_starts_with_the_configured_one() {
        let chain = ua_chain("K4R-Neko-VPN/1.5.0");
        assert_eq!(chain[0], "K4R-Neko-VPN/1.5.0");
        assert!(chain.len() > 1);
    }

    #[test]
    fn client_chain_does_not_repeat_the_same_name() {
        // человек вписал в настройках имя известного клиента — второй раз его
        // пробовать незачем
        let chain = ua_chain("v2rayNG/1.9.0");
        let same = chain.iter().filter(|u| u.eq_ignore_ascii_case("v2rayNG/1.9.0")).count();
        assert_eq!(same, 1);
    }

    #[test]
    fn empty_setting_still_leaves_someone_to_try() {
        let chain = ua_chain("   ");
        assert_eq!(chain.len(), UA_KNOWN.len());
        assert_eq!(chain[0], UA_KNOWN[0]);
    }

    #[test]
    fn provider_words_beat_technical_errors() {
        // «лимит устройств 5/5» объясняет больше, чем «сервер ответил 502»
        assert!(more_useful("сервер ответил 502", "провайдер: лимит устройств 5/5"));
        assert!(more_useful("провайдер отдал Clash YAML", "сервер ответил 502"));
        // и наоборот: техническая мелочь не должна затирать понятную причину
        assert!(!more_useful("провайдер: лимит устройств", "некорректный JSON: expected value"));
        assert!(!more_useful("провайдер: лимит устройств", "сервер ответил 502"));
    }

    #[test]
    fn empty_error_is_always_replaced() {
        assert!(more_useful("", "некорректный JSON"));
    }
}
