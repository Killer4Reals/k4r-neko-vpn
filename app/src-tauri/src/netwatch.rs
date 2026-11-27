//! Сторож сети для ПК: заметить, что сменился адрес выхода (Wi-Fi → кабель,
//! другой Wi-Fi, подняли после сна), и переподнять туннель.
//!
//! Почему опрос, а не события Windows: события требуют COM-интерфейсов и новых
//! зависимостей, а смена маршрута по умолчанию меняет локальный адрес, которым
//! ОС собирается идти наружу. Он и есть наш признак. Раз в пять секунд — это
//! ноль нагрузки и никакой магии.

use std::net::UdpSocket;
use std::time::{Duration, Instant};

use crate::engine::TUN_ADDR_V4;

/// Адрес, которым ОС собирается идти в интернет. Пустая строка — сети нет.
/// DNS-сервер отвечать не обязан: UDP-сокет не отправляет пакетов, только
/// выбирает маршрут, поэтому функция работает даже когда всё заблокировано.
pub fn local_ip() -> String {
    let Ok(sock) = UdpSocket::bind("0.0.0.0:0") else {
        return String::new();
    };
    match sock.connect("1.1.1.1:53") {
        Ok(_) => sock
            .local_addr()
            .map(|a| a.ip().to_string())
            .unwrap_or_default(),
        Err(_) => String::new(),
    }
}

/// Пора ли переподключаться: адрес сменился на другой непустой.
/// Появление сети после её отсутствия — тоже смена: туннель к тому моменту
/// уже мёртв. Переход на адрес TUN сменой не считается: это наш же туннель.
pub fn changed(previous: &str, current: &str) -> bool {
    !current.is_empty() && current != TUN_ADDR_V4 && previous != current
}

/// Один шаг сторожа: (переподключаться?, новое отложенное изменение).
///
/// В тихий период после старта смену не теряем, а запоминаем. Если адрес
/// продержался до конца периода, переподключаемся: иначе смена Wi-Fi в первые
/// двадцать секунд после запуска оставалась бы незамеченной до следующей
/// смены сети.
pub fn step(
    previous: &str,
    current: &str,
    quiet: bool,
    pending: Option<&str>,
) -> (bool, Option<String>) {
    if current.is_empty() || current == TUN_ADDR_V4 {
        // Ушли в туннель или остались без сети: отложенное не пригодится.
        return (false, None);
    }
    if changed(previous, current) {
        return if quiet {
            (false, Some(current.to_string()))
        } else {
            (true, None)
        };
    }
    match pending {
        Some(p) if !quiet && p == current => (true, None),
        _ => (false, pending.map(str::to_string)),
    }
}

/// Крутится всё время работы приложения. `on_switch` вызывается, когда сеть
/// сменилась и туннель был поднят — решать, что делать, ему.
pub fn watch<F>(mut on_switch: F)
where
    F: FnMut() + Send + 'static,
{
    std::thread::spawn(move || {
        let mut previous = local_ip();
        // После старта даём туннелю встать: первый же переход с реального
        // адреса на TUN (или обратно после убитого ядра) иначе выглядит как
        // смена сети и вызывает лишний перезапуск.
        let mut quiet_until = Instant::now() + Duration::from_secs(20);
        let mut pending: Option<String> = None;
        loop {
            std::thread::sleep(Duration::from_secs(5));
            let current = local_ip();
            let (fire, next_pending) = step(
                &previous,
                &current,
                Instant::now() < quiet_until,
                pending.as_deref(),
            );
            pending = next_pending;
            if fire {
                pending = None;
                quiet_until = Instant::now() + Duration::from_secs(20);
                on_switch();
            }
            previous = current;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_address_is_not_a_change() {
        assert!(!changed("192.168.1.5", "192.168.1.5"));
    }

    #[test]
    fn another_address_is_a_change() {
        assert!(changed("192.168.1.5", "10.0.0.7"));
    }

    #[test]
    fn tunnel_address_is_not_a_network_switch() {
        assert!(!changed("192.168.1.5", TUN_ADDR_V4));
        // Выход из туннеля на реальную сеть — наоборот, повод переподняться.
        assert!(changed(TUN_ADDR_V4, "192.168.1.5"));
    }

    #[test]
    fn network_came_back_counts_as_a_change() {
        // пока сети не было, туннель умер: вернувшуюся сеть надо подхватить
        assert!(changed("", "192.168.1.5"));
    }

    #[test]
    fn network_going_away_is_not_a_reconnect() {
        // переподключаться некуда, ждём возвращения
        assert!(!changed("192.168.1.5", ""));
        assert!(!changed("", ""));
    }

    #[test]
    fn quiet_period_defers_the_change_until_it_settles() {
        let (fire, pending) = step("10.0.0.5", "10.0.0.9", true, None);
        assert!(!fire);
        assert_eq!(pending.as_deref(), Some("10.0.0.9"));
        // Адрес продержался: на выходе из тихого периода переподключаемся.
        let (fire, pending) = step("10.0.0.9", "10.0.0.9", false, pending.as_deref());
        assert!(fire);
        assert!(pending.is_none());
    }

    #[test]
    fn tunnel_transition_clears_the_deferred_change() {
        let (fire, pending) = step("10.0.0.9", TUN_ADDR_V4, false, Some("10.0.0.9"));
        assert!(!fire);
        assert!(pending.is_none());
    }

    #[test]
    fn change_outside_the_quiet_period_fires_at_once() {
        let (fire, pending) = step("10.0.0.5", "10.0.0.9", false, None);
        assert!(fire);
        assert!(pending.is_none());
    }

    #[test]
    fn same_address_without_pending_does_not_fire() {
        let (fire, pending) = step("10.0.0.9", "10.0.0.9", false, None);
        assert!(!fire);
        assert!(pending.is_none());
    }

    #[test]
    fn local_address_looks_like_an_address_or_empty() {
        let ip = local_ip();
        assert!(
            ip.is_empty() || ip.parse::<std::net::IpAddr>().is_ok(),
            "неожиданный адрес: {ip}"
        );
    }
}
