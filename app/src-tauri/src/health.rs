//! Сторож качества: если туннель «поднят», а данные через него не идут —
//! сервер не умер, а испортился (перегружен, заблокирован по пути). Такой
//! случай перебор при запуске не поймает, поэтому смотрим уже после.

use std::time::Duration;

/// Сколько неудач подряд считаем деградацией. Три — чтобы одна заминка на
/// секунду не дёргала переключение.
pub const FAILS_TO_SWITCH: u8 = 3;

/// Пауза между проверками. Пятнадцать секунд — это ~4 запроса в минуту, что
/// для чужого сервера вежливо, а для нас достаточно быстро.
pub const CHECK_EVERY: Duration = Duration::from_secs(15);

/// После переключения даём новому серверу время: иначе одна и та же заминка
/// переберёт все серверы за минуту.
pub const AFTER_SWITCH: Duration = Duration::from_secs(60);

/// Какой сервер пробовать следующим. `skip` — сколько уже перебрали, чтобы не
/// возвращаться в тот же самый.
pub fn next_index(current: usize, len: usize, skip: usize) -> Option<usize> {
    if len == 0 {
        return None;
    }
    let idx = (current + 1 + skip) % len;
    if idx == current && len == 1 {
        return None;
    }
    Some(idx)
}

/// Идут ли данные через туннель. Спрашиваем адрес без DNS: мёртвый резолвер
/// не должен превращаться в «сервер плохой».
pub fn healthy() -> bool {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(6)))
        .user_agent("K4R-Neko-VPN/health")
        .build()
        .into();
    match agent.get("http://1.1.1.1/cdn-cgi/trace").call() {
        Ok(resp) => resp.into_body().read_to_string().is_ok(),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn next_server_moves_forward_and_wraps() {
        assert_eq!(next_index(0, 3, 0), Some(1));
        assert_eq!(next_index(2, 3, 0), Some(0));
        assert_eq!(next_index(1, 3, 2), Some(1));
    }

    #[test]
    fn with_a_single_server_there_is_nowhere_to_switch() {
        assert_eq!(next_index(0, 1, 0), None);
        assert_eq!(next_index(0, 0, 0), None);
    }

    #[test]
    fn skip_moves_past_servers_we_already_tried() {
        // первый перебор: 1, следующий: 2, потом снова 0
        let mut tried = Vec::new();
        for skip in 0..3 {
            tried.push(next_index(0, 3, skip).unwrap());
        }
        assert_eq!(tried, vec![1, 2, 0]);
    }
}
