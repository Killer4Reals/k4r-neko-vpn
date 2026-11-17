// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Helper и аварийное снятие kill-switch живут в этом же exe: отдельный
    // бинарь пришлось бы бандлить и обновлять синхронно с приложением.
    if let Some(code) = k4r_neko_vpn_lib::wfp::handle_args() {
        std::process::exit(code);
    }
    k4r_neko_vpn_lib::run()
}
