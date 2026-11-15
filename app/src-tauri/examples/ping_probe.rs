// Проверка отметки «не отвечает»: живой сервер даёт число, мёртвый — None,
// и весь список проверяется за секунды, а не за полминуты.
use k4r_neko_vpn_lib::{probe, store};

fn main() {
    let dir = std::env::var("APPDATA").map(std::path::PathBuf::from).unwrap().join("ink.k4r.nekoneko.vpn");
    let mut profiles = store::load(&dir).profiles;
    // подмешиваем заведомо мёртвый адрес
    let mut dead = profiles[0].clone();
    dead.id = "dead-test".into();
    dead.host = "192.0.2.1".into(); // TEST-NET-1: не маршрутизируется
    profiles.push(dead);

    let began = std::time::Instant::now();
    let res = probe::ping_all(&profiles);
    let took = began.elapsed();
    for r in &res {
        println!("{} -> {:?}", r.id, r.ms);
    }
    let dead_ok = res.iter().any(|r| r.id == "dead-test" && r.ms.is_none());
    println!("мёртвый помечен как None: {dead_ok}");
    println!("время на {} серверов: {:?}", res.len(), took);
}
