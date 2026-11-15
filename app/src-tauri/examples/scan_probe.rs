//! Sanity check for the split-tunneling source: which programs we can see.
fn main() {
    let apps = k4r_neko_vpn_lib::scan_installed();
    println!("found {} programs", apps.len());
    println!("running now: {}", apps.iter().filter(|a| a.running).count());
    for a in apps.iter().take(25) {
        println!("  {:<28} | {:<32} | running={}", a.exe, a.name, a.running);
    }
    println!("--- with empty-ish names ---");
    for a in apps.iter().filter(|a| a.name.len() < 4).take(10) {
        println!("  {:<28} | {:<32}", a.exe, a.name);
    }
}
