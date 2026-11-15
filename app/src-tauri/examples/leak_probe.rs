// Проверка утечек DNS тем же путём, что и в приложении: спрашиваем
// whoami.akamai.net — он отвечает адресом резолвера, который его спросил.
use std::net::ToSocketAddrs;

fn main() {
    match ("whoami.akamai.net", 80u16).to_socket_addrs() {
        Ok(mut addrs) => match addrs.next() {
            Some(a) => println!("резолвер виден как: {}", a.ip()),
            None => println!("резолвер не ответил"),
        },
        Err(e) => println!("ошибка: {e}"),
    }
    match std::net::UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| s.connect("1.1.1.1:53").map(|_| s))
    {
        Ok(_) => println!("UDP до 1.1.1.1:53 доступен"),
        Err(e) => println!("UDP недоступен: {e}"),
    }
}
