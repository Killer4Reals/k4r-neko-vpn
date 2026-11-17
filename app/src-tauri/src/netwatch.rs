//! Сторож сети для ПК: заметить, что сменился адрес выхода (Wi-Fi → кабель,
//! другой Wi-Fi, подняли после сна), и переподнять туннель.
//!
//! Почему опрос, а не события Windows: события требуют COM-интерфейсов и новых
//! зависимостей, а смена маршрута по умолчанию меняет локальный адрес, которым
//! ОС собирается идти наружу. Он и есть наш признак. Раз в пять секунд — это
//! ноль нагрузки и никакой магии.

use std::net::UdpSocket;
use std::time::{Duration, Instant};

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
/// уже мёртв.
pub fn changed(previous: &str, current: &str) -> bool {
    !current.is_empty() && previous != current
}

/// Крутится всё время работы приложения. `on_switch` вызывается, когда сеть
/// сменилась и туннель был поднят — решать, что делать, ему.
pub fn watch<F>(mut on_switch: F)
where
    F: FnMut() + Send + 'static,
{
    std::thread::spawn(move || {
        let mut previous = local_ip();
        // после перезапуска даём туннелю встать, иначе один и тот же сбой
        // сети вызовет лавину перезапусков
        let mut quiet_until = Instant::now();
        loop {
            std::thread::sleep(Duration::from_secs(5));
            let current = local_ip();
            if changed(&previous, &current) && Instant::now() >= quiet_until {
                previous = current;
                quiet_until = Instant::now() + Duration::from_secs(20);
                on_switch();
            } else {
                previous = current;
            }
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
    fn local_address_looks_like_an_address_or_empty() {
        let ip = local_ip();
        assert!(
            ip.is_empty() || ip.parse::<std::net::IpAddr>().is_ok(),
            "неожиданный адрес: {ip}"
        );
    }
}
