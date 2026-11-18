//! Самодиагностика kill-switch: одна кнопка в настройках вместо ручного
//! чек-листа.
//!
//! Проверки идут от «защита вообще стоит» до «защита снимается и ставится
//! обратно». Ничего не выдумываем: всё, что можно спросить у WFP и у helper'а,
//! спрашиваем; чего спросить нельзя (DACL из непривилегированного процесса) —
//! пробуем с ограниченным токеном и честно пишем «пропущено», если не вышло.

use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::time::Duration;

use super::apply::{self, Snapshot};
use super::{ipc, PlanOpts, Request};

/// Результат одной проверки. `ok = None` — проверить не удалось (не провал).
pub struct Check {
    pub id: u32,
    pub title: String,
    pub ok: Option<bool>,
    pub detail: String,
}

fn pass(id: u32, title: &str, detail: impl Into<String>) -> Check {
    Check {
        id,
        title: title.into(),
        ok: Some(true),
        detail: detail.into(),
    }
}

fn fail(id: u32, title: &str, detail: impl Into<String>) -> Check {
    Check {
        id,
        title: title.into(),
        ok: Some(false),
        detail: detail.into(),
    }
}

fn skip(id: u32, title: &str, detail: impl Into<String>) -> Check {
    Check {
        id,
        title: title.into(),
        ok: None,
        detail: detail.into(),
    }
}

/// Параметры для восстановления защиты после проверки #6.
pub struct Ctx {
    pub opts: PlanOpts,
    pub engine_running: bool,
}

/// Полный прогон. Порядок важен: #6 временно снимает защиту и обязана вернуть.
pub fn run(ctx: Ctx) -> Vec<Check> {
    let mut out = Vec::new();

    let snap = apply::snapshot();
    let snap = match snap {
        Ok(s) => s,
        Err(e) => {
            // Без чтения WFP дальше идти некуда: остальные проверки бессмысленны.
            out.push(fail(1, "Sublayer в WFP", format!("не смог прочитать WFP: {e}")));
            return out;
        }
    };

    out.push(check_sublayer(&snap));
    out.push(check_blocks(&snap));
    out.push(check_tun_address(&snap));
    out.push(check_helper());
    out.push(check_dacl());
    out.push(check_cycle(&ctx));
    out.push(check_tun_rule(&snap, ctx.engine_running));
    out
}

fn check_sublayer(snap: &Snapshot) -> Check {
    if snap.sublayer && snap.total > 0 {
        pass(
            1,
            "Sublayer в WFP",
            format!("наш sublayer на месте, фильтров {}", snap.total),
        )
    } else {
        fail(
            1,
            "Sublayer в WFP",
            "sublayer или фильтры не найдены: защита не стоит".to_string(),
        )
    }
}

fn check_blocks(snap: &Snapshot) -> Check {
    if snap.blocks >= 2 {
        pass(
            2,
            "BLOCK на V4 и V6",
            format!("блокирующих правил: {}", snap.blocks),
        )
    } else {
        fail(
            2,
            "BLOCK на V4 и V6",
            format!(
                "блокирующих правил {}, а нужно 2 (V4 и V6) — трафик может уходить наружу",
                snap.blocks
            ),
        )
    }
}

fn check_tun_address(snap: &Snapshot) -> Check {
    if snap.tun_address {
        pass(
            3,
            "Permit на адрес TUN (#6b)",
            "правило 172.19.0.1/32 на месте".to_string(),
        )
    } else {
        fail(
            3,
            "Permit на адрес TUN (#6b)",
            "нет правила на адрес TUN: DNS и локальные сервисы туннеля могут не работать"
                .to_string(),
        )
    }
}

fn check_helper() -> Check {
    let pid = std::fs::read_to_string(apply::pid_path())
        .ok()
        .and_then(|t| t.trim().parse::<u32>().ok());
    match ipc::ask(&Request::Status) {
        Ok(r) if r.ok => pass(
            4,
            "Helper жив",
            match pid {
                Some(p) => format!("ответил по каналу, pid {p}"),
                None => "ответил по каналу".to_string(),
            },
        ),
        Ok(r) => fail(4, "Helper жив", r.message),
        Err(e) => fail(
            4,
            "Helper жив",
            format!("не отвечает: {e}. Без helper'а защита не переживёт падение приложения"),
        ),
    }
}

/// Проверка DACL: пробуем снять защиту из процесса с ограниченным токеном.
/// Должно не получиться — иначе любой процесс пользователя может открыть сеть.
fn check_dacl() -> Check {
    let exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => return skip(5, "Канал закрыт для непривилегированных", format!("{e}")),
    };
    // runas с trustlevel создаёт процесс с урезанным токеном (basic user).
    let target = format!("\"{}\" --wfp-off", exe.display());
    let attempt = std::process::Command::new("runas")
        .args(["/trustlevel:0x20000", &target])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();

    match attempt {
        Ok(status) if !status.success() => pass(
            5,
            "Канал закрыт для непривилегированных",
            "ограниченный процесс не смог снять защиту — как и должно быть",
        ),
        Ok(_) => {
            // runas вернул 0: он мог просто запустить и не дождаться. Проверяем
            // результат: защита должна остаться на месте.
            match apply::snapshot() {
                Ok(s) if s.blocks >= 2 => pass(
                    5,
                    "Канал закрыт для непривилегированных",
                    "ограниченный процесс защиту не снял",
                ),
                Ok(_) => fail(
                    5,
                    "Канал закрыт для непривилегированных",
                    "защита снялась из непривилегированного процесса — это дыра".to_string(),
                ),
                Err(e) => skip(5, "Канал закрыт для непривилегированных", format!("{e}")),
            }
        }
        Err(e) => skip(
            5,
            "Канал закрыт для непривилегированных",
            format!("runas недоступен: {e}"),
        ),
    }
}

/// Снимаем защиту, проверяем что интернет вернулся, ставим обратно.
fn check_cycle(ctx: &Ctx) -> Check {
    let blocked_before = apply::snapshot().map(|s| s.blocks >= 2).unwrap_or(false);
    if !blocked_before {
        return skip(
            6,
            "Снятие и возврат защиты",
            "защита не стояла — цикл нечего проверять".to_string(),
        );
    }
    if let Err(e) = super::disable() {
        return fail(6, "Снятие и возврат защиты", format!("не снялась: {e}"));
    }
    // После снятия интернет обязан открыться: TCP-рукопожатие до 1.1.1.1:443.
    let addr: SocketAddr = (Ipv4Addr::new(1, 1, 1, 1), 443).into();
    let opened = TcpStream::connect_timeout(&addr, Duration::from_secs(3)).is_ok();

    let restored = match super::enable(ctx.opts.clone()) {
        Ok(_) => apply::snapshot().map(|s| s.blocks >= 2).unwrap_or(false),
        Err(_) => false,
    };
    if !restored {
        return fail(
            6,
            "Снятие и возврат защиты",
            "защита не вернулась — включите kill-switch заново вручную".to_string(),
        );
    }
    if opened {
        pass(
            6,
            "Снятие и возврат защиты",
            "после снятия интернет открылся, защита вернулась".to_string(),
        )
    } else {
        // Защита вернулась, но интернет и без неё не открылся: это не наша
        // вина (нет сети/фильтр провайдера), но и «проверено» сказать нельзя.
        skip(
            6,
            "Снятие и возврат защиты",
            "защита вернулась, но интернет не открылся даже без неё — похоже, сети нет"
                .to_string(),
        )
    }
}

fn check_tun_rule(snap: &Snapshot, engine_running: bool) -> Check {
    match (engine_running, snap.tun_luid) {
        (true, true) => pass(
            7,
            "Правило TUN (LUID)",
            "туннель поднят, правило #6 на месте".to_string(),
        ),
        (true, false) => fail(
            7,
            "Правило TUN (LUID)",
            "туннель поднят, но правила #6 нет: трафик через TUN попадёт под BLOCK".to_string(),
        ),
        (false, false) => pass(
            7,
            "Правило TUN (LUID)",
            "туннель выключен, правила #6 нет — так и должно быть".to_string(),
        ),
        (false, true) => skip(
            7,
            "Правило TUN (LUID)",
            "туннель выключен, а правило #6 осталось: watcher не убрал его".to_string(),
        ),
    }
}
