fn main() {
    let dir = std::env::temp_dir().join("k4r-hwid-print");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    println!("derived: {}", k4r_neko_vpn_lib::store::install_id(&dir));
    println!("second:  {}", k4r_neko_vpn_lib::store::install_id(&dir));
    let _ = std::fs::remove_dir_all(&dir);
}
