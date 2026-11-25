//! Поиск нашего TUN-адаптера и слежение за его появлением/исчезновением.
//!
//! Основной механизм — `NotifyIpInterfaceChange`: ОС сама будит нас за
//! миллисекунды. Если регистрация не удалась (бывает на урезанных сборках),
//! откатываемся на опрос `GetAdaptersAddresses` раз в 100 мс.

use std::net::{Ipv4Addr, Ipv6Addr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use windows_sys::Win32::Foundation::NO_ERROR;
use windows_sys::Win32::NetworkManagement::IpHelper::{
    CancelMibChangeNotify2, GetAdaptersAddresses, NotifyIpInterfaceChange, GAA_FLAG_INCLUDE_PREFIX,
    GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_DNS_SERVER, GAA_FLAG_SKIP_MULTICAST,
    IP_ADAPTER_ADDRESSES_LH,
};
use windows_sys::Win32::NetworkManagement::Ndis::NET_LUID_LH;
use windows_sys::Win32::Networking::WinSock::{AF_INET, AF_UNSPEC};

/// Найденный адаптер: LUID и адрес.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TunInfo {
    pub luid: u64,
    pub addr: Ipv4Addr,
}

/// Ищем адаптер, которому принадлежит адрес TUN.
///
/// Сначала по адресу (надёжно: адрес задаём мы сами), затем, если адрес ещё не
/// назначен, — по имени адаптера, которое даёт sing-box.
pub fn find_tun(addr: Ipv4Addr) -> Option<TunInfo> {
    let adapters = list_adapters()?;
    for a in &adapters {
        if a.addresses.contains(&addr) {
            return Some(TunInfo { luid: a.luid, addr });
        }
    }
    // По имени не ищем: на машине могли остаться старые адаптеры wintun от
    // прошлых установок, и такой «находкой» мы бы разрешили чужой интерфейс.
    None
}

struct Adapter {
    luid: u64,
    addresses: Vec<Ipv4Addr>,
}

fn list_adapters() -> Option<Vec<Adapter>> {
    let flags = GAA_FLAG_SKIP_ANYCAST
        | GAA_FLAG_SKIP_MULTICAST
        | GAA_FLAG_SKIP_DNS_SERVER
        | GAA_FLAG_INCLUDE_PREFIX;
    let mut size: u32 = 16 * 1024;
    for _ in 0..3 {
        let mut buf = vec![0u8; size as usize];
        let rc = unsafe {
            GetAdaptersAddresses(
                AF_UNSPEC as u32,
                flags,
                std::ptr::null_mut(),
                buf.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH,
                &mut size,
            )
        };
        if rc == ERROR_BUFFER_OVERFLOW {
            continue;
        }
        if rc != NO_ERROR {
            return None;
        }
        return Some(unsafe { parse_adapters(buf.as_ptr() as *const IP_ADAPTER_ADDRESSES_LH) });
    }
    None
}

const ERROR_BUFFER_OVERFLOW: u32 = 111;

unsafe fn parse_adapters(mut cur: *const IP_ADAPTER_ADDRESSES_LH) -> Vec<Adapter> {
    let mut out = Vec::new();
    while !cur.is_null() {
        let a = &*cur;
        let luid: NET_LUID_LH = a.Luid;
        let mut addresses = Vec::new();
        let mut ua = a.FirstUnicastAddress;
        while !ua.is_null() {
            let sockaddr = (*ua).Address.lpSockaddr;
            if !sockaddr.is_null() && (*sockaddr).sa_family == AF_INET {
                let v4 =
                    &*(sockaddr as *const windows_sys::Win32::Networking::WinSock::SOCKADDR_IN);
                addresses.push(Ipv4Addr::from(v4.sin_addr.S_un.S_addr.to_ne_bytes()));
            }
            ua = (*ua).Next;
        }
        out.push(Adapter {
            luid: unsafe { luid.Value },
            addresses,
        });
        cur = a.Next;
    }
    out
}

/// Слежение за TUN. Колбэк вызывается при появлении (Some) и исчезновении
/// (None) адаптера — и только при изменении состояния, не на каждый пинг ОС.
pub struct Watch {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl Watch {
    pub fn stop(mut self) {
        self.shutdown();
    }

    fn shutdown(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        // Будим поток: без Notify он спит на recv_timeout, с Notify — на recv,
        // поэтому посылаем пустое событие через общий канал.
        wake();
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

impl Drop for Watch {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Канал пробуждения из колбэка ОС: один watcher на процесс, этого достаточно.
static WAKE: Mutex<Option<mpsc::Sender<()>>> = Mutex::new(None);

fn wake() {
    if let Ok(guard) = WAKE.lock() {
        if let Some(tx) = guard.as_ref() {
            let _ = tx.send(());
        }
    }
}

pub fn watch<F>(addr: Ipv4Addr, on_change: F) -> Watch
where
    F: Fn(Option<TunInfo>) + Send + 'static,
{
    let stop = Arc::new(AtomicBool::new(false));
    let stop_thread = stop.clone();
    let handle = std::thread::spawn(move || {
        let (tx, rx) = mpsc::channel::<()>();
        if let Ok(mut guard) = WAKE.lock() {
            *guard = Some(tx);
        }

        // Основной путь: событийная подписка ОС
        let mut notify = NotifyHandle::default();
        let event_driven = notify.subscribe();

        // None = «ещё не сообщали»; Some(None) = сообщили «TUN нет»
        let mut last: Option<Option<u64>> = None;
        loop {
            if stop_thread.load(Ordering::SeqCst) {
                break;
            }
            let found = find_tun(addr);
            let now = Some(found.map(|t| t.luid));
            if now != last {
                on_change(found);
                last = now;
            }
            if event_driven {
                // Ждём события ОС; таймаут — только чтобы не залипнуть навсегда
                let _ = rx.recv_timeout(Duration::from_secs(5));
            } else {
                let _ = rx.recv_timeout(Duration::from_millis(100));
            }
        }
        notify.cancel();
    });
    Watch {
        stop,
        handle: Some(handle),
    }
}

/// Владелец подписки на изменения интерфейсов.
#[derive(Default)]
struct NotifyHandle {
    handle: *mut std::ffi::c_void,
}

impl NotifyHandle {
    /// true — событийная подписка работает.
    fn subscribe(&mut self) -> bool {
        let mut handle: *mut std::ffi::c_void = std::ptr::null_mut();
        let rc = unsafe {
            NotifyIpInterfaceChange(
                AF_UNSPEC,
                Some(on_interface_change),
                std::ptr::null(),
                false,
                &mut handle,
            )
        };
        if rc == NO_ERROR && !handle.is_null() {
            self.handle = handle;
            true
        } else {
            false
        }
    }

    fn cancel(&mut self) {
        if !self.handle.is_null() {
            unsafe {
                CancelMibChangeNotify2(self.handle);
            }
            self.handle = std::ptr::null_mut();
        }
    }
}

impl Drop for NotifyHandle {
    fn drop(&mut self) {
        self.cancel();
    }
}

unsafe extern "system" fn on_interface_change(
    _context: *const std::ffi::c_void,
    _row: *const windows_sys::Win32::NetworkManagement::IpHelper::MIB_IPINTERFACE_ROW,
    _notification_type: windows_sys::Win32::NetworkManagement::IpHelper::MIB_NOTIFICATION_TYPE,
) {
    wake();
}

/// Приведение IPv6-адреса к строке — для журнала.
pub fn ipv6_text(ip: &Ipv6Addr) -> String {
    ip.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// На машине без TUN поиск обязан честно вернуть None, а не выдумать адаптер.
    #[test]
    fn missing_tun_is_none() {
        let info = find_tun(Ipv4Addr::new(203, 0, 113, 77));
        assert!(info.is_none(), "несуществующий адрес не должен находиться");
    }

    /// watcher обязан сразу сообщить текущее состояние, даже если TUN нет.
    #[test]
    fn watcher_reports_initial_state_and_stops() {
        let (tx, rx) = mpsc::channel();
        let w = watch(Ipv4Addr::new(203, 0, 113, 77), move |info| {
            let _ = tx.send(info.map(|t| t.luid));
        });
        let first = rx.recv_timeout(Duration::from_secs(2));
        assert!(
            matches!(first, Ok(None)),
            "первое событие — текущее состояние"
        );
        w.stop();
    }
}
