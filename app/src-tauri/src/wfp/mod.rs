//! WFP kill-switch: план фильтров, helper-процесс, связь с ним и надзор.
//!
//! UI и основной процесс не трогают фильтры сами: они просят helper включить
//! или выключить защиту. Сессия helper'а динамическая, поэтому при его смерти
//! BFE снимает фильтры сам, а при смерти GUI защита остаётся на месте.

pub mod apply;
pub mod filters;
pub mod ipc;
pub mod tun;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use serde::Serialize;

use filters::{PlanOpts, TUN_ADDR_V4};
use ipc::{Request, Response};

/// Что показать в интерфейсе.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Off,
    On,
    Restarting,
    Lost,
    Unavailable,
}

#[derive(Clone, Debug, Serialize)]
pub struct Status {
    pub state: State,
    pub tun: bool,
    pub filters: usize,
    pub message: String,
}

impl Default for Status {
    fn default() -> Self {
        Self {
            state: State::Off,
            tun: false,
            filters: 0,
            message: String::new(),
        }
    }
}

/// Событие надзора: UI получает его и красит плашку.
#[derive(Clone, Debug)]
pub enum Event {
    Restarting,
    Restored,
    Lost(String),
}

static WANTED: AtomicBool = AtomicBool::new(false);
static OPTS: Mutex<Option<PlanOpts>> = Mutex::new(None);
static WATCHES: Mutex<usize> = Mutex::new(0);

/// Почему защита снята. Живёт до следующего включения: плашка «Защита снята
/// из-за сбоя helper'а» не должна молча превращаться в «выключено».
static LOST: Mutex<Option<String>> = Mutex::new(None);

pub fn lost_reason() -> Option<String> {
    LOST.lock().ok().and_then(|g| g.clone())
}

fn set_lost(reason: impl Into<String>) {
    if let Ok(mut g) = LOST.lock() {
        *g = Some(reason.into());
    }
}

fn clear_lost() {
    if let Ok(mut g) = LOST.lock() {
        *g = None;
    }
}

/// Разбор аргументов командной строки: helper и `--wfp-off` живут в том же exe.
pub fn handle_args() -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--wfp-helper") {
        return Some(helper_main());
    }
    if args.iter().any(|a| a == "--wfp-off") {
        return Some(off_main());
    }
    None
}

/// Включить защиту: поднять helper (если нужно) и применить план.
pub fn enable(opts: PlanOpts) -> Result<Status, String> {
    if let Ok(mut guard) = OPTS.lock() {
        *guard = Some(opts.clone());
    }
    WANTED.store(true, Ordering::SeqCst);
    clear_lost();
    match ask_apply(&opts) {
        Ok(response) => Ok(status_from(response)),
        Err(first) => {
            // Helper мог не быть запущен: пробуем поднять и повторить.
            spawn_helper()?;
            ask_apply(&opts)
                .map(status_from)
                .map_err(|e| format!("{first}; после запуска helper'а: {e}"))
        }
    }
}

/// Снять защиту.
pub fn disable() -> Result<(), String> {
    WANTED.store(false, Ordering::SeqCst);
    clear_lost();
    match ipc::ask(&Request::Disable) {
        Ok(r) if r.ok => Ok(()),
        Ok(r) => Err(r.message),
        // Helper уже не жив — dynamic-сессия снялась сама, блокировки нет.
        Err(_) => Ok(()),
    }
}

/// Текущее состояние. Если helper не отвечает, но защита была нужна — это Lost.
pub fn status() -> Status {
    let mut st = match ipc::ask(&Request::Status) {
        Ok(r) if r.ok => status_from(r),
        Ok(r) => Status {
            state: State::Unavailable,
            message: r.message,
            ..Status::default()
        },
        Err(e) => {
            if WANTED.load(Ordering::SeqCst) {
                Status {
                    state: State::Lost,
                    message: e,
                    ..Status::default()
                }
            } else {
                Status {
                    state: State::Off,
                    message: e,
                    ..Status::default()
                }
            }
        }
    };
    // Снятие из-за сбоя не маскируем под «выключено пользователем».
    if st.state == State::Off {
        if let Some(reason) = lost_reason() {
            st.state = State::Lost;
            st.message = reason;
        }
    }
    st
}

fn status_from(r: Response) -> Status {
    Status {
        state: if r.active { State::On } else { State::Off },
        tun: r.tun,
        filters: r.filters,
        message: r.message,
    }
}

fn ask_apply(opts: &PlanOpts) -> Result<Response, String> {
    let request = Request::Apply {
        engine: opts.engine_paths.clone(),
        resolver_v4: opts.resolver_v4.map(|ip| ip.to_string()),
        resolver_v6: opts.resolver_v6.map(|ip| ip.to_string()),
        dot: opts.dot,
        doh_v4: opts.doh_v4.map(|ip| ip.to_string()),
        doh_v6: opts.doh_v6.map(|ip| ip.to_string()),
    };
    ipc::ask(&request).and_then(|r| if r.ok { Ok(r) } else { Err(r.message) })
}

/// Мы внутри job-объекта? У job'ов с kill-on-close потомки умирают вместе с
/// родителем — для kill-switch это недопустимо.
#[cfg(windows)]
fn in_job_object() -> bool {
    use windows_sys::Win32::System::JobObjects::IsProcessInJob;
    use windows_sys::Win32::System::Threading::GetCurrentProcess;
    let mut yes = 0;
    // SAFETY: спрашиваем про текущий процесс, нулевой job — только чтение.
    unsafe {
        IsProcessInJob(
            GetCurrentProcess(),
            std::ptr::null_mut(),
            &mut yes,
        ) != 0
            && yes != 0
    }
}

/// Запускает helper. Права наследуются от приложения: движку TUN они и так нужны.
fn spawn_helper() -> Result<(), String> {
    if !ipc::current_is_elevated() {
        return Err("Kill-switch требует прав администратора".into());
    }
    let exe = std::env::current_exe().map_err(|e| format!("не нашёл свой exe: {e}"))?;
    let mut cmd = std::process::Command::new(exe);
    cmd.arg("--wfp-helper")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW | DETACHED_PROCESS: helper не должен держать консоль
        // и не должен умирать вместе с родителем.
        let mut flags = 0x0800_0000u32 | 0x0000_0008u32;
        // GUI мог оказаться в job-объекте с kill-on-close (терминал, CI,
        // песочница): тогда helper умер бы вместе с ним. Прорываемся, если job
        // это разрешает; иначе честно пишем в журнал, что fail-closed под угрозой.
        let in_job = in_job_object();
        if in_job {
            flags |= 0x0100_0000; // CREATE_BREAKAWAY_FROM_JOB
        }
        cmd.creation_flags(flags);
        apply::log_line(&format!(
            "helper: job-объект = {}, breakaway = {}",
            if in_job { "да" } else { "нет" },
            if in_job { "запрошен" } else { "не нужен" }
        ));
    }
    let child = cmd.spawn().map_err(|e| match e.raw_os_error() {
        // ERROR_ELEVATION_REQUIRED
        Some(740) => "Kill-switch требует прав администратора".to_string(),
        _ => format!("не смог запустить helper: {e}"),
    })?;
    apply::log_line(&format!("helper запущен, pid {}", child.id()));
    // Handle ребёнка не нужен: helper живёт сам, а надзор проверяет канал.
    std::mem::forget(child);
    Ok(())
}

/// Надзор за helper'ом: упал — поднимаем заново и применяем актуальный план.
///
/// `emit` вызывается из этого потока; UI подписан на событие и красит плашку.
pub fn supervise<F>(emit: F) -> Supervisor
where
    F: Fn(Event) + Send + 'static,
{
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    *WATCHES.lock().unwrap() += 1;
    let handle = std::thread::spawn(move || loop {
        // Спим секунду; канал нужен, чтобы остановиться без задержки.
        match rx.recv_timeout(std::time::Duration::from_secs(1)) {
            Ok(()) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
        }
        if !WANTED.load(Ordering::SeqCst) {
            continue;
        }
        if ipc::alive() {
            continue;
        }
        emit(Event::Restarting);
        let opts = OPTS.lock().ok().and_then(|g| g.clone());
        let Some(opts) = opts else { continue };
        let started = spawn_helper().and_then(|_| ask_apply(&opts).map(|_| ()));
        match started {
            Ok(()) => {
                apply::log_line("helper перезапущен, защита восстановлена");
                emit(Event::Restored);
            }
            Err(e) => {
                // Не смогли — честно снимаем защиту, чтобы человек не остался
                // без интернета с мыслью, что он защищён.
                WANTED.store(false, Ordering::SeqCst);
                // Причина — конкретная (UAC отклонён, spawn failed, нет доступа),
                // а не generic «сбой»: человеку нужно знать, что чинить.
                set_lost(format!("Защита снята: helper не перезапустился ({e}). Интернет открыт"));
                apply::log_line(&format!("CRITICAL helper не перезапустился: {e}"));
                emit(Event::Lost(e));
            }
        }
    });
    Supervisor {
        stop: tx,
        handle: Some(handle),
    }
}

pub struct Supervisor {
    stop: Sender<()>,
    handle: Option<JoinHandle<()>>,
}

impl Supervisor {
    pub fn stop(mut self) {
        self.shutdown();
    }

    fn shutdown(&mut self) {
        let _ = self.stop.send(());
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

impl Drop for Supervisor {
    fn drop(&mut self) {
        self.shutdown();
    }
}

// ---------------------------------------------------------------- helper ----

/// Процесс-хранитель: держит динамическую сессию и фильтры.
fn helper_main() -> i32 {
    if !ipc::current_is_elevated() {
        eprintln!("ELEVATION_REQUIRED: helper нужно запускать с правами администратора");
        return 2;
    }
    let pid_path = apply::pid_path();
    let _ = std::fs::write(&pid_path, std::process::id().to_string());
    apply::log_line("helper стартует");

    let keeper = match apply::Keeper::open() {
        Ok(k) => k,
        Err(e) => {
            apply::log_line(&format!("CRITICAL не смог открыть WFP: {e}"));
            eprintln!("{e}");
            return 3;
        }
    };
    let keeper = Arc::new(Mutex::new(Some(keeper)));

    // Watcher TUN: #6 добавляется через миллисекунды после появления адаптера.
    let keeper_watch = keeper.clone();
    let watch = tun::watch(TUN_ADDR_V4, move |info| {
        if let Ok(mut guard) = keeper_watch.lock() {
            if let Some(k) = guard.as_mut() {
                if let Err(e) = k.set_tun(info.map(|t| t.luid)) {
                    apply::log_line(&format!("не смог обновить правило #6: {e}"));
                }
            }
        }
    });

    let outcome = ipc::serve(move |request| {
        let mut guard = match keeper.lock() {
            Ok(g) => g,
            Err(_) => return (Response::err("состояние повреждено"), false),
        };
        match request {
            Request::Status => {
                let (blocks, permits) = guard.as_ref().map(|k| k.counts()).unwrap_or((0, 0));
                let r = Response {
                    ok: true,
                    active: guard.is_some(),
                    tun: guard.as_ref().map(|k| k.tun_known()).unwrap_or(false),
                    filters: blocks + permits,
                    message: String::new(),
                };
                (r, false)
            }
            Request::Apply {
                engine,
                resolver_v4,
                resolver_v6,
                dot,
                doh_v4,
                doh_v6,
            } => {
                if guard.is_none() {
                    *guard = match apply::Keeper::open() {
                        Ok(k) => Some(k),
                        Err(e) => return (Response::err(e), false),
                    };
                }
                let opts = PlanOpts {
                    engine_paths: engine,
                    resolver_v4: apply::parse_v4(&resolver_v4),
                    resolver_v6: apply::parse_v6(&resolver_v6),
                    dot,
                    doh_v4: apply::parse_v4(&doh_v4),
                    doh_v6: apply::parse_v6(&doh_v6),
                };
                match guard.as_mut().expect("только что открыт").apply(&opts) {
                    Ok(filters) => (
                        Response {
                            ok: true,
                            active: true,
                            filters,
                            ..Response::default()
                        },
                        false,
                    ),
                    Err(e) => (Response::err(e), false),
                }
            }
            Request::Disable => {
                if let Some(keeper) = guard.take() {
                    keeper.close();
                }
                apply::log_line("защита снята по команде");
                (
                    Response {
                        ok: true,
                        ..Response::default()
                    },
                    false,
                )
            }
            Request::Shutdown => {
                if let Some(keeper) = guard.take() {
                    keeper.close();
                }
                apply::log_line("helper выходит по команде shutdown");
                (
                    Response {
                        ok: true,
                        ..Response::default()
                    },
                    true,
                )
            }
        }
    });
    drop(watch);
    if let Err(e) = outcome {
        apply::log_line(&format!("CRITICAL сервер канала упал: {e}"));
        return 4;
    }
    0
}

/// `--wfp-off`: сначала просим helper выйти, если не вышло — снимаем процесс.
fn off_main() -> i32 {
    match ipc::ask(&Request::Shutdown) {
        Ok(r) if r.ok => {
            eprintln!("kill-switch снят через helper");
            return 0;
        }
        Ok(r) => eprintln!("helper ответил ошибкой: {}", r.message),
        Err(e) => eprintln!("helper не ответил: {e}"),
    }
    // Fallback: helper завис. Убиваем только свой процесс, по pid-файлу.
    let path = apply::pid_path();
    let pid = std::fs::read_to_string(&path)
        .ok()
        .and_then(|t| t.trim().parse::<u32>().ok());
    let Some(pid) = pid else {
        eprintln!("не нашёл pid helper'а — нечего завершать");
        return 1;
    };
    let killed = unsafe {
        use windows_sys::Win32::System::Threading::{
            OpenProcess, TerminateProcess, PROCESS_TERMINATE,
        };
        let handle = OpenProcess(PROCESS_TERMINATE, 0, pid);
        if handle.is_null() {
            false
        } else {
            let ok = TerminateProcess(handle, 1) != 0;
            windows_sys::Win32::Foundation::CloseHandle(handle);
            ok
        }
    };
    if killed {
        eprintln!("helper (pid {pid}) завершён, dynamic-сессия снята системой");
        0
    } else {
        eprintln!("не смог завершить helper (pid {pid}): нужны права администратора");
        1
    }
}
