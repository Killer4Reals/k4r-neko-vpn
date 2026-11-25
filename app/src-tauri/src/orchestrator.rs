//! Оркестратор: помнит, какие серверы (точнее — пары «сервер + транспорт»)
//! реально работают, и не даёт приложению снова и снова выбирать мёртвый.
//!
//! Идея счётчиков успехов и карантина (strategy-lock-manager + silent-drop-detector), но
//! применяется к нашей задаче: у нас нет десятка DPI-трюков, зато есть
//! несколько серверов и транспортов, из которых надо выбирать.
//!
//! Учёт ведётся только локально: файл `orchestrator.json` в данных приложения.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Сколько держим сервер в карантине после серии провалов.
pub const QUARANTINE_SECS: i64 = 600;

/// Сколько провалов подряд отправляют сервер в карантин.
pub const FAILS_TO_QUARANTINE: u32 = 3;

const FILE: &str = "orchestrator.json";

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
pub struct Entry {
    #[serde(default)]
    pub ok: u32,
    #[serde(default)]
    pub fail: u32,
    #[serde(default)]
    pub latency_ms: u32,
    #[serde(default)]
    pub quarantine_until: i64,
}

#[derive(Serialize, Deserialize, Default, Debug)]
pub struct Book {
    #[serde(default)]
    pub entries: BTreeMap<String, Entry>,
}

/// Строка для интерфейса: то же, что в файле, но с готовым счётом.
#[derive(Serialize, Debug)]
pub struct Row {
    pub key: String,
    pub ok: u32,
    pub fail: u32,
    pub latency_ms: u32,
    pub score: f64,
    pub quarantined: bool,
}

fn path(dir: &Path) -> PathBuf {
    dir.join(FILE)
}

pub fn load(dir: &Path) -> Book {
    std::fs::read_to_string(path(dir))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn save(dir: &Path, book: &Book) {
    if let Ok(text) = serde_json::to_string_pretty(book) {
        let _ = std::fs::write(path(dir), text);
    }
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Доля успехов со сглаживанием (правило Лапласа: без данных — 50%), умноженная
/// на поправку за задержку. Мёртвый сервер быстро уходит вниз, но один сбой не
/// выкидывает его из игры.
pub fn score(entry: &Entry) -> f64 {
    let ok = entry.ok as f64;
    let fail = entry.fail as f64;
    let rate = (ok + 1.0) / (ok + fail + 2.0);
    let latency = entry.latency_ms as f64;
    rate * (1000.0 / (1000.0 + latency))
}

pub fn rows(book: &Book) -> Vec<Row> {
    let at = now();
    let mut list: Vec<Row> = book
        .entries
        .iter()
        .map(|(key, e)| Row {
            key: key.clone(),
            ok: e.ok,
            fail: e.fail,
            latency_ms: e.latency_ms,
            score: score(e),
            quarantined: e.quarantine_until > at,
        })
        .collect();
    list.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    list
}

/// Записать результат. `latency_ms = 0` — задержка неизвестна.
pub fn record(dir: &Path, key: &str, success: bool, latency_ms: u32) -> Vec<Row> {
    let mut book = load(dir);
    let at = now();
    let entry = book.entries.entry(key.to_string()).or_default();
    if success {
        entry.ok = entry.ok.saturating_add(1);
        entry.fail = 0;
        entry.quarantine_until = 0;
        if latency_ms > 0 {
            // Скользящее среднее: новые замеры важнее старых, но резко не скачут.
            entry.latency_ms = if entry.latency_ms == 0 {
                latency_ms
            } else {
                ((entry.latency_ms as u64 * 3 + latency_ms as u64) / 4) as u32
            };
        }
    } else {
        entry.fail = entry.fail.saturating_add(1);
        if entry.fail >= FAILS_TO_QUARANTINE {
            entry.quarantine_until = at + QUARANTINE_SECS;
        }
    }
    save(dir, &book);
    rows(&book)
}

pub fn reset(dir: &Path) -> Vec<Row> {
    let book = Book::default();
    save(dir, &book);
    rows(&book)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_entry_is_neutral() {
        let e = Entry::default();
        assert!((score(&e) - 0.5).abs() < 0.0001);
    }

    #[test]
    fn success_beats_failures() {
        let good = Entry {
            ok: 9,
            fail: 1,
            latency_ms: 50,
            ..Default::default()
        };
        let bad = Entry {
            ok: 1,
            fail: 9,
            latency_ms: 400,
            ..Default::default()
        };
        assert!(score(&good) > score(&bad));
    }

    #[test]
    fn latency_matters() {
        let fast = Entry {
            ok: 5,
            fail: 0,
            latency_ms: 20,
            ..Default::default()
        };
        let slow = Entry {
            ok: 5,
            fail: 0,
            latency_ms: 900,
            ..Default::default()
        };
        assert!(score(&fast) > score(&slow));
    }

    #[test]
    fn three_failures_quarantine_and_success_cures() {
        let dir = std::env::temp_dir().join(format!("k4r-orch-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let key = "srv1|ws|reality";
        let _ = reset(&dir);
        for _ in 0..FAILS_TO_QUARANTINE {
            record(&dir, key, false, 0);
        }
        let list = rows(&load(&dir));
        assert!(list.iter().any(|r| r.key == key && r.quarantined));
        record(&dir, key, true, 120);
        let list = rows(&load(&dir));
        let row = list.iter().find(|r| r.key == key).unwrap();
        assert!(!row.quarantined);
        assert_eq!(row.fail, 0);
        assert_eq!(row.latency_ms, 120);
        let _ = reset(&dir);
    }
}
