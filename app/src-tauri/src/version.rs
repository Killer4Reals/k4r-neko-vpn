//! Сравнение версий для автообновления.
//!
//! Строковое сравнение тут не работает: «1.29.0» < «1.9.0», если сравнивать как
//! текст, — и приложение предложило бы откатиться на старую сборку. Поэтому
//! версия разбирается на числа, недостающие части считаются нулями, а хвост
//! после `-`/`+` (предрелиз, код сборки) на сравнение не влияет.
//!
//! Ровно те же правила реализованы в Android (`data/Update.kt`): обе платформы
//! должны одинаково понимать, что «новее».

/// Числовые части версии: `v1.29.0+5` → [1, 29, 0].
pub fn parts(text: &str) -> Vec<i64> {
    let core = text
        .trim()
        .trim_start_matches('v')
        .trim_start_matches('V')
        .split(['-', '+', ' '])
        .next()
        .unwrap_or("");
    if core.is_empty() {
        return Vec::new();
    }
    core.split('.')
        .map(|p| p.trim().parse::<i64>().unwrap_or(-1))
        .collect()
}

/// -1 / 0 / 1. Неразборчивая версия считается младше: лучше лишний раз
/// предложить обновление, чем пропустить его навсегда.
pub fn cmp(a: &str, b: &str) -> i32 {
    let left = parts(a);
    let right = parts(b);
    if left.is_empty() || right.is_empty() {
        return match (left.is_empty(), right.is_empty()) {
            (true, true) => 0,
            (true, false) => -1,
            _ => 1,
        };
    }
    let size = left.len().max(right.len());
    for i in 0..size {
        let x = *left.get(i).unwrap_or(&0);
        let y = *right.get(i).unwrap_or(&0);
        if x != y {
            return if x > y { 1 } else { -1 };
        }
    }
    0
}

/// Строго новее ли `remote` установленной `local`.
pub fn is_newer(remote: &str, local: &str) -> bool {
    cmp(remote, local) > 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patch_wins_over_lexicographic_order() {
        // главная причина, зачем этот модуль вообще нужен
        assert!(is_newer("1.29.0", "1.9.0"));
        assert!(!is_newer("1.9.0", "1.29.0"));
    }

    #[test]
    fn equal_versions_in_different_forms() {
        assert_eq!(cmp("1.29", "1.29.0"), 0);
        assert_eq!(cmp("v1.29.0", "1.29.0"), 0);
        assert_eq!(cmp("1.29.0+5", "1.29.0"), 0);
    }

    #[test]
    fn older_manifest_is_not_an_update() {
        // откатывать человека на старую сборку нельзя
        assert!(!is_newer("1.28.0", "1.29.0"));
        assert!(!is_newer("1.29.0", "1.29.0"));
    }

    #[test]
    fn next_patch_is_an_update() {
        assert!(is_newer("1.29.1", "1.29.0"));
        assert!(is_newer("1.30.0", "1.29.9"));
    }

    #[test]
    fn garbage_version_is_treated_as_older() {
        assert!(!is_newer("", "1.29.0"));
        assert!(!is_newer("nightly", "1.29.0"));
        assert!(is_newer("1.29.0", "nightly"));
    }
}
