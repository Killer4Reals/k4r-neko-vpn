//! Канал между приложением и helper'ом kill-switch.
//!
//! Named pipe, доступ только у SYSTEM, администраторов и владельца (создателя
//! pipe). После подключения сервер проверяет, что клиент действительно
//! повышен: иначе локальный процесс другого пользователя мог бы снять защиту.

use std::ffi::c_void;

use serde::{Deserialize, Serialize};
use windows_sys::Win32::Foundation::ERROR_PIPE_CONNECTED;
use windows_sys::Win32::Foundation::{
    CloseHandle, LocalFree, HANDLE, HLOCAL, INVALID_HANDLE_VALUE,
};
use windows_sys::Win32::Security::Authorization::ConvertStringSecurityDescriptorToSecurityDescriptorW;
use windows_sys::Win32::Security::{
    GetTokenInformation, TokenElevation, SECURITY_ATTRIBUTES, TOKEN_ELEVATION, TOKEN_QUERY,
};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, ReadFile, WriteFile, FILE_ATTRIBUTE_NORMAL, FILE_GENERIC_READ, FILE_GENERIC_WRITE,
    FILE_SHARE_NONE, OPEN_EXISTING,
};
use windows_sys::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, GetNamedPipeClientProcessId,
    WaitNamedPipeW, PIPE_READMODE_MESSAGE, PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_MESSAGE,
    PIPE_WAIT,
};
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
};

pub const PIPE_NAME: &str = r"\\.\pipe\k4r-neko-killswitch";
const PIPE_NAME_W: &[u16] = &[
    '\\' as u16,
    '\\' as u16,
    '.' as u16,
    '\\' as u16,
    'p' as u16,
    'i' as u16,
    'p' as u16,
    'e' as u16,
    '\\' as u16,
    'k' as u16,
    '4' as u16,
    'r' as u16,
    '-' as u16,
    'n' as u16,
    'e' as u16,
    'k' as u16,
    'o' as u16,
    '-' as u16,
    'k' as u16,
    'i' as u16,
    'l' as u16,
    'l' as u16,
    's' as u16,
    'w' as u16,
    'i' as u16,
    't' as u16,
    'c' as u16,
    'h' as u16,
    0,
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "cmd", rename_all = "lowercase")]
pub enum Request {
    /// Поставить/пересобрать защиту.
    Apply {
        /// Абсолютные пути движка (обновлённое ядро и/или бандл).
        #[serde(default)]
        engine: Vec<String>,
        #[serde(default)]
        resolver_v4: Option<String>,
        #[serde(default)]
        resolver_v6: Option<String>,
        #[serde(default)]
        dot: bool,
        #[serde(default)]
        doh_v4: Option<String>,
        #[serde(default)]
        doh_v6: Option<String>,
    },
    /// Снять защиту.
    Disable,
    /// Текущее состояние.
    Status,
    /// Снять защиту и выйти (путь для `--wfp-off`).
    Shutdown,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Response {
    pub ok: bool,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub tun: bool,
    #[serde(default)]
    pub filters: usize,
    #[serde(default)]
    pub message: String,
}

impl Response {
    pub fn err(message: impl Into<String>) -> Self {
        Self {
            ok: false,
            message: message.into(),
            ..Self::default()
        }
    }
}

/// SDDL: SYSTEM, встроенные администраторы и владелец — полный доступ.
/// Для всех остальных ACE нет, а пустой DACL по умолчанию запрещает доступ.
const SDDL: &str = "D:(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;OW)";

/// Поднимает сервер и обрабатывает запросы по одному.
///
/// `handler` вызывается в том же потоке: фильтры и состояние helper'а не нужно
/// защищать мьютексом от самого себя.
pub fn serve<F>(mut handler: F) -> std::io::Result<()>
where
    // Ответ и признак «пора выходить» (команда shutdown)
    F: FnMut(Request) -> (Response, bool),
{
    let mut sa = Security::new(SDDL)?;
    let pipe = unsafe {
        CreateNamedPipeW(
            PIPE_NAME_W.as_ptr(),
            // FIRST_PIPE_INSTANCE: второй helper рядом не поднимется
            windows_sys::Win32::Storage::FileSystem::PIPE_ACCESS_DUPLEX
                | windows_sys::Win32::Storage::FileSystem::FILE_FLAG_FIRST_PIPE_INSTANCE,
            PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
            1,
            64 * 1024,
            64 * 1024,
            0,
            sa.as_ptr(),
        )
    };
    if pipe == INVALID_HANDLE_VALUE {
        return Err(std::io::Error::last_os_error());
    }
    let pipe = Handle(pipe);
    loop {
        let connected = unsafe { ConnectNamedPipe(pipe.0, std::ptr::null_mut()) };
        let err = std::io::Error::last_os_error();
        let connected = connected != 0 || err.raw_os_error() == Some(ERROR_PIPE_CONNECTED as i32);
        if connected && client_is_elevated(pipe.0) {
            let request = read_line(pipe.0).and_then(|line| {
                serde_json::from_str::<Request>(&line)
                    .map_err(|e| std::io::Error::other(format!("не разобрал запрос: {e}")))
            });
            let (response, stop) = match request {
                Ok(req) => handler(req),
                Err(e) => (Response::err(e.to_string()), false),
            };
            let _ = write_line(
                pipe.0,
                &serde_json::to_string(&response).unwrap_or_default(),
            );
            if stop {
                return Ok(());
            }
        } else if connected {
            // Клиент без прав: пишем в журнал и рвём соединение, ничего не делая
            log_denied(pipe.0);
        }
        unsafe {
            DisconnectNamedPipe(pipe.0);
        }
    }
}

/// Клиент: отправить запрос и дождаться ответа.
pub fn ask(request: &Request) -> Result<Response, String> {
    let mut tries = 0;
    loop {
        match open_pipe() {
            Ok(handle) => {
                let text = serde_json::to_string(request).map_err(|e| e.to_string())?;
                write_line(handle.0, &text).map_err(|e| e.to_string())?;
                let line = read_line(handle.0).map_err(|e| e.to_string())?;
                return serde_json::from_str(&line).map_err(|e| format!("ответ не разобран: {e}"));
            }
            Err(e) => {
                // Helper мог ещё не создать pipe — ждём немного
                if tries >= 20 {
                    return Err(e);
                }
                tries += 1;
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        }
    }
}

/// Жив ли helper (отвечает на status).
pub fn alive() -> bool {
    ask(&Request::Status).is_ok()
}

fn open_pipe() -> Result<Handle, String> {
    let wide: Vec<u16> = PIPE_NAME.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        WaitNamedPipeW(wide.as_ptr(), 200);
        let h = CreateFileW(
            wide.as_ptr(),
            FILE_GENERIC_READ | FILE_GENERIC_WRITE,
            FILE_SHARE_NONE,
            std::ptr::null_mut(),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            std::ptr::null_mut(),
        );
        if h == INVALID_HANDLE_VALUE {
            return Err(format!(
                "helper не отвечает: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(Handle(h))
    }
}

/// Проверка клиента: только повышенный процесс может управлять защитой.
fn client_is_elevated(pipe: HANDLE) -> bool {
    unsafe {
        let mut pid = 0u32;
        if GetNamedPipeClientProcessId(pipe, &mut pid) == 0 {
            return false;
        }
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return false;
        }
        let process = Handle(process);
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(process.0, TOKEN_QUERY, &mut token) == 0 {
            return false;
        }
        let token = Handle(token);
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut size = 0u32;
        let ok = GetTokenInformation(
            token.0,
            TokenElevation,
            &mut elevation as *mut _ as *mut c_void,
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut size,
        );
        ok != 0 && elevation.TokenIsElevated != 0
    }
}

/// Отказ пишем в журнал helper'а (путь передаёт он сам через окружение).
fn log_denied(pipe: HANDLE) {
    unsafe {
        let mut pid = 0u32;
        if GetNamedPipeClientProcessId(pipe, &mut pid) == 0 {
            return;
        }
        let path = std::env::var("K4R_WFP_LOG").unwrap_or_default();
        if path.is_empty() {
            return;
        }
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
        {
            use std::io::Write;
            let _ = writeln!(
                f,
                "{stamp} kill-switch: отказано клиенту без прав администратора, pid {pid}"
            );
        }
    }
}

/// Защищает helper от убийства процессом того же пользователя без прав.
///
/// По умолчанию владелец процесса может его убить независимо от целостности
/// (taskkill не требует UAC). Для kill-switch это дыра: любая программа,
/// запущенная от пользователя, снимала бы защиту, просто убив helper. Ставим
/// на процесс DACL «только SYSTEM и администраторы» — тогда ограниченный токен
/// получает отказ, а администратор по-прежнему может снять защиту (`--wfp-off`).
pub fn harden_self() -> Result<(), String> {
    use windows_sys::Win32::Security::Authorization::{
        ConvertStringSecurityDescriptorToSecurityDescriptorW, SetSecurityInfo, SE_KERNEL_OBJECT,
    };
    use windows_sys::Win32::Security::{
        GetSecurityDescriptorDacl, ACL, DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR,
    };

    // GA — полный доступ; SY — SYSTEM, BA — администраторы.
    let sddl: Vec<u16> = "D:(A;;GA;;;SY)(A;;GA;;;BA)"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let mut sd: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
    // SAFETY: передаём валидную UTF-16 строку и получаем выделенный дескриптор,
    // который освобождаем LocalFree ниже.
    unsafe {
        let ok = ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            1, // SDDL_REVISION_1
            &mut sd,
            std::ptr::null_mut(),
        );
        if ok == 0 {
            return Err(format!(
                "не смог собрать DACL: {}",
                std::io::Error::last_os_error()
            ));
        }
        let mut dacl: *mut ACL = std::ptr::null_mut();
        let mut present = 0i32;
        let mut defaulted = 0i32;
        let got = GetSecurityDescriptorDacl(sd, &mut present, &mut dacl, &mut defaulted);
        if got == 0 || present == 0 {
            windows_sys::Win32::Foundation::LocalFree(sd as isize as *mut _);
            return Err("в дескрипторе нет DACL".into());
        }
        use windows_sys::Win32::System::Threading::GetCurrentProcess;
        let rc = SetSecurityInfo(
            GetCurrentProcess(),
            SE_KERNEL_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            dacl,
            std::ptr::null_mut(),
        );
        windows_sys::Win32::Foundation::LocalFree(sd as isize as *mut _);
        if rc != 0 {
            return Err(format!(
                "не смог поставить DACL на процесс: {}",
                std::io::Error::from_raw_os_error(rc as i32)
            ));
        }
    }
    Ok(())
}

pub fn current_is_elevated() -> bool {
    unsafe {
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return false;
        }
        let token = Handle(token);
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut size = 0u32;
        let ok = GetTokenInformation(
            token.0,
            TokenElevation,
            &mut elevation as *mut _ as *mut c_void,
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut size,
        );
        ok != 0 && elevation.TokenIsElevated != 0
    }
}

fn read_line(pipe: HANDLE) -> std::io::Result<String> {
    let mut out = Vec::new();
    let mut buf = [0u8; 4096];
    loop {
        let mut read = 0u32;
        let ok = unsafe {
            ReadFile(
                pipe,
                buf.as_mut_ptr(),
                buf.len() as u32,
                &mut read,
                std::ptr::null_mut(),
            )
        };
        if ok == 0 {
            let err = std::io::Error::last_os_error();
            // Конец сообщения приходит как ERROR_MORE_DATA/ERROR_BROKEN_PIPE
            if out.is_empty() {
                return Err(err);
            }
            break;
        }
        out.extend_from_slice(&buf[..read as usize]);
        if read < buf.len() as u32 {
            break;
        }
    }
    Ok(String::from_utf8_lossy(&out).to_string())
}

fn write_line(pipe: HANDLE, text: &str) -> std::io::Result<()> {
    let mut written = 0u32;
    let bytes = text.as_bytes();
    let ok = unsafe {
        WriteFile(
            pipe,
            bytes.as_ptr(),
            bytes.len() as u32,
            &mut written,
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

/// Владелец HANDLE: закрывает при выходе из области видимости.
struct Handle(HANDLE);

impl Drop for Handle {
    fn drop(&mut self) {
        if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

/// SECURITY_ATTRIBUTES с нашим DACL; освобождает дескриптор при выходе.
struct Security {
    sa: SECURITY_ATTRIBUTES,
    sd: *mut c_void,
}

impl Security {
    fn new(sddl: &str) -> std::io::Result<Self> {
        let wide: Vec<u16> = sddl.encode_utf16().chain(std::iter::once(0)).collect();
        let mut sd: *mut c_void = std::ptr::null_mut();
        let ok = unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                wide.as_ptr(),
                1, // SDDL_REVISION_1
                &mut sd,
                std::ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(Self {
            sa: SECURITY_ATTRIBUTES {
                nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: sd,
                bInheritHandle: 0,
            },
            sd,
        })
    }

    fn as_ptr(&mut self) -> *const SECURITY_ATTRIBUTES {
        &self.sa
    }
}

impl Drop for Security {
    fn drop(&mut self) {
        if !self.sd.is_null() {
            unsafe {
                LocalFree(self.sd as HLOCAL);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    /// Канал должен работать, а клиент без прав — отбиваться.
    /// Если тесты запущены из-под администратора, клиент проходит проверку.
    #[test]
    fn pipe_rejects_unprivileged_client() {
        let (started, ready) = mpsc::channel();
        std::thread::spawn(move || {
            let _ = serve(move |req| {
                let _ = started.send(());
                let response = match req {
                    Request::Status => Response {
                        ok: true,
                        active: true,
                        ..Response::default()
                    },
                    _ => Response {
                        ok: true,
                        ..Response::default()
                    },
                };
                (response, false)
            });
        });
        // ждём, пока сервер поднимет pipe
        let client = loop_ask();
        let elevated = current_is_elevated();
        if elevated {
            assert!(
                client.is_ok(),
                "повышенный клиент должен пройти: {client:?}"
            );
        } else {
            assert!(
                client.is_err(),
                "клиент без прав не должен управлять защитой"
            );
        }
        let _ = ready.recv_timeout(std::time::Duration::from_millis(10));
    }

    fn loop_ask() -> Result<Response, String> {
        let mut last = Err("нет попыток".to_string());
        for _ in 0..30 {
            last = ask(&Request::Status);
            if last.is_ok() {
                return last;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        last
    }
}
