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

/// Узлы для фонового пула, когда окно ещё не нарисовало список: выбранный
/// первым, дальше основные, и только если их не хватило — резервные. Порядок
/// повторяет `smartPool` на фронтенде, чтобы фон и окно строили один пул.
pub fn pool_indices(reserve: &[bool], chosen: usize, limit: usize) -> Vec<usize> {
    if chosen >= reserve.len() || limit == 0 {
        return Vec::new();
    }
    let mut out = vec![chosen];
    for (i, is_reserve) in reserve.iter().enumerate() {
        if i != chosen && !*is_reserve && out.len() < limit {
            out.push(i);
        }
    }
    for (i, is_reserve) in reserve.iter().enumerate() {
        if i != chosen && *is_reserve && out.len() < limit {
            out.push(i);
        }
    }
    out
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
    fn background_pool_prefers_main_nodes_and_falls_back_to_reserve() {
        assert_eq!(
            pool_indices(&[false, false, true, false], 0, 3),
            vec![0, 1, 3]
        );
        assert_eq!(pool_indices(&[false, true], 0, 3), vec![0, 1]);
        assert_eq!(pool_indices(&[true, true], 1, 3), vec![1, 0]);
        assert_eq!(pool_indices(&[false, false], 0, 1), vec![0]);
        assert!(pool_indices(&[false], 3, 3).is_empty());
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
