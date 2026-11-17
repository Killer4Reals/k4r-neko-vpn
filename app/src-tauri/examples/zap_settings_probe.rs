// Читаем настройки Zapret тем же кодом, что и приложение.
use k4r_neko_vpn_lib::zapret;

fn main() {
    let dir = zapret::detect_dir().expect("не нашёл папку Zapret");
    println!("папка: {}", dir.display());
    for (section, payload) in zapret::read_settings(&dir) {
        if section == "dns" || section == "telegram_proxy" {
            let v: serde_json::Value = serde_json::from_str(&payload).unwrap_or_default();
            println!(
                "{section}: {}",
                serde_json::to_string(&v).unwrap_or_default()
            );
        }
    }
}
