//! Проверка утечек: IPv6, адрес выхода и DNS-резолвер.
//!
//! Это не «лаборатория», а три честных вопроса, на которые можно ответить
//! изнутри приложения: ходит ли IPv6 мимо туннеля, какой у нас адрес выхода и
//! какой резолвер реально отвечает. Всё остальное (WebRTC и прочее) к нашему
//! приложению не относится: у нас нет браузера.

use serde::Serialize;

#[derive(Serialize, Debug, Default, Clone)]
pub struct LeakReport {
    /// true = IPv6 наружу не проходит (это хорошо, если блок включён)
    pub ipv6_blocked: bool,
    pub ipv6_detail: String,
    /// IP, который видит интернет
    pub exit_ip: String,
    pub exit_colo: String,
    pub exit_detail: String,
    /// Резолвер, который видит внешний сервис
    pub dns_resolver: String,
    pub dns_detail: String,
}

/// Разбор `cdn-cgi/trace`: строки вида `ip=1.2.3.4`.
pub fn parse_trace(text: &str) -> (String, String) {
    let mut ip = String::new();
    let mut colo = String::new();
    for line in text.lines() {
        if let Some(v) = line.strip_prefix("ip=") {
            ip = v.trim().to_string();
        } else if let Some(v) = line.strip_prefix("colo=") {
            colo = v.trim().to_string();
        }
    }
    (ip, colo)
}

/// Разбор ответа edns.ip-api.com: `{"dns":{"ip":"..."}}`.
pub fn parse_dns_ip(body: &str) -> String {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v["dns"]["ip"].as_str().map(|s| s.to_string()))
        .unwrap_or_default()
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(10)))
        .user_agent("K4R-Neko-VPN/leak")
        .build()
        .new_agent()
}

fn get_text(url: &str) -> Result<String, String> {
    agent()
        .get(url)
        .call()
        .map_err(|e| format!("{e}"))?
        .into_body()
        .read_to_string()
        .map_err(|e| e.to_string())
}

/// Есть ли IPv6 наружу. Соединяемся с публичным IPv6-адресом: успех означает,
/// что IPv6-трафик уходит из системы.
pub fn ipv6_reaches_out() -> bool {
    use std::net::{Ipv6Addr, SocketAddr, TcpStream};
    let target = SocketAddr::from((Ipv6Addr::new(0x2606, 0x4700, 0x4700, 0, 0, 0, 0, 0x1111), 443));
    TcpStream::connect_timeout(&target, std::time::Duration::from_secs(3)).is_ok()
}

/// Полный прогон. Ни один шаг не валит остальные: сеть бывает разной.
pub fn check() -> LeakReport {
    let mut report = LeakReport::default();

    let v6 = ipv6_reaches_out();
    report.ipv6_blocked = !v6;
    report.ipv6_detail = if v6 {
        "IPv6-соединение установилось".into()
    } else {
        "IPv6-соединения нет".into()
    };

    match get_text("https://www.cloudflare.com/cdn-cgi/trace") {
        Ok(text) => {
            let (ip, colo) = parse_trace(&text);
            report.exit_ip = ip;
            report.exit_colo = colo;
            report.exit_detail = if report.exit_ip.is_empty() {
                "ответ без адреса".into()
            } else {
                "адрес выхода получен".into()
            };
        }
        Err(e) => report.exit_detail = format!("не удалось узнать адрес выхода: {e}"),
    }

    match get_text("https://edns.ip-api.com/json") {
        Ok(body) => {
            report.dns_resolver = parse_dns_ip(&body);
            report.dns_detail = if report.dns_resolver.is_empty() {
                "сервис не назвал резолвер".into()
            } else {
                "резолвер определён".into()
            };
        }
        Err(e) => report.dns_detail = format!("не удалось узнать резолвер: {e}"),
    }

    report
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trace_parsing_takes_ip_and_colo() {
        let text = "fl=123\nh=www.cloudflare.com\nip=203.0.113.7\nts=1\ncolo=FRA\n";
        assert_eq!(parse_trace(text), ("203.0.113.7".into(), "FRA".into()));
    }

    #[test]
    fn trace_without_ip_is_empty_not_garbage() {
        assert_eq!(parse_trace("fl=1\ncolo=AMS\n"), (String::new(), "AMS".into()));
    }

    #[test]
    fn dns_ip_parsing_handles_both_shapes() {
        assert_eq!(parse_dns_ip(r#"{"dns":{"ip":"9.9.9.9"}}"#), "9.9.9.9");
        assert_eq!(parse_dns_ip("не json"), "");
    }

    #[test]
    fn ipv6_probe_never_panics() {
        // В песочнице без IPv6 результат false, с IPv6 — true; главное, что не падает.
        let _ = ipv6_reaches_out();
    }
}
