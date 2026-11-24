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
    /// "wireguard" — WireGuard (в том числе WARP), "trojan", "shadowsocks",
    /// "vmess", "hysteria2" — соответствующие протоколы, пусто — VLESS.
    #[serde(default)]
    pub kind: String,
    /// Пароль: у Trojan и Shadowsocks он вместо UUID.
    #[serde(default)]
    pub password: String,
    /// Шифр Shadowsocks (`aes-256-gcm`, `chacha20-ietf-poly1305` и прочие).
    #[serde(default)]
    pub method: String,
    /// VMess: `alterId` из конфига, почти везде 0.
    #[serde(default)]
    pub alter_id: u16,
    /// WireGuard: пара ключей, адрес внутри туннеля и MTU.
    #[serde(default)]
    pub wg_private_key: String,
    #[serde(default)]
    pub wg_peer_public_key: String,
    #[serde(default)]
    pub wg_preshared_key: String,
    #[serde(default)]
    pub wg_addresses: Vec<String>,
    #[serde(default)]
    pub wg_mtu: u16,
    /// WARP требует три байта reserved; у обычного WireGuard их нет.
    #[serde(default)]
    pub wg_reserved: Vec<u8>,
    /// Резервный сервер: включается, только когда основные не работают.
    #[serde(default)]
    pub reserve: bool,
    /// Страна сервера двумя буквами (de, nl, us…). Пусто, если не разобрали.
    /// Без неё глобус не знает, куда ставить метку, а список — какой рисовать флаг.
    #[serde(default)]
    pub cc: String,
    /// Узел пришёл из подписки. Такие узлы заменяются при каждом обновлении:
    /// провайдер убрал сервер — он должен исчезнуть и у нас. Свои узлы
    /// (импорт по ссылке, WARP) не трогаем никогда.
    #[serde(default)]
    pub from_sub: bool,
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
pub const UA_KNOWN: [&str; 6] = [
    "v2rayNG/1.9.0",
    "Streisand/1.6.0",
    "ClashMetaForAndroid/2.11.1.Meta",
    // Панели с учётом устройств (Remnawave и его форки) отвечают настоящими
    // конфигами только тем клиентам, которых знают по имени. v2rayNG у них
    // в белом списке почти всегда, Happ и v2raytun — тоже.
    "Happ/1.22.0",
    "v2raytun/3.0.1",
    // Именно с хвостом «.Meta» панели отдают Clash-конфиг; без него — заглушку.
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
                // Лимит устройств и подобные отказы не лечатся сменой клиента.
                if let Some(msg) = e.strip_prefix(FATAL) {
                    return Err(msg.to_string());
                }
                if more_useful(&best_error, &e) || best_error.is_empty() {
                    best_error = e;
                }
            }
        }
    }
    Err(best_error)
}

/// Отказ, который не стоит повторять другим User-Agent: лечится у провайдера.
const FATAL: char = '\u{1}';

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
    // Панели с учётом устройств закрывают доступ, когда лимит исчерпан, но
    // отвечают при этом 200 и списком-заглушкой. Без разбора этого заголовка
    // человек видел бы «нет серверов» и не понимал, что делать.
    let limited = ["x-hwid-max-devices-reached", "x-hwid-limit"]
        .iter()
        .any(|h| {
            resp.headers()
                .get(*h)
                .and_then(|v| v.to_str().ok())
                .map(|v| v.trim().eq_ignore_ascii_case("true"))
                .unwrap_or(false)
        });
    if limited {
        return Err(format!(
            "{FATAL}провайдер: лимит устройств исчерпан — отключи лишнее устройство в кабинете провайдера и повтори"
        ));
    }
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
    if raw.starts_with('{') || raw.starts_with('[') || looks_like_clash(raw) {
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
        let detail = errors
            .first()
            .cloned()
            .unwrap_or_else(|| "ссылок vless://, trojan://, ss://, vmess:// не найдено".into());
        return Err(format!("не удалось импортировать: {detail}"));
    }
    Ok(out)
}

pub fn parse(body: &str) -> Result<SubResult, String> {
    // Всё, что пришло из подписки, помечаем её узлом: иначе при обновлении
    // старые узлы не заменить, и список растёт с каждым запуском.
    let mut result = parse_body(body)?;
    for p in result.profiles.iter_mut() {
        p.from_sub = true;
    }
    Ok(result)
}

fn parse_body(body: &str) -> Result<SubResult, String> {
    let text = body.trim();

    if text.starts_with('{') || text.starts_with('[') {
        return parse_json(text).map(drop_nameless_nodes);
    }
    if looks_like_clash(text) {
        return parse_clash(text).map(drop_nameless_nodes);
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
        if line.starts_with("vless://")
            || line.starts_with("trojan://")
            || line.starts_with("ss://")
            || line.starts_with("vmess://")
        {
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

    Ok(drop_nameless_nodes(SubResult {
        profiles,
        warnings,
        info: None,
        title: String::new(),
        refresh_hint: 0,
        format: "links".into(),
        ua_used: String::new(),
    }))
}

/// YAML от Clash/Mihomo: провайдеры отдают его, когда узнают знакомый клиент,
/// и другого списка у них может не быть вовсе.
fn looks_like_clash(text: &str) -> bool {
    text.contains("proxies:") && !text.contains("vless://")
}

/// Убрать узлы без названия: провайдер повторяет в подписке служебную строку
/// «Авто-выбор сервера» (или «Fastest»), и она попадает в список как сервер,
/// который никогда не отвечает. Если в подписке есть узлы с настоящими именами
/// (страна, город), такие строки-группы выкидываем. Если имён нет ни у кого —
/// оставляем как есть, иначе список станет пустым.
fn drop_nameless_nodes(mut result: SubResult) -> SubResult {
    let has_named = result.profiles.iter().any(|p| name_score(&p.name) >= 3);
    if !has_named {
        return result;
    }
    let before = result.profiles.len();
    result
        .profiles
        .retain(|p| name_score(&p.name) > 0 || p.kind == "wireguard");
    let dropped = before - result.profiles.len();
    if dropped > 0 {
        result
            .warnings
            .push(format!("пропущено служебных строк без адреса: {dropped}"));
    }
    result
}

fn parse_clash(text: &str) -> Result<SubResult, String> {
    let doc: serde_yaml_ng::Value = serde_yaml_ng::from_str(text)
        .map_err(|e| format!("провайдер отдал Clash YAML, но разобрать не вышло: {e}"))?;
    let list = doc
        .get("proxies")
        .and_then(|v| v.as_sequence())
        .ok_or_else(|| "в Clash YAML нет списка proxies".to_string())?;

    let mut profiles: Vec<Profile> = Vec::new();
    // Что пропустили и почему — человек должен видеть, что список короче, чем
    // у провайдера, и почему.
    let mut skipped: Vec<(String, usize)> = Vec::new();
    for item in list {
        match clash_profile(item) {
            Some(p) => profiles.push(p),
            None => {
                let kind = ystr(item, "type");
                let kind = if kind.is_empty() {
                    "без типа".to_string()
                } else {
                    kind
                };
                match skipped.iter_mut().find(|(k, _)| *k == kind) {
                    Some((_, n)) => *n += 1,
                    None => skipped.push((kind, 1)),
                }
            }
        }
    }

    if profiles.is_empty() {
        let detail = if skipped.is_empty() {
            "список серверов пуст".to_string()
        } else {
            let list: Vec<String> = skipped.iter().map(|(k, n)| format!("{k} — {n}")).collect();
            format!("в списке только неподдерживаемые типы: {}", list.join(", "))
        };
        return Err(format!("Clash YAML: {detail}"));
    }

    let mut warnings = Vec::new();
    for (kind, n) in &skipped {
        warnings.push(format!(
            "пропущено узлов {kind}: {n} — приложение работает по VLESS"
        ));
    }

    Ok(SubResult {
        profiles,
        warnings,
        info: None,
        title: String::new(),
        refresh_hint: 0,
        format: "clash".into(),
        ua_used: String::new(),
    })
}

/// Один узел Clash YAML в нашу структуру. Пусто — узел, который мы не умеем
/// запускать (ss, vmess, trojan, hysteria…): лучше честно пропустить, чем
/// показать сервер, к которому не подключиться.
fn clash_profile(item: &serde_yaml_ng::Value) -> Option<Profile> {
    let kind = ystr(item, "type").to_ascii_lowercase();
    if !matches!(kind.as_str(), "vless" | "trojan" | "shadowsocks" | "ss" | "vmess") {
        return None;
    }
    let host = ystr(item, "server");
    if host.is_empty() {
        return None;
    }
    // Shadowsocks в Clash пишут и как `ss`, и как `shadowsocks`
    let kind = if kind == "ss" { "shadowsocks".to_string() } else { kind };
    let is_vless = kind == "vless";
    let uuid = ystr(item, "uuid");
    let password = ystr(item, "password");
    let method = ystr(item, "cipher");
    // У VLESS и VMess опознавательный знак — UUID, у Trojan и SS — пароль.
    if is_vless || kind == "vmess" {
        if uuid.is_empty() {
            return None;
        }
    } else if password.is_empty() {
        return None;
    }
    if kind == "shadowsocks" && method.is_empty() {
        return None;
    }
    let port = ynum(item, "port").unwrap_or(443) as u16;
    if port == 0 {
        return None;
    }

    let network = {
        let n = ystr(item, "network");
        if n.is_empty() {
            "tcp".to_string()
        } else {
            n
        }
    };
    // h2 в sing-box нет; такие узлы честнее пропустить, чем подсунуть tcp.
    if network == "h2" {
        return None;
    }

    let reality = item.get("reality-opts");
    let tls_on = ybool(item, "tls").unwrap_or(false) || reality.is_some();
    let security = if reality.is_some() {
        "reality".to_string()
    } else if tls_on || kind == "trojan" {
        // У Trojan TLS не опция, а часть протокола — в конфигах поле часто не пишут
        "tls".to_string()
    } else if false {
        String::new()
    } else {
        "none".to_string()
    };

    let sni = {
        let a = ystr(item, "servername");
        if a.is_empty() {
            ystr(item, "sni")
        } else {
            a
        }
    };
    let public_key = reality
        .map(|r| ystr(r, "public-key"))
        .unwrap_or_default();
    let short_id = reality.map(|r| ystr(r, "short-id")).unwrap_or_default();
    let fingerprint = {
        let f = ystr(item, "client-fingerprint");
        if f.is_empty() {
            "chrome".to_string()
        } else {
            f
        }
    };
    let path = item
        .get("ws-opts")
        .map(|w| ystr(w, "path"))
        .unwrap_or_default();
    let service_name = item
        .get("grpc-opts")
        .map(|g| ystr(g, "grpc-service-name"))
        .unwrap_or_default();

    let name = {
        let n = ystr(item, "name");
        if n.trim().is_empty() {
            format!("{host}:{port}")
        } else {
            n
        }
    };
    let cc = cc_from_host(&host)
        .or_else(|| cc_from_text(&name))
        .unwrap_or_default();

    let alter_id = ynum(item, "alterId").unwrap_or(0).min(u16::MAX as u64) as u16;
    let id_key = if uuid.is_empty() { password.clone() } else { uuid.clone() };

    Some(Profile {
        id: format!("{host}:{port}:{id_key}"),
        name,
        host,
        port,
        uuid,
        flow: ystr(item, "flow"),
        // У Trojan TLS включён всегда, у Shadowsocks его нет вовсе
        security: if kind == "shadowsocks" { "none".to_string() } else { security },
        network: if kind == "shadowsocks" { "tcp".to_string() } else { network },
        sni,
        public_key,
        short_id,
        fingerprint,
        service_name,
        path,
        kind: if is_vless { String::new() } else { kind },
        password,
        method,
        alter_id,
        wg_private_key: String::new(),
        wg_peer_public_key: String::new(),
        wg_preshared_key: String::new(),
        wg_addresses: Vec::new(),
        wg_mtu: 0,
        wg_reserved: Vec::new(),
        reserve: false,
        cc,
        from_sub: true,
    })
}

/// Строка из YAML: строки, числа и булевы значения — всё, что панели пишут
/// в поля вроде `port: 443` или `tls: true`.
fn ystr(v: &serde_yaml_ng::Value, key: &str) -> String {
    match v.get(key) {
        Some(serde_yaml_ng::Value::String(s)) => s.trim().to_string(),
        Some(serde_yaml_ng::Value::Number(n)) => n.to_string(),
        Some(serde_yaml_ng::Value::Bool(b)) => b.to_string(),
        _ => String::new(),
    }
}

fn ynum(v: &serde_yaml_ng::Value, key: &str) -> Option<u64> {
    match v.get(key) {
        Some(serde_yaml_ng::Value::Number(n)) => n.as_u64(),
        Some(serde_yaml_ng::Value::String(s)) => s.trim().parse::<u64>().ok(),
        _ => None,
    }
}

fn ybool(v: &serde_yaml_ng::Value, key: &str) -> Option<bool> {
    match v.get(key) {
        Some(serde_yaml_ng::Value::Bool(b)) => Some(*b),
        Some(serde_yaml_ng::Value::String(s)) => match s.trim().to_ascii_lowercase().as_str() {
            "true" | "yes" | "1" => Some(true),
            "false" | "no" | "0" => Some(false),
            _ => None,
        },
        _ => None,
    }
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

/// Коды стран, которые встречаются в подписках: двухбуквенный ярлык в домене
/// (`de.savethis.cloud`) — самый надёжный признак страны сервера.
const KNOWN_CC: [&str; 46] = [
    "ad", "ae", "al", "am", "ar", "at", "au", "az", "ba", "bg", "br", "by", "ca", "ch", "cn",
    "cy", "cz", "de", "dk", "ee", "es", "fi", "fr", "gb", "ge", "gr", "hk", "hr", "hu", "id",
    "ie", "il", "in", "ir", "is", "it", "jp", "ke", "kg", "kr", "kz", "lt", "lu", "lv", "md",
    "mk",
];

/// Хвост списка: страны, которые провайдеры отдают чаще всего.
const KNOWN_CC_TAIL: [&str; 26] = [
    "mt", "mx", "my", "ng", "nl", "no", "nz", "pe", "ph", "pl", "pt", "ro", "rs", "ru", "se",
    "sg", "si", "sk", "th", "tr", "tw", "ua", "us", "uz", "vn", "za",
];

fn is_cc(s: &str) -> bool {
    let s = s.trim().to_ascii_lowercase();
    s.len() == 2 && (KNOWN_CC.contains(&s.as_str()) || KNOWN_CC_TAIL.contains(&s.as_str()))
}

/// `de.savethis.cloud` → "de". Смотрим только первые два ярлыка: дальше идут
/// общие слова (`cloud`, `net`), которые совпадут с чьим-нибудь кодом случайно.
fn cc_from_host(host: &str) -> Option<String> {
    let host = host.trim().to_ascii_lowercase();
    let mut labels = host.split('.');
    for _ in 0..2 {
        let Some(label) = labels.next() else { break };
        if is_cc(label) {
            return Some(label.to_string());
        }
    }
    None
}

/// Названия стран латиницей, которые провайдеры пишут прямо в имени сервера.
const CC_WORDS: [(&str, &str); 22] = [
    ("germany", "de"),
    ("netherlands", "nl"),
    ("holland", "nl"),
    ("norway", "no"),
    ("estonia", "ee"),
    ("sweden", "se"),
    ("finland", "fi"),
    ("turkey", "tr"),
    ("kazakh", "kz"),
    ("japan", "jp"),
    ("usa", "us"),
    ("united states", "us"),
    ("america", "us"),
    ("russia", "ru"),
    ("france", "fr"),
    ("poland", "pl"),
    ("latvia", "lv"),
    ("lithuania", "lt"),
    ("singapore", "sg"),
    ("canada", "ca"),
    ("switzerland", "ch"),
    ("united kingdom", "gb"),
];

/// Страна из флага-эмодзи: два региональных символа (`🇩🇪`) — это код ISO.
fn cc_from_emoji(text: &str) -> Option<String> {
    let cps: Vec<u32> = text.chars().map(|c| c as u32).collect();
    for w in cps.windows(2) {
        let (a, b) = (w[0], w[1]);
        if (0x1F1E6..=0x1F1FF).contains(&a) && (0x1F1E6..=0x1F1FF).contains(&b) {
            let cc = format!(
                "{}{}",
                char::from_u32('a' as u32 + (a - 0x1F1E6)).unwrap_or('?'),
                char::from_u32('a' as u32 + (b - 0x1F1E6)).unwrap_or('?')
            );
            if is_cc(&cc) {
                return Some(cc);
            }
        }
    }
    None
}

/// Страна из текста: сначала флаг, потом английское название страны.
fn cc_from_text(text: &str) -> Option<String> {
    // «#DE» в конце ссылки — самый частый вид имени у провайдеров.
    let bare = text.trim();
    if is_cc(bare) {
        return Some(bare.to_ascii_lowercase());
    }
    cc_from_emoji(text).or_else(|| {
        let low = text.to_ascii_lowercase();
        CC_WORDS
            .iter()
            .find(|(word, _)| low.contains(word))
            .map(|(_, cc)| (*cc).to_string())
    })
}

/// Как подписать сервер в списке: флаг и название страны по-русски.
fn country_label(cc: &str) -> Option<String> {
    let name = match cc {
        "de" => "Германия",
        "nl" => "Нидерланды",
        "no" => "Норвегия",
        "ee" => "Эстония",
        "se" => "Швеция",
        "fi" => "Финляндия",
        "tr" => "Турция",
        "kz" => "Казахстан",
        "jp" => "Япония",
        "us" => "США",
        "ru" => "Россия",
        "fr" => "Франция",
        "pl" => "Польша",
        "lv" => "Латвия",
        "lt" => "Литва",
        "sg" => "Сингапур",
        "ca" => "Канада",
        "ch" => "Швейцария",
        "gb" => "Великобритания",
        "at" => "Австрия",
        "it" => "Италия",
        "es" => "Испания",
        "cz" => "Чехия",
        "ro" => "Румыния",
        "bg" => "Болгария",
        "rs" => "Сербия",
        "ua" => "Украина",
        "am" => "Армения",
        "ge" => "Грузия",
        "dk" => "Дания",
        "ie" => "Ирландия",
        "pt" => "Португалия",
        "gr" => "Греция",
        "hu" => "Венгрия",
        "md" => "Молдавия",
        "hk" => "Гонконг",
        "kr" => "Корея",
        "in" => "Индия",
        "br" => "Бразилия",
        "au" => "Австралия",
        "za" => "ЮАР",
        "ar" => "Аргентина",
        "mx" => "Мексика",
        "cn" => "Китай",
        "id" => "Индонезия",
        "my" => "Малайзия",
        "th" => "Таиланд",
        "vn" => "Вьетнам",
        "ph" => "Филиппины",
        "nz" => "Новая Зеландия",
        "il" => "Израиль",
        "ae" => "ОАЭ",
        "is" => "Исландия",
        "lu" => "Люксембург",
        "be" => "Бельгия",
        "by" => "Беларусь",
        "uz" => "Узбекистан",
        "kg" => "Киргизия",
        _ => "",
    };
    if name.is_empty() {
        return None;
    }
    // Без флага в строке: интерфейс рисует его сам по коду страны
    Some(name.to_string())
}

/// `de` → 🇩🇪. Строим сами: провайдер может прислать имя без флага.
fn emoji_for(cc: &str) -> String {
    let mut out = String::new();
    for ch in cc.chars().take(2) {
        let up = ch.to_ascii_uppercase();
        if let Some(c) = char::from_u32(0x1F1E6 + (up as u32 - 'A' as u32)) {
            out.push(c);
        }
    }
    out
}

/// Насколько имя узла похоже на человеческое. Провайдер отдаёт один и тот же
/// сервер и в группе «Авто-выбор», и отдельной строкой со страной: если взять
/// первое вхождение, весь список называется «Авто-выбор сервера», а страна не
/// определяется — ни флагов, ни меток на глобусе.
fn name_score(name: &str) -> u8 {
    let low = name.to_lowercase();
    if cc_from_emoji(name).is_some() || CC_WORDS.iter().any(|(word, _)| low.contains(word)) {
        return 3;
    }
    let generic = [
        "авто", "auto", "fastest", "быстр", "выбор", "select", "all nodes", "глобал",
    ];
    if generic.iter().any(|g| low.contains(g)) {
        return 0;
    }
    if name.trim().is_empty() {
        0
    } else {
        1
    }
}

/// Тот же сервер приходит несколько раз: держим вариант с лучшим именем,
/// а при равных — первый (он обычно и есть основной).
fn push_best(profiles: &mut Vec<Profile>, p: Profile) {
    if let Some(existing) = profiles.iter_mut().find(|x| x.id == p.id) {
        if name_score(&p.name) > name_score(&existing.name) {
            *existing = p;
        }
        return;
    }
    profiles.push(p);
}

/// Русская подпись страны плюс метки варианта из имени провайдера:
/// «🇪🇸 Испания gRPC» → «Испания gRPC», «🇩🇪 Германия 2 TCP» → «Германия 2 TCP».
/// Метки — только короткие ascii-токены с цифрой или заглавной буквой
/// (2, gRPC, TCP, WS, H2); названия городов отбрасываем, страна важнее.
fn localize_name(name: &str, cc: &str) -> String {
    let label = country_label(cc).unwrap_or_else(|| cc.to_string());
    let mut marks: Vec<String> = Vec::new();
    for token in strip_flag(name).split(|c: char| !c.is_ascii_alphanumeric()) {
        if token.is_empty() || token.len() > 6 {
            continue;
        }
        let looks_like_variant = token.chars().any(|c| c.is_ascii_digit() || c.is_ascii_uppercase());
        // «Germany» — это страна, а не метка варианта: её заменит русская подпись
        let is_country_word = CC_WORDS
            .iter()
            .any(|(word, _)| word.eq_ignore_ascii_case(token) || word.replace(' ', "") == token.to_lowercase());
        if is_country_word || token.eq_ignore_ascii_case(&label) {
            continue;
        }
        if !looks_like_variant && token.len() > 6 {
            continue;
        }
        if !marks.iter().any(|m| m.eq_ignore_ascii_case(token)) {
            marks.push(token.to_string());
        }
    }
    if marks.is_empty() {
        label
    } else {
        format!("{label} {}", marks.join(" "))
    }
}

/// Флаг в начале имени, если его там нет: список читается одинаково,
/// откуда бы провайдер ни взял название.
fn strip_flag(name: &str) -> String {
    // Флаг рисует интерфейс по коду страны. Если оставить эмодзи в названии,
    // в списке будет два флага подряд.
    let cleaned: String = name
        .chars()
        .filter(|c| !(0x1F1E6..=0x1F1FF).contains(&(*c as u32)))
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('-').trim();
    if cleaned.is_empty() {
        name.trim().to_string()
    } else {
        cleaned.to_string()
    }
}

fn parse_json(text: &str) -> Result<SubResult, String> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("некорректный JSON: {e}"))?;

    let configs: Vec<&serde_json::Value> = match &value {
        serde_json::Value::Array(items) => items.iter().collect(),
        obj @ serde_json::Value::Object(_) => vec![obj],
        _ => return Err("неизвестный формат подписки".into()),
    };

    // Группа «Авто-выбор / Fastest» — не сервер, а список тех же серверов.
    // Если в подписке есть конфиги с человеческими названиями, группу пропускаем:
    // иначе в списке появляется строка, которая никогда не отвечает.
    let config_rank = |cfg: &&serde_json::Value| {
        let remarks = cfg.get("remarks").and_then(|v| v.as_str()).unwrap_or("");
        if name_score(remarks) >= 3 {
            0
        } else if name_score(remarks) == 0 {
            2
        } else {
            1
        }
    };
    let mut ordered: Vec<&serde_json::Value> = configs.clone();
    ordered.sort_by_key(config_rank);

    let mut profiles: Vec<Profile> = Vec::new();
    for cfg in ordered {
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
            if let Some(mut p) = profile_from_singbox(ob).or_else(|| {
                if ob.get("protocol").and_then(|v| v.as_str()) == Some("vless") {
                    profile_from_xray(ob, &remarks)
                } else {
                    None
                }
            }) {
                // Страна: домен (`de.savethis.cloud`) → ярлык узла → название
                // в примечании → флаг. Без страны глобус не знает, куда ставить
                // метку, а список показывает одинаковые строки без флагов.
                let cc = cc_from_host(&p.host)
                    .or_else(|| cc_from_text(&p.name))
                    .or_else(|| cc_from_text(&remarks));
                if let Some(cc) = cc {
                    let score = name_score(&p.name);
                    p.name = if score == 3 {
                        // «🇪🇸 Испания gRPC» → «Испания gRPC»: подпись страны
                        // по-русски, но метка варианта сохраняется, иначе
                        // gRPC и TCP выглядят одинаково
                        localize_name(&p.name, &cc)
                    } else {
                        country_label(&cc).unwrap_or(p.name)
                    };
                    p.cc = cc;
                } else if !remarks.is_empty() {
                    p.name = remarks.clone();
                }
                push_best(&mut profiles, p);
            }
        }
    }

    // Один и тот же узел обычно приходит несколько раз: в группе «Fastest»,
    // в своей стране и в цепочках. Дубликаты в списке выглядят как баг.
    let mut seen = std::collections::HashSet::new();
    profiles.retain(|p| seen.insert(p.id.clone()));

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
        id: format!("{host}:{port}:{uuid}:{network}"),
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
    
            kind: String::new(),
    
            password: String::new(),
    
            method: String::new(),
    
            alter_id: 0,
            wg_private_key: String::new(),
            wg_peer_public_key: String::new(),
            wg_preshared_key: String::new(),
            wg_addresses: Vec::new(),
            wg_mtu: 0,
            wg_reserved: Vec::new(),
            reserve: false,
        cc: String::new(),
        from_sub: true,
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
        id: format!("{host}:{port}:{uuid}:{network}"),
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
    
            kind: String::new(),
    
            password: String::new(),
    
            method: String::new(),
    
            alter_id: 0,
            wg_private_key: String::new(),
            wg_peer_public_key: String::new(),
            wg_preshared_key: String::new(),
            wg_addresses: Vec::new(),
            wg_mtu: 0,
            wg_reserved: Vec::new(),
            reserve: false,
        cc: String::new(),
        from_sub: true,
        })
}

/// `trojan://пароль@host:443?sni=&type=ws&path=/#Имя`.
fn parse_trojan_link(link: &str) -> Result<Profile, String> {
    let url = url::Url::parse(link).map_err(|e| format!("битая ссылка: {e}"))?;
    let password = url.username().to_string();
    let host = url
        .host_str()
        .ok_or_else(|| "в ссылке нет адреса сервера".to_string())?
        .to_string();
    let port = url.port().unwrap_or(443);
    let q: std::collections::HashMap<String, String> = url.query_pairs().into_owned().collect();
    let get = |k: &str| q.get(k).cloned().unwrap_or_default();
    let name = percent_encoding::percent_decode_str(url.fragment().unwrap_or(""))
        .decode_utf8_lossy()
        .to_string();
    let name = if name.trim().is_empty() { format!("{host}:{port}") } else { name };
    let cc = cc_from_host(&host).or_else(|| cc_from_text(&name)).unwrap_or_default();
    Ok(Profile {
        id: format!("{host}:{port}:{password}"),
        name,
        host,
        port,
        uuid: String::new(),
        flow: String::new(),
        security: "tls".to_string(),
        network: if get("type").is_empty() { "tcp".to_string() } else { get("type") },
        sni: get("sni"),
        public_key: String::new(),
        short_id: String::new(),
        fingerprint: if get("fp").is_empty() { "chrome".to_string() } else { get("fp") },
        service_name: get("serviceName"),
        path: get("path"),
        kind: "trojan".to_string(),
        password,
        method: String::new(),
        alter_id: 0,
        wg_private_key: String::new(),
        wg_peer_public_key: String::new(),
        wg_preshared_key: String::new(),
        wg_addresses: Vec::new(),
        wg_mtu: 0,
        wg_reserved: Vec::new(),
        reserve: false,
        cc,
        from_sub: false,
    })
}

/// `ss://base64(метод:пароль)@host:port#Имя` и старый вид, где в base64 лежит
/// весь адрес вместе с портом.
fn parse_ss_link(link: &str) -> Result<Profile, String> {
    let rest = link.trim_start_matches("ss://");
    let (body, name) = match rest.split_once('#') {
        Some((b, n)) => (
            b,
            percent_encoding::percent_decode_str(n).decode_utf8_lossy().to_string(),
        ),
        None => (rest, String::new()),
    };
    let body = body.split('?').next().unwrap_or(body);
    let decoded = |t: &str| -> String {
        use base64::Engine as _;
        base64::engine::general_purpose::STANDARD_NO_PAD
            .decode(t.trim_end_matches('='))
            .or_else(|_| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(t))
            .ok()
            .and_then(|b| String::from_utf8(b).ok())
            .unwrap_or_else(|| t.to_string())
    };
    // Два вида: «метод:пароль@host:port» (хвост открытым текстом) и
    // «base64(метод:пароль@host:port)» целиком.
    let (credentials, host_port) = match body.rsplit_once('@') {
        Some((cred, hp)) => (decoded(cred), hp.to_string()),
        None => {
            let all = decoded(body);
            let (cred, hp) = all
                .rsplit_once('@')
                .ok_or_else(|| "в ss-ссылке нет адреса".to_string())?;
            (cred.to_string(), hp.to_string())
        }
    };
    let (method, password) = credentials
        .split_once(':')
        .ok_or_else(|| "в ss-ссылке нет метода и пароля".to_string())?;
    let (host, port) = host_port
        .rsplit_once(':')
        .ok_or_else(|| "в ss-ссылке нет порта".to_string())?;
    let host = host.trim_matches(['[', ']']).to_string();
    let port: u16 = port.trim().parse().map_err(|_| "порт не число".to_string())?;
    if host.is_empty() || method.trim().is_empty() {
        return Err("ss-ссылка неполная".into());
    }
    let name = if name.trim().is_empty() { format!("{host}:{port}") } else { name };
    let cc = cc_from_host(&host).or_else(|| cc_from_text(&name)).unwrap_or_default();
    Ok(Profile {
        id: format!("{host}:{port}:{password}"),
        name,
        host,
        port,
        uuid: String::new(),
        flow: String::new(),
        security: "none".to_string(),
        network: "tcp".to_string(),
        sni: String::new(),
        public_key: String::new(),
        short_id: String::new(),
        fingerprint: String::new(),
        service_name: String::new(),
        path: String::new(),
        kind: "shadowsocks".to_string(),
        password: password.to_string(),
        method: method.trim().to_string(),
        alter_id: 0,
        wg_private_key: String::new(),
        wg_peer_public_key: String::new(),
        wg_preshared_key: String::new(),
        wg_addresses: Vec::new(),
        wg_mtu: 0,
        wg_reserved: Vec::new(),
        reserve: false,
        cc,
        from_sub: false,
    })
}

/// `vmess://base64(json)`: самый старый и самый распространённый вид.
fn parse_vmess_link(link: &str) -> Result<Profile, String> {
    use base64::Engine as _;
    let raw = link.trim_start_matches("vmess://");
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(raw)
        .or_else(|_| base64::engine::general_purpose::STANDARD.decode(raw.trim_end_matches('=')))
        .or_else(|_| base64::engine::general_purpose::STANDARD_NO_PAD.decode(raw.trim_end_matches('=')))
        .map_err(|_| "vmess-ссылка не в base64".to_string())?;
    let text = String::from_utf8(bytes).map_err(|_| "vmess-ссылка не в UTF-8".to_string())?;
    let doc: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("vmess JSON не разобрался: {e}"))?;
    let get = |k: &str| {
        doc.get(k)
            .map(|v| match v {
                serde_json::Value::String(s) => s.trim().to_string(),
                other => other.to_string(),
            })
            .unwrap_or_default()
    };
    let host = get("add");
    let uuid = get("id");
    if host.is_empty() || uuid.is_empty() {
        return Err("в vmess-ссылке нет адреса или id".into());
    }
    let port: u16 = get("port").parse().unwrap_or(443);
    let net = {
        let n = get("net");
        if n.is_empty() { "tcp".to_string() } else { n }
    };
    let tls_on = get("tls").eq_ignore_ascii_case("tls");
    let name = {
        let n = get("ps");
        if n.trim().is_empty() { format!("{host}:{port}") } else { n }
    };
    let cc = cc_from_host(&host).or_else(|| cc_from_text(&name)).unwrap_or_default();
    Ok(Profile {
        id: format!("{host}:{port}:{uuid}"),
        name,
        host,
        port,
        uuid,
        flow: String::new(),
        security: if tls_on { "tls".to_string() } else { "none".to_string() },
        network: net,
        sni: {
            let s = get("sni");
            if s.is_empty() { get("host") } else { s }
        },
        public_key: String::new(),
        short_id: String::new(),
        fingerprint: "chrome".to_string(),
        service_name: get("path"),
        path: get("path"),
        kind: "vmess".to_string(),
        password: String::new(),
        method: String::new(),
        alter_id: get("aid").parse().unwrap_or(0),
        wg_private_key: String::new(),
        wg_peer_public_key: String::new(),
        wg_preshared_key: String::new(),
        wg_addresses: Vec::new(),
        wg_mtu: 0,
        wg_reserved: Vec::new(),
        reserve: false,
        cc,
        from_sub: false,
    })
}

pub fn parse_link(link: &str) -> Result<Profile, String> {
    let scheme = link.split("://").next().unwrap_or("").to_ascii_lowercase();
    match scheme.as_str() {
        "trojan" => return parse_trojan_link(link),
        "ss" => return parse_ss_link(link),
        "vmess" => return parse_vmess_link(link),
        "vless" => {}
        other => return Err(format!("протокол {other} не поддержан")),
    }
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

    // Страну считаем до переноса строк в структуру.
    let cc = cc_from_host(&host)
        .or_else(|| cc_from_text(&name))
        .unwrap_or_default();

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
        kind: String::new(),
        password: String::new(),
        method: String::new(),
        alter_id: 0,
        wg_private_key: String::new(),
        wg_peer_public_key: String::new(),
        wg_preshared_key: String::new(),
        wg_addresses: Vec::new(),
        wg_mtu: 0,
        wg_reserved: Vec::new(),
        reserve: false,
        cc,
        from_sub: false,
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

    const AUTO_GROUP_XRAY: &str = r#"[
      {"remarks":"🔥 Авто-выбор сервера","outbounds":[
        {"protocol":"vless","settings":{"vnext":[{"address":"fi.example.invalid","port":443,"users":[{"id":"11111111-1111-1111-1111-111111111111"}]}]},"streamSettings":{"network":"tcp","security":"reality"}},
        {"protocol":"vless","settings":{"vnext":[{"address":"de.example.invalid","port":443,"users":[{"id":"22222222-2222-2222-2222-222222222222"}]}]},"streamSettings":{"network":"tcp","security":"reality"}}]},
      {"remarks":"🇫🇮 Финляндия","outbounds":[
        {"protocol":"vless","settings":{"vnext":[{"address":"fi.example.invalid","port":443,"users":[{"id":"11111111-1111-1111-1111-111111111111"}]}]},"streamSettings":{"network":"tcp","security":"reality"}}]},
      {"remarks":"🇩🇪 Германия","outbounds":[
        {"protocol":"vless","settings":{"vnext":[{"address":"de.example.invalid","port":443,"users":[{"id":"22222222-2222-2222-2222-222222222222"}]}]},"streamSettings":{"network":"tcp","security":"reality"}}]}
    ]"#;

    /// Живой провайдер кладёт каждый сервер дважды: в группе «Авто-выбор»
    /// и отдельной строкой со страной. Если брать первое вхождение, весь список
    /// называется «Авто-выбор сервера», а страна не определяется — ни флагов,
    /// ни меток на глобусе.
    #[test]
    fn auto_group_does_not_steal_node_names() {
        let r = parse(AUTO_GROUP_XRAY).expect("список должен разобраться");
        assert_eq!(r.profiles.len(), 2, "узлы не должны размножаться");
        assert_eq!(r.profiles[0].name, "Финляндия");
        assert_eq!(r.profiles[0].cc, "fi");
        assert_eq!(r.profiles[1].name, "Германия");
        assert_eq!(r.profiles[1].cc, "de");
    }

    /// Проверка на настоящем ответе провайдера: файл с телом подписки в
    /// `K4R_BODY_FILE`. Нужен, чтобы видеть, что видит человек, без сети.
    #[test]
    #[ignore]
    fn parses_real_body_from_file() {
        let path = std::env::var("K4R_BODY_FILE").expect("нужен K4R_BODY_FILE");
        let body = std::fs::read_to_string(path).expect("файл читается");
        let r = parse(&body).expect("разбирается");
        println!("серверов={} предупреждения={:?}", r.profiles.len(), r.warnings);
        for p in &r.profiles {
            println!("  {} ({}) host={}", p.name, p.cc, p.host);
        }
        assert!(!r.profiles.is_empty());
    }

    /// Служебная строка «Авто-выбор» в base64-подписке (так её отдаёт этот
    /// провайдер для незнакомых клиентов) становится сервером, который не
    /// отвечает. Если рядом есть узлы с настоящими именами — строку убираем.
    #[test]
    fn service_link_without_a_name_is_dropped() {
        let link = |host: &str, name: &str| {
            let q = "encryption=none&security=reality&sni=deepl.com&fp=firefox&pbk=K&sid=ab&type=grpc&serviceName=api";
            format!("vless://11111111-2222-4333-8444-555555555555@{host}:10121?{q}#{name}")
        };
        let raw = format!(
            "{}
{}
{}",
            link("selectel.ru", "Auto%20select"),
            link("fi.example.invalid", "%F0%9F%87%AB%F0%9F%87%AE%20Finland"),
            link("nl.example.invalid", "Amsterdam"),
        );
        let body = base64::engine::general_purpose::STANDARD.encode(raw);
        let r = parse(&body).expect("разбирается");
        assert_eq!(r.profiles.len(), 2, "служебная строка ушла, два сервера остались");
        assert!(r.profiles.iter().all(|p| !p.name.to_lowercase().contains("auto")));
        assert_eq!(r.warnings.len(), 1);
    }

    /// Группу «Авто-выбор» ставим в разбор последней, иначе она занимает место
    /// настоящего сервера и в списке висит строка, которая не отвечает.
    #[test]
    fn generic_group_does_not_take_the_place_of_a_named_node() {
        let body = r#"[
          {"remarks":"🔥 Авто-выбор сервера","outbounds":[
            {"protocol":"vless","settings":{"vnext":[{"address":"a.example.invalid","port":443,"users":[{"id":"44444444-4444-4444-4444-444444444444"}]}]},"streamSettings":{"network":"tcp","security":"reality"}}]},
          {"remarks":"🇳🇱 Нидерланды","outbounds":[
            {"protocol":"vless","settings":{"vnext":[{"address":"a.example.invalid","port":443,"users":[{"id":"44444444-4444-4444-4444-444444444444"}]}]},"streamSettings":{"network":"tcp","security":"reality"}}]}
        ]"#;
        let r = parse(body).expect("разбирается");
        assert_eq!(r.profiles.len(), 1);
        assert_eq!(r.profiles[0].name, "Нидерланды");
        assert_eq!(r.profiles[0].cc, "nl");
    }

    /// gRPC и TCP — разные варианты одного сервера: их нельзя схлопнуть.
    #[test]
    fn grpc_and_tcp_variants_stay_separate() {
        let body = r#"[{"remarks":"🇪🇸 Испания gRPC","outbounds":[
            {"protocol":"vless","settings":{"vnext":[{"address":"es.example.invalid","port":443,"users":[{"id":"33333333-3333-3333-3333-333333333333"}]}]},"streamSettings":{"network":"grpc","security":"reality"}}]},
          {"remarks":"🇪🇸 Испания TCP","outbounds":[
            {"protocol":"vless","settings":{"vnext":[{"address":"es.example.invalid","port":443,"users":[{"id":"33333333-3333-3333-3333-333333333333"}]}]},"streamSettings":{"network":"tcp","security":"reality"}}]}]"#;
        let r = parse(body).expect("список должен разобраться");
        assert_eq!(r.profiles.len(), 2);
        let names: Vec<&str> = r.profiles.iter().map(|p| p.name.as_str()).collect();
        assert!(names.contains(&"Испания gRPC"), "имена: {names:?}");
        assert!(names.contains(&"Испания TCP"), "имена: {names:?}");
    }

    /// Живая проверка: тянет настоящую подписку и складывает конфиг нашего ядра
    /// в файл. Дальше его можно отдать `sing-box run` и увидеть, что сервер
    /// действительно поднимается. Запуск: K4R_SUB_URL=... cargo test
    /// dumps_engine_config -- --ignored --nocapture
    #[test]
    #[ignore]
    fn dumps_engine_config_for_live_check() {
        let url = std::env::var("K4R_SUB_URL").expect("нужен K4R_SUB_URL");
        let hwid = std::env::var("K4R_SUB_HWID").unwrap_or_default();
        let headers = vec![SubHeader {
            name: "X-HWID".into(),
            value: hwid,
        }];
        let ua = std::env::var("K4R_UA").unwrap_or_default();
        let r = fetch(&url, &ua, &headers).expect("подписка должна загрузиться");
        let want = std::env::var("K4R_CC").unwrap_or_default();
        let p = r
            .profiles
            .iter()
            .find(|p| want.is_empty() || p.cc == want)
            .expect("в подписке нет узла с такой страной");
        // «всё через туннель»: по умолчанию в NetOptions выбран режим «только
        // отмеченные программы», и тогда пустой список отправляет всё напрямую
        let mut opts = crate::engine::NetOptions::default();
        opts.split_mode = "all".to_string();
        // пул: выбранный узел плюс два соседних — так проверяем urltest на живом ядре
        let pool: Vec<_> = r
            .profiles
            .iter()
            .filter(|x| x.id != p.id)
            .take(2)
            .cloned()
            .collect();
        let cfg = crate::engine::build_pool_config(p, &pool, &[], &opts);
        let path = std::env::temp_dir().join("k4r-live-engine.json");
        std::fs::write(&path, serde_json::to_string_pretty(&cfg).unwrap()).unwrap();
        println!("узел: {} ({}) → {}", p.name, p.cc, path.display());
    }

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

    /// Живая проверка на настоящей подписке владельца. По умолчанию пропущена:
    /// нужен интернет и ссылка.
    ///
    /// ```text
    /// K4R_SUB_URL=... K4R_SUB_HWID=... cargo test --ignored fetches_real_subscription
    /// ```
    #[test]
    #[ignore]
    fn fetches_real_subscription() {
        let Ok(url) = std::env::var("K4R_SUB_URL") else { return };
        let hwid = std::env::var("K4R_SUB_HWID").unwrap_or_else(|_| "k4r-night-smoke".into());
        let headers = vec![
            SubHeader { name: "X-HWID".into(), value: hwid },
            SubHeader { name: "X-Device-OS".into(), value: "Windows".into() },
            SubHeader { name: "X-Ver-OS".into(), value: "10.0".into() },
            SubHeader { name: "X-Ver-App".into(), value: "1.35.0".into() },
        ];
        match fetch(&url, "", &headers) {
            Ok(r) => {
                println!(
                    "формат={} серверов={} клиент={} название={:?}",
                    r.format,
                    r.profiles.len(),
                    r.ua_used,
                    r.title
                );
                if let Some(info) = &r.info {
                    println!("трафик: скачано {} Б, лимит {}", info.download, info.total);
                }
                for w in &r.warnings {
                    println!("  предупреждение: {w}");
                }
                for p in &r.profiles {
                    println!("  узел: {:?} страна={:?} host={}", p.name, p.cc, p.host);
                }
                let mut countries: Vec<&str> = r.profiles.iter().map(|p| p.cc.as_str()).collect();
                countries.sort_unstable();
                countries.dedup();
                println!("страны: {}", countries.join(" "));
                assert!(!r.profiles.is_empty());
            }
            Err(e) => {
                // Отказ провайдера — тоже результат: главное, что он человеческий.
                println!("отказ: {e}");
                assert!(!e.is_empty());
            }
        }
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
    #[test]
    fn parses_live_sample_when_provided() {
        let Ok(path) = std::env::var("K4R_SAMPLE") else { return };
        let text = std::fs::read_to_string(&path).expect("sample readable");
        let r = parse(&text).expect("sample parses");
        println!("profiles={}", r.profiles.len());
        for p in r.profiles.iter().take(20) {
            println!(
                "  {} | {} {}:{} {} {} {}",
                p.name, p.kind, p.host, p.port, p.security, p.network, p.uuid
            );
        }
        assert!(r.profiles.len() >= 10, "ожидали хотя бы 10 серверов");
    }

    #[test]
    fn country_comes_from_the_domain_first() {
        assert_eq!(cc_from_host("de.savethis.cloud").as_deref(), Some("de"));
        assert_eq!(cc_from_host("ru.savethis.cloud").as_deref(), Some("ru"));
        assert_eq!(cc_from_host("node1.us.example.net").as_deref(), Some("us"));
        // общие слова не должны становиться странами
        assert_eq!(cc_from_host("vpn.example.com"), None);
        assert_eq!(cc_from_host("proxy.k4r.ink"), None);
    }

    #[test]
    fn country_comes_from_a_flag_or_a_name() {
        assert_eq!(cc_from_emoji("🇳🇴 Norway").as_deref(), Some("no"));
        assert_eq!(cc_from_emoji("🇪🇺 Fastest").as_deref(), None);
        assert_eq!(cc_from_text("🇩🇪 Germany").as_deref(), Some("de"));
        assert_eq!(cc_from_text("Frankfurt").as_deref(), None);
    }

    #[test]
    fn servers_are_named_after_their_own_country() {
        // «Fastest» — сборная солянка: у каждого узла своя страна из домена.
        let body = r#"[
          {"remarks":"🇪🇺 Fastest","outbounds":[
            {"protocol":"vless","tag":"germanyvless1","settings":{"vnext":[{"address":"de.savethis.cloud","port":443,"users":[{"id":"ad2d5897-ee02-4b85-b86f-9a994cc84b01"}]}]},"streamSettings":{"network":"tcp","security":"reality","realitySettings":{"serverName":"de.savethis.cloud","publicKey":"k","fingerprint":"firefox"}}},
            {"protocol":"vless","tag":"japanvless1","settings":{"vnext":[{"address":"jp.savethis.cloud","port":443,"users":[{"id":"ad2d5897-ee02-4b85-b86f-9a994cc84b01"}]}]},"streamSettings":{"network":"tcp","security":"reality","realitySettings":{"serverName":"jp.savethis.cloud","publicKey":"k","fingerprint":"firefox"}}}
          ]},
          {"remarks":"🇩🇪 Germany","outbounds":[
            {"protocol":"vless","tag":"germanyvless1","settings":{"vnext":[{"address":"de.savethis.cloud","port":443,"users":[{"id":"ad2d5897-ee02-4b85-b86f-9a994cc84b01"}]}]},"streamSettings":{"network":"tcp","security":"reality","realitySettings":{"serverName":"de.savethis.cloud","publicKey":"k","fingerprint":"firefox"}}}
          ]}
        ]"#;
        let r = parse(body).expect("разбирается");
        // один и тот же узел в двух конфигах — не два сервера
        assert_eq!(r.profiles.len(), 2, "дубликаты склеены");
        assert_eq!(r.profiles[0].cc, "de");
        assert_eq!(r.profiles[0].name, "Германия");
        assert_eq!(r.profiles[1].cc, "jp");
        assert_eq!(r.profiles[1].name, "Япония");
        assert!(r.profiles.iter().all(|p| p.host.contains(".savethis.cloud")));
    }

    #[test]
    fn device_limit_is_reported_as_the_providers_own_words() {
        // Панель отвечает 200 и заглушкой, но помечает лимит заголовком.
        // Такое сообщение важнее любого «сервер ответил 200».
        let msg = "\u{1}провайдер: лимит устройств исчерпан — отключи лишнее устройство в кабинете провайдера и повтори";
        let stripped = msg.strip_prefix(FATAL).unwrap();
        assert!(stripped.starts_with("провайдер:"));
        assert!(stripped.contains("лимит устройств"));
    }

    #[test]
    fn sends_device_headers_and_reports_the_device_limit() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        // Локальный сервер вместо провайдера: проверяем, что мы вообще отправляем
        // X-HWID (без него панели с учётом устройств отдают заглушку) и что
        // заголовок лимита превращается в понятную фразу, а не в «нет серверов».
        let listener = TcpListener::bind("127.0.0.1:0").expect("порт");
        let addr = listener.local_addr().expect("адрес");
        let handle = std::thread::spawn(move || {
            let mut seen = String::new();
            for round in 0..2 {
                let (mut sock, _) = listener.accept().expect("соединение");
                let mut buf = [0u8; 4096];
                let n = sock.read(&mut buf).unwrap_or(0);
                let text = String::from_utf8_lossy(&buf[..n]).to_string();
                if round == 0 {
                    seen = text;
                    let body = "[]";
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\
                         X-HWID-Max-Devices-Reached: true\r\nContent-Length: {}\r\n\
                         Connection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = sock.write_all(resp.as_bytes());
                } else {
                    let body = "vless://11111111-2222-3333-4444-555555555555@example.com:443?type=tcp&security=tls#DE";
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\n\
                         Connection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = sock.write_all(resp.as_bytes());
                }
            }
            seen
        });

        let headers = vec![SubHeader {
            name: "X-HWID".into(),
            value: "k4r-test-id".into(),
        }];
        let url = format!("http://{addr}/sub");

        let err = fetch_as(&url, "v2rayNG/1.9.0", &headers).expect_err("лимит — это ошибка");
        let msg = err.strip_prefix(FATAL).expect("отказ помечен как окончательный");
        assert!(msg.contains("лимит устройств"), "сообщение: {msg}");

        let ok = fetch_as(&url, "v2rayNG/1.9.0", &headers).expect("обычный ответ разбирается");
        assert_eq!(ok.profiles.len(), 1);
        assert_eq!(ok.profiles[0].cc, "de", "страна берётся из домена или флага");

        let request = handle.join().expect("сервер закончил");
        assert!(
            request.to_lowercase().contains("x-hwid: k4r-test-id"),
            "заголовок устройства не отправлен: {request}"
        );
    }

    #[test]
    fn reads_clash_yaml_with_reality_ws_and_grpc() {
        // Так выглядит ответ панели Remnawave клиенту Clash: серверы только
        // здесь, ссылок vless:// в ответе нет вовсе.
        let yaml = r#"
mixed-port: 7890
proxies:
  - name: "🇩🇪 Франкфурт"
    type: vless
    server: de1.example.net
    port: 443
    uuid: 11111111-2222-3333-4444-555555555555
    network: tcp
    tls: true
    servername: de1.example.net
    reality-opts:
      public-key: PUBKEY111
      short-id: abcd
    client-fingerprint: chrome
    flow: xtls-rprx-vision
  - name: "🇳🇱 Амстердам"
    type: vless
    server: nl1.example.net
    port: 8443
    uuid: 22222222-3333-4444-5555-666666666666
    network: ws
    tls: true
    servername: nl1.example.net
    ws-opts:
      path: /tunnel
      headers:
        Host: nl1.example.net
  - name: "🇺🇸 Нью-Йорк"
    type: vless
    server: us1.example.net
    port: 2053
    uuid: 33333333-4444-5555-6666-777777777777
    network: grpc
    tls: true
    grpc-opts:
      grpc-service-name: grpcsvc
  - name: "🇸🇬 Сингапур"
    type: ss
    server: sg1.example.net
    port: 8388
    cipher: aes-256-gcm
    password: secret
  - name: "🇯🇵 Токио"
    type: trojan
    server: jp1.example.net
    port: 443
    password: secret
"#;
        let parsed = parse(yaml).expect("YAML разбирается");
        assert_eq!(parsed.format, "clash");
        assert_eq!(parsed.profiles.len(), 5, "VLESS, Trojan и SS читаются все");

        let de = &parsed.profiles[0];
        assert_eq!(de.host, "de1.example.net");
        assert_eq!(de.security, "reality");
        assert_eq!(de.public_key, "PUBKEY111");
        assert_eq!(de.short_id, "abcd");
        assert_eq!(de.flow, "xtls-rprx-vision");
        assert_eq!(de.cc, "de");

        let nl = &parsed.profiles[1];
        assert_eq!(nl.network, "ws");
        assert_eq!(nl.path, "/tunnel");
        assert_eq!(nl.cc, "nl");

        let us = &parsed.profiles[2];
        assert_eq!(us.network, "grpc");
        assert_eq!(us.service_name, "grpcsvc");
        assert_eq!(us.cc, "us");

        assert!(parsed.warnings.is_empty(), "пропускать больше нечего: {:?}", parsed.warnings);
    }

    #[test]
    fn clash_placeholder_is_recognised_as_a_limit() {
        // Панель на пределе устройств отдаёт целый конфиг Clash, но внутри
        // один узел-заглушка с причиной в имени.
        let yaml = r#"
proxies:
  - name: Достигнут предел количества устройств
    type: vless
    server: 0.0.0.0
    port: 1
    uuid: 00000000-0000-0000-0000-000000000000
    network: tcp
"#;
        let parsed = parse(yaml).expect("YAML разбирается даже пустышкой");
        let reason = placeholder_reason(&parsed.profiles).expect("заглушка распознана");
        assert!(reason.contains("предел"), "причина: {reason}");
    }

    #[test]
    fn clash_with_only_unsupported_types_explains_itself() {
        let yaml = r#"
proxies:
  - name: Токио
    type: hysteria2
    server: jp.example.net
    port: 443
    password: y
  - name: Токио 2
    type: tuic
    server: jp2.example.net
    port: 443
"#;
        let err = parse(yaml).expect_err("без знакомых протоколов список пуст");
        assert!(err.contains("неподдерживаемые"), "сообщение: {err}");
        assert!(err.contains("hysteria2"), "сообщение: {err}");
    }

    #[test]
    fn clash_yaml_can_be_pasted_as_text() {
        let yaml = r#"
proxies:
  - name: Берлин
    type: vless
    server: de.example.net
    port: 443
    uuid: 44444444-5555-6666-7777-888888888888
    network: tcp
    tls: true
"#;
        let list = import_text(yaml).expect("импорт вставкой");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].host, "de.example.net");
    }

    #[test]
    fn base64_link_list_is_not_mistaken_for_clash() {
        // В обычном ответе тоже бывает слово proxies:, но ссылки на месте —
        // такой ответ надо читать как ссылки.
        let body = "dmxlc3M6Ly8xOGM1YjkyMC0yMWE2LTQzYjEtODkzNi1lOGRjYjY5YTU0NzlAYmlzdzIyMi5heGlub2RlLnNicy4xMDEyMT9lbmNyeXB0aW9uPW5vbmUjJUQwJUE0JUQwJUI4JUQwJUJEJUQwJUJCJUQwJUI1JUQwJUJEJUQwJUI0JUQwJUI4JUQxJThG";
        assert!(!looks_like_clash(body));
        let parsed = parse(body).expect("список ссылок разбирается");
        assert_eq!(parsed.format, "links");
    }

    #[test]
    fn clash_gives_trojan_and_shadowsocks_too() {
        let yaml = r#"
proxies:
  - name: "🇩🇪 Франкфурт Trojan"
    type: trojan
    server: de.example.net
    port: 443
    password: secret-pass
    sni: de.example.net
    skip-cert-verify: false
  - name: "🇳🇱 Амстердам SS"
    type: ss
    server: nl.example.net
    port: 8388
    cipher: aes-256-gcm
    password: ss-pass
  - name: "🇺🇸 Нью-Йорк VMess"
    type: vmess
    server: us.example.net
    port: 443
    uuid: 55555555-6666-7777-8888-999999999999
    alterId: 0
    network: ws
    tls: true
    ws-opts:
      path: /vm
"#;
        let parsed = parse(yaml).expect("YAML разбирается");
        assert_eq!(parsed.profiles.len(), 3);

        let trojan = &parsed.profiles[0];
        assert_eq!(trojan.kind, "trojan");
        assert_eq!(trojan.password, "secret-pass");
        assert_eq!(trojan.security, "tls");

        let ss = &parsed.profiles[1];
        assert_eq!(ss.kind, "shadowsocks");
        assert_eq!(ss.method, "aes-256-gcm");
        assert_eq!(ss.password, "ss-pass");
        assert_eq!(ss.security, "none");

        let vmess = &parsed.profiles[2];
        assert_eq!(vmess.kind, "vmess");
        assert_eq!(vmess.network, "ws");
        assert_eq!(vmess.path, "/vm");
        assert!(parsed.warnings.is_empty(), "пропускать больше нечего: {:?}", parsed.warnings);
    }

    #[test]
    fn trojan_link_is_understood() {
        let p = parse_link("trojan://pass123@de.example.net:443?sni=de.example.net&type=ws&path=%2Fws#Германия").unwrap();
        assert_eq!(p.kind, "trojan");
        assert_eq!(p.password, "pass123");
        assert_eq!(p.network, "ws");
        assert_eq!(p.path, "/ws");
        assert_eq!(p.sni, "de.example.net");
        assert_eq!(p.cc, "de");
    }

    #[test]
    fn ss_link_is_understood_in_both_shapes() {
        use base64::Engine as _;
        // вид 1: base64(метод:пароль)@host:port
        let cred = base64::engine::general_purpose::STANDARD_NO_PAD.encode("aes-256-gcm:sspass");
        let p = parse_link(&format!("ss://{cred}@nl.example.net:8388#Амстердам")).unwrap();
        assert_eq!(p.kind, "shadowsocks");
        assert_eq!(p.method, "aes-256-gcm");
        assert_eq!(p.password, "sspass");
        assert_eq!(p.port, 8388);

        // вид 2: base64 от всего адреса целиком
        let all = base64::engine::general_purpose::STANDARD_NO_PAD
            .encode("chacha20-ietf-poly1305:pw@us.example.net:443");
        let p2 = parse_link(&format!("ss://{all}#Нью-Йорк")).unwrap();
        assert_eq!(p2.host, "us.example.net");
        assert_eq!(p2.port, 443);
        assert_eq!(p2.method, "chacha20-ietf-poly1305");
    }

    #[test]
    fn vmess_link_is_understood() {
        use base64::Engine as _;
        let json = r#"{"v":"2","ps":"Токио","add":"jp.example.net","port":"443","id":"66666666-7777-8888-9999-000000000000","aid":"0","net":"ws","path":"/v","tls":"tls","sni":"jp.example.net"}"#;
        let b = base64::engine::general_purpose::STANDARD.encode(json);
        let p = parse_link(&format!("vmess://{b}")).unwrap();
        assert_eq!(p.kind, "vmess");
        assert_eq!(p.host, "jp.example.net");
        assert_eq!(p.network, "ws");
        assert_eq!(p.security, "tls");
        assert_eq!(p.name, "Токио");
        assert_eq!(p.cc, "jp");
    }

    #[test]
    fn link_list_with_mixed_protocols_is_read() {
        use base64::Engine as _;
        let body_text = concat!(
            "vless://11111111-2222-3333-4444-555555555555@de.example.net:443?type=tcp&security=tls#Германия\n",
            "trojan://pw@nl.example.net:443#Нидерланды\n",
            "ss://YWVzLTI1Ni1nY206cHc@us.example.net:8388#США\n"
        );
        let body = base64::engine::general_purpose::STANDARD.encode(body_text);
        let parsed = parse(&body).expect("список разбирается");
        let kinds: Vec<&str> = parsed.profiles.iter().map(|p| p.kind.as_str()).collect();
        assert_eq!(kinds, vec!["", "trojan", "shadowsocks"]);
    }

}
