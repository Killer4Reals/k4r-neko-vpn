use k4r_neko_vpn_lib::subscription::{self, SubHeader};

fn main() {
    let mut args = std::env::args().skip(1);
    let url = args.next().expect("нужен адрес подписки");
    let hwid = args.next().unwrap_or_default();
    let mut headers = Vec::new();
    if !hwid.is_empty() {
        headers.push(SubHeader { name: "X-HWID".into(), value: hwid });
    }
    match subscription::fetch(&url, "K4R-Neko-VPN/1.5.0", &headers) {
        Ok(r) => {
            println!("ok: серверов={} формат={} клиент={}", r.profiles.len(), r.format, r.ua_used);
            for w in r.warnings.iter().take(3) { println!("  ! {w}"); }
            println!("  срок/трафик: {} | название: {}", r.info.is_some(), !r.title.is_empty());
        }
        Err(e) => println!("ошибка: {e}"),
    }
}
