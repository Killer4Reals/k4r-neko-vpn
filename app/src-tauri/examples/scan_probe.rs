//! Sanity check for the split-tunneling source: which programs we can see.
fn main() {
    let apps = k4r_neko_vpn_lib::scan_installed();
    println!("found {} programs", apps.len());
    println!("running now: {}", apps.iter().filter(|a| a.running).count());
    for a in apps.iter().take(12) {
        println!("  {:<28} running={}", a.exe, a.running);
    }
}
