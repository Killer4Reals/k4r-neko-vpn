//! Один экземпляр приложения.
//!
//! Две копии клиента — это два ядра sing-box на одном имени туннеля, два значка
//! в трее и две записи настроек, которые затирают друг друга. Человек этого не
//! хочет; он просто дважды нажал на ярлык.
//!
//! Сторожевого объекта в системе без новых зависимостей нет, зато есть обычный
//! сокет: занятый порт на loopback держится столько, сколько жив процесс. Значит,
//! «порт занят и на нём отвечают наши» = «приложение уже запущено».
//!
//! Порядок важен: сначала пробуем занять порт, и только если он занят — стучимся
//! к соседу. Если порт занят кем-то посторонним, приложение всё равно запустится:
//! отказ стартовать из-за чужой программы был бы хуже двух окон.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;

/// Порт-сторож. Менять нельзя: старые и новые копии должны узнавать друг друга.
pub const PORT: u16 = 39_311;

/// Слово, по которому узнаём своего: чужой сервис на том же порту его не скажет.
const MAGIC: &str = "K4R-NEKO-VPN/1 SHOW\n";

/// Держит порт занятым всё время жизни приложения.
pub struct Single {
    _listener: TcpListener,
}

/// Занять порт. `None` значит, что приложение уже запущено.
pub fn acquire(port: u16) -> Option<Single> {
    let listener = TcpListener::bind(("127.0.0.1", port)).ok()?;
    Some(Single { _listener: listener })
}

/// Попросить уже запущенную копию показать окно.
/// `true` — сосед ответил по-нашему, значит это правда наше приложение.
pub fn wake_existing(port: u16) -> bool {
    let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) else {
        return false;
    };
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
    stream.write_all(MAGIC.as_bytes()).is_ok()
}

/// Ждать просьб «покажи окно» и отдавать их наверх.
/// Поток живёт всё время работы приложения и молча умирает вместе с ним.
pub fn serve(single: Single, on_wake: impl Fn() + Send + 'static) {
    std::thread::spawn(move || {
        for stream in single._listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
            let mut buf = [0u8; 64];
            let read = stream.read(&mut buf).unwrap_or(0);
            if read > 0 && buf[..read].starts_with(b"K4R-NEKO-VPN/1 SHOW") {
                on_wake();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    #[test]
    fn второй_экземпляр_не_занимает_порт() {
        let first = acquire(PORT + 1).expect("первый должен занять порт");
        assert!(acquire(PORT + 1).is_none(), "второй обязан получить отказ");
        drop(first);
        // после освобождения порт снова свободен: приложение закрыли — можно запускать
        assert!(acquire(PORT + 1).is_some());
    }

    #[test]
    fn сосед_получает_просьбу_показать_окно() {
        let single = acquire(PORT + 2).expect("порт свободен");
        let hits = Arc::new(AtomicUsize::new(0));
        let counter = hits.clone();
        serve(single, move || {
            counter.fetch_add(1, Ordering::SeqCst);
        });
        // даём потоку встать в accept
        std::thread::sleep(Duration::from_millis(150));
        assert!(wake_existing(PORT + 2), "сосед должен ответить");
        std::thread::sleep(Duration::from_millis(250));
        assert_eq!(hits.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn чужой_ответ_не_считается_своим() {
        let single = acquire(PORT + 3).expect("порт свободен");
        let hits = Arc::new(AtomicUsize::new(0));
        let counter = hits.clone();
        serve(single, move || {
            counter.fetch_add(1, Ordering::SeqCst);
        });
        std::thread::sleep(Duration::from_millis(150));
        let mut stream = TcpStream::connect(("127.0.0.1", PORT + 3)).unwrap();
        stream.write_all(b"GET / HTTP/1.0\r\n\r\n").unwrap();
        std::thread::sleep(Duration::from_millis(250));
        assert_eq!(hits.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn свободный_порт_не_пугает_ошибкой() {
        // никто не слушает — будить некого, и это не повод падать
        assert!(!wake_existing(PORT + 4));
        assert!(acquire(PORT + 4).is_some());
    }
}
