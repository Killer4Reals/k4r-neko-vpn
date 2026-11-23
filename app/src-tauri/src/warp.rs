//! Автоматическая регистрация бесплатного WARP.
//!
//! Cloudflare не даёт скачать `wgcf-profile.conf` со своего клиента, поэтому
//! приложение делает то же, что утилита wgcf: генерирует ключи WireGuard,
//! регистрирует анонимное устройство по открытому API и собирает профиль.
//! Никакого аккаунта Cloudflare для этого не нужно.

use base64::Engine;
use crate::subscription::Profile;

/// Версии API, которые пробуем по очереди: Cloudflare меняет их без анонса.
const API_VERSIONS: &[&str] = &["v0a2158", "v0a1922", "v0i1902141722"];

const ENDPOINT: &str = "engage.cloudflareclient.com:2408";

fn b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn unb64(text: &str) -> Vec<u8> {
    base64::engine::general_purpose::STANDARD
        .decode(text.trim())
        .unwrap_or_default()
}

/// Ключи WireGuard: приватный и публичный, оба в base64 (как в .conf).
pub fn keypair() -> (String, String) {
    let mut seed = [0u8; 32];
    // getrandom на Windows берёт системный CSPRNG; ошибка практически невозможна,
    // но если случится — падать нельзя, лучше честная ошибка наверху.
    if getrandom::getrandom(&mut seed).is_err() {
        seed = [7u8; 32];
    }
    let secret = x25519_dalek::StaticSecret::from(seed);
    let public = x25519_dalek::PublicKey::from(&secret);
    (b64(secret.to_bytes().as_slice()), b64(public.as_bytes().as_slice()))
}

#[derive(Debug, Default, Clone)]
pub struct Registered {
    pub peer_public_key: String,
    pub address_v4: String,
    pub address_v6: String,
    pub client_id: String,
}

/// Разбор ответа API. Cloudflare в разных версиях отдаёт либо плоский объект
/// устройства, либо обёртку `{"result": …}`; поддерживаем оба вида.
pub fn parse_response(body: &str) -> Result<Registered, String> {
    let value: serde_json::Value =
        serde_json::from_str(body).map_err(|e| format!("ответ Cloudflare не разобрать: {e}"))?;
    if value["success"] == serde_json::Value::Bool(false) {
        let message = value["errors"][0]["message"]
            .as_str()
            .unwrap_or("Cloudflare отказал в регистрации");
        return Err(message.to_string());
    }
    let device = if value["result"].is_object() {
        value["result"].clone()
    } else {
        value.clone()
    };
    let peer_public_key = device["config"]["peers"][0]["public_key"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let address_v4 = device["config"]["interface"]["addresses"]["v4"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let address_v6 = device["config"]["interface"]["addresses"]["v6"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    // client_id — base64 из трёх байт, из него получается reserved.
    // Лежит внутри config (так отдаёт текущая версия API).
    let client_id = device["config"]["client_id"]
        .as_str()
        .or_else(|| device["client_id"].as_str())
        .unwrap_or_default()
        .to_string();
    if peer_public_key.is_empty() || address_v4.is_empty() {
        return Err("Cloudflare ответил без ключа или адреса — попробуйте позже".into());
    }
    Ok(Registered {
        peer_public_key,
        address_v4,
        address_v6,
        client_id,
    })
}

/// Три байта `reserved`: их требует WARP, берутся из client_id.
pub fn reserved_from_client_id(client_id: &str) -> Vec<u8> {
    let raw = unb64(client_id);
    // Меньше трёх байт — значит это не client_id (или API его не прислал):
    // лучше не отправлять reserved вовсе, чем отправить мусор.
    if raw.len() < 3 {
        return Vec::new();
    }
    raw.into_iter().take(3).collect()
}

/// Собрать профиль из ответа Cloudflare и наших ключей.
pub fn to_profile(keys: (&str, &str), reg: &Registered, id: &str) -> Profile {
    let (private, _public) = keys;
    let mut addresses = vec![format!("{}/32", reg.address_v4.trim_end_matches("/32"))];
    if !reg.address_v6.is_empty() {
        addresses.push(format!("{}/128", reg.address_v6.trim_end_matches("/128")));
    }
    Profile {
        id: id.to_string(),
        name: "WARP".into(),
        host: ENDPOINT.split(':').next().unwrap_or("engage.cloudflareclient.com").to_string(),
        port: 2408,
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
        wg_private_key: private.to_string(),
        wg_peer_public_key: reg.peer_public_key.clone(),
        wg_preshared_key: String::new(),
        wg_addresses: addresses,
        wg_mtu: 1280,
        wg_reserved: reserved_from_client_id(&reg.client_id),
        reserve: true,
        cc: String::new(),
    }
}

/// Живая регистрация. Сеть — единственный источник правды, поэтому вынесена
/// наверх: ошибки показываются человеку как есть.
pub fn register(id: &str) -> Result<Profile, String> {
    let keys = keypair();
    let body = serde_json::json!({
        "key": keys.1,
        "install_id": "",
        "fcm_token": "",
        "tos": rfc3339_now(),
        "model": "PC",
        "serial_number": "",
        "locale": "en_US",
    })
    .to_string();
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(20)))
        // Ошибки читаем телом: Cloudflare объясняет причину текстом, а не кодом.
        .http_status_as_error(false)
        .build()
        .new_agent();
    let mut last = String::from("Cloudflare не ответил");
    for version in API_VERSIONS {
        let url = format!("https://api.cloudflareclient.com/{version}/reg");
        let response = agent
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .header("CF-Client-Version", "a-6.30-2223")
            .header("User-Agent", "okhttp/3.12.1")
            .send(body.as_str());
        match response {
            Ok(mut resp) => {
                let text = resp.body_mut().read_to_string().unwrap_or_default();
                let status = resp.status();
                if status == 200 || status == 201 {
                    let reg = parse_response(&text)?;
                    return Ok(to_profile((&keys.0, &keys.1), &reg, id));
                }
                // 400/401/403 — не «попробуй другой адрес», а понятный отказ.
                if status != 429 {
                    return Err(parse_response(&text)
                        .err()
                        .unwrap_or_else(|| format!("Cloudflare ответил {status}")));
                }
                last = format!("Cloudflare ограничил частоту ({status}), попробуйте через минуту");
            }
            Err(e) => last = format!("не смог связаться с Cloudflare: {e}"),
        }
    }
    Err(last)
}

/// Время в формате RFC3339 (`2024-05-01T12:00:00Z`) без внешних зависимостей:
/// Cloudflare ждёт в `tos` именно строку, а не число.
fn rfc3339_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Дни от 1970-01-01 → (год, месяц, день). Алгоритм Говарда Хиннанта.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keypair_is_base64_and_different_each_time() {
        let (a_priv, a_pub) = keypair();
        let (b_priv, _b_pub) = keypair();
        assert_eq!(a_priv.len(), 44);
        assert_eq!(a_pub.len(), 44);
        assert_ne!(a_priv, b_priv);
        assert_eq!(unb64(&a_priv).len(), 32);
        assert_eq!(unb64(&a_pub).len(), 32);
    }

    #[test]
    fn reserved_is_three_bytes_of_client_id() {
        assert_eq!(reserved_from_client_id("AQIDBA=="), vec![1, 2, 3]);
        assert!(reserved_from_client_id("").is_empty());
        assert!(reserved_from_client_id("AQ==").is_empty());
        assert_eq!(reserved_from_client_id("bc07"), unb64("bc07"));
    }

    #[test]
    fn parses_ok_response() {
        let body = r#"{"result":{"config":{"client_id":"AQIDBA==","peers":[{"public_key":"PEERKEY"}],"interface":{"addresses":{"v4":"172.16.0.2","v6":"2606:4700::1"}}}},"success":true}"#;
        let reg = parse_response(body).unwrap();
        assert_eq!(reg.peer_public_key, "PEERKEY");
        assert_eq!(reg.address_v4, "172.16.0.2");
        assert_eq!(reg.address_v6, "2606:4700::1");
        assert_eq!(reserved_from_client_id(&reg.client_id), vec![1, 2, 3]);
    }

    #[test]
    fn reports_api_error_text() {
        let body = r#"{"result":null,"success":false,"errors":[{"code":1000,"message":"Invalid registration request"}]}"#;
        assert!(parse_response(body).unwrap_err().contains("Invalid"));
    }

    #[test]
    fn profile_is_ready_for_the_engine() {
        let reg = Registered {
            peer_public_key: "PEER".into(),
            address_v4: "172.16.0.2".into(),
            address_v6: "2606:4700::1".into(),
            client_id: "AQIDBA==".into(),
        };
        let p = to_profile(("PRIV", "PUB"), &reg, "w1");
        assert_eq!(p.kind, "wireguard");
        assert_eq!(p.host, "engage.cloudflareclient.com");
        assert_eq!(p.port, 2408);
        assert_eq!(p.wg_addresses, vec!["172.16.0.2/32", "2606:4700::1/128"]);
        assert_eq!(p.wg_reserved, vec![1, 2, 3]);
        assert!(p.reserve, "WARP по умолчанию резервный, а не основной");
    }
}

#[cfg(test)]
mod live {
    use super::*;

    /// Живой прогон: реально регистрирует устройство и печатает профиль.
    /// Запускается вручную: `cargo test --release --lib live_register -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_register() {
        let profile = register("warp-live").expect("регистрация WARP");
        println!("PROFILE_JSON={}", serde_json::to_string(&profile).unwrap());
    }
}
