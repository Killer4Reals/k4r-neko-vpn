//! Checks how many servers a provider gives for a given X-HWID value.
//! cargo run --example fetch_hwid -- <sub-url> <hwid>
use k4r_neko_vpn_lib::subscription::{self, SubHeader};

fn main() {
    let mut a = std::env::args().skip(1);
    let url = a.next().expect("sub url");
    let hwid = a.next().unwrap_or_default();
    match subscription::fetch(
        &url,
        "K4R-Neko-VPN/0.1",
        &[SubHeader {
            name: "X-HWID".into(),
            value: hwid.clone(),
        }],
    ) {
        Ok(r) => println!(
            "hwid={hwid} -> {} профилей, warnings={:?}",
            r.profiles.len(),
            r.warnings
        ),
        Err(e) => println!("hwid={hwid} -> ошибка: {e}"),
    }
}
