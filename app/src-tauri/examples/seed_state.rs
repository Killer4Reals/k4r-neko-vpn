//! Puts a real subscription into the app state so the GUI has servers to test with.
//! Usage: cargo run --example seed_state -- <sub-url>
use k4r_neko_vpn_lib::store::{self, SubSource};
use k4r_neko_vpn_lib::subscription::{self, SubHeader};
use std::path::PathBuf;

fn data_dir() -> PathBuf {
    PathBuf::from(std::env::var("APPDATA").expect("APPDATA")).join("ink.k4r.nekoneko.vpn")
}

fn main() {
    let url = std::env::args().nth(1).expect("sub url");
    let dir = data_dir();
    let mut st = store::load(&dir);
    // optional: reuse the device slot that already exists at the provider
    let forced = std::env::args().nth(2).unwrap_or_default();
    let hwid = if !forced.is_empty() {
        forced
    } else if st.hwid.is_empty() {
        store::install_id(&dir)
    } else {
        st.hwid.clone()
    };
    st.hwid = hwid.clone();
    println!("hwid={hwid}");

    match subscription::fetch(
        &url,
        "K4R-Neko-VPN/0.1",
        &[SubHeader { name: "X-HWID".into(), value: hwid.clone() }],
    ) {
        Ok(res) => {
            println!("ok: {} servers, format={}", res.profiles.len(), res.format);
            for w in &res.warnings {
                println!("  warning: {w}");
            }
            st.subs = vec![SubSource {
                url: url.clone(),
                ua: "K4R-Neko-VPN/0.1".into(),
                name: "axivpn".into(),
                refreshed: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0),
                info: None,
            }];
            st.sub_url = url;
            st.sub_ua = "K4R-Neko-VPN/0.1".into();
            st.profiles = res.profiles;
            if let Some(first) = st.profiles.first() {
                st.selected = first.id.clone();
            }
            st.schema = 1;
            store::save(&dir, &st).unwrap();
            println!("saved to {}", dir.display());
        }
        Err(e) => {
            println!("FAILED: {e}");
            std::process::exit(1);
        }
    }
}
