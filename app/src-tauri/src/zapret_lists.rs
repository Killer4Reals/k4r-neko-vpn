//! Импорт списков из zapret. Ничего в чужой папке не меняем: только читаем
//! `lists/*.txt` и превращаем их в наши правила маршрутизации.
//!
//! Зачем: у людей уже есть готовые списки того, что блокирует провайдер
//! (`list-general.txt`, `ipset-all.txt`). Нет смысла заставлять их собирать
//! это заново руками.

use crate::store::RouteRule;
use serde::Serialize;
use std::path::{Path, PathBuf};

/// Сколько строк берём из одного файла: больше — уже не список, а свалка.
pub const MAX_PER_FILE: usize = 4000;

#[derive(Serialize, Default, Debug)]
pub struct Scan {
    pub dir: String,
    pub domains: usize,
    pub google: usize,
    pub excluded: usize,
    pub ips: usize,
    pub excluded_ips: usize,
    pub exists: bool,
}

#[derive(Serialize, Default, Debug)]
pub struct Imported {
    pub rules: Vec<RouteRule>,
    pub skipped: usize,
}

fn lists(dir: &Path) -> PathBuf {
    dir.join("lists")
}

fn read_lines(path: &Path) -> Vec<String> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    text.lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .collect()
}

/// Домен ли это: буквы/цифры/дефис/точка, без пробелов и слэшей.
fn is_domain(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 253
        && value.contains('.')
        && !value.contains(' ')
        && !value.contains('/')
        && !value.contains(':')
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
}

/// CIDR ли это: `1.2.3.0/24` или одиночный IPv4.
fn is_cidr(value: &str) -> bool {
    let (ip, mask) = match value.split_once('/') {
        Some((ip, mask)) => (ip, Some(mask)),
        None => (value, None),
    };
    let octets: Vec<&str> = ip.split('.').collect();
    if octets.len() != 4 {
        return false;
    }
    if !octets.iter().all(|o| {
        !o.is_empty()
            && o.len() <= 3
            && o.chars().all(|c| c.is_ascii_digit())
            && o.parse::<u16>().map(|n| n <= 255).unwrap_or(false)
    }) {
        return false;
    }
    match mask {
        Some(m) => {
            !m.is_empty()
                && m.len() <= 2
                && m.chars().all(|c| c.is_ascii_digit())
                && m.parse::<u8>().map(|n| n <= 32).unwrap_or(false)
        }
        None => true,
    }
}

fn count(path: &Path, pred: fn(&str) -> bool) -> usize {
    read_lines(path).iter().filter(|l| pred(l)).count()
}

pub fn scan(dir: &str) -> Scan {
    let root = PathBuf::from(dir.trim());
    let l = lists(&root);
    Scan {
        dir: root.display().to_string(),
        exists: l.is_dir(),
        domains: count(&l.join("list-general.txt"), is_domain),
        google: count(&l.join("list-google.txt"), is_domain),
        excluded: count(&l.join("list-exclude.txt"), is_domain),
        ips: count(&l.join("ipset-all.txt"), is_cidr),
        excluded_ips: count(&l.join("ipset-exclude.txt"), is_cidr),
    }
}

fn push_unique(out: &mut Vec<RouteRule>, kind: &str, value: &str, action: &str) {
    if out
        .iter()
        .any(|r| r.kind == kind && r.value.eq_ignore_ascii_case(value))
    {
        return;
    }
    out.push(RouteRule {
        kind: kind.to_string(),
        value: value.to_string(),
        action: action.to_string(),
        enabled: true,
    });
}

/// Собираем правила: заблокированное — через VPN, исключения — напрямую.
/// `include_ips` включает ipset: он большой, поэтому по выбору человека.
pub fn import(dir: &str, include_ips: bool) -> Imported {
    let root = PathBuf::from(dir.trim());
    let l = lists(&root);
    let mut rules: Vec<RouteRule> = Vec::new();
    let mut skipped = 0usize;

    // 1. Исключения — первыми: они должны перебивать остальные правила.
    for (file, kind, action) in [
        ("list-exclude.txt", "suffix", "direct"),
        ("list-exclude-user.txt", "suffix", "direct"),
        ("ipset-exclude.txt", "ip", "direct"),
        ("ipset-exclude-user.txt", "ip", "direct"),
    ] {
        let mut taken = 0;
        for line in read_lines(&l.join(file)) {
            let ok = if kind == "ip" {
                is_cidr(&line)
            } else {
                is_domain(&line)
            };
            if !ok {
                skipped += 1;
                continue;
            }
            if taken >= MAX_PER_FILE {
                skipped += 1;
                continue;
            }
            push_unique(&mut rules, kind, &line, action);
            taken += 1;
        }
    }

    // 2. Заблокированное — в туннель.
    for file in [
        "list-general.txt",
        "list-google.txt",
        "list-general-user.txt",
    ] {
        let mut taken = 0;
        for line in read_lines(&l.join(file)) {
            if !is_domain(&line) {
                skipped += 1;
                continue;
            }
            if taken >= MAX_PER_FILE {
                skipped += 1;
                continue;
            }
            push_unique(&mut rules, "suffix", &line, "proxy");
            taken += 1;
        }
    }

    // 3. Адреса — по желанию: их тысячи, и они дублируют домены.
    if include_ips {
        for file in ["ipset-all.txt", "ipset-all-user.txt"] {
            let mut taken = 0;
            for line in read_lines(&l.join(file)) {
                if !is_cidr(&line) {
                    skipped += 1;
                    continue;
                }
                if taken >= MAX_PER_FILE {
                    skipped += 1;
                    continue;
                }
                push_unique(&mut rules, "ip", &line, "proxy");
                taken += 1;
            }
        }
    }

    Imported { rules, skipped }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_domains_and_cidrs() {
        assert!(is_domain("youtube.com"));
        assert!(is_domain("rr3---sn-4g5e6nzz.googlevideo.com"));
        assert!(!is_domain("# comment"));
        assert!(!is_domain("http://x.y/z"));
        assert!(is_cidr("1.2.3.0/24"));
        assert!(is_cidr("8.8.8.8"));
        assert!(!is_cidr("999.1.1.1"));
        assert!(!is_cidr("hello.world"));
    }

    fn fixture(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("k4r-zapret-{}-{}", std::process::id(), name));
        let _ = std::fs::remove_dir_all(&dir);
        let lists = dir.join("lists");
        std::fs::create_dir_all(&lists).unwrap();
        std::fs::write(
            lists.join("list-general.txt"),
            "# blocked\nyoutube.com\n\ndiscord.com\nnot a domain\n",
        )
        .unwrap();
        std::fs::write(lists.join("list-exclude.txt"), "local.example\n").unwrap();
        std::fs::write(lists.join("ipset-all.txt"), "1.2.3.0/24\nмного\n").unwrap();
        dir
    }

    #[test]
    fn scan_counts_only_valid_lines() {
        let dir = fixture("scan");
        let out = scan(dir.to_str().unwrap());
        assert!(out.exists);
        assert_eq!(out.domains, 2);
        assert_eq!(out.excluded, 1);
        assert_eq!(out.ips, 1);
    }

    #[test]
    fn import_puts_exclusions_first_and_skips_junk() {
        let dir = fixture("import");
        let out = import(dir.to_str().unwrap(), true);
        assert_eq!(out.rules[0].value, "local.example");
        assert_eq!(out.rules[0].action, "direct");
        let blocked: Vec<&RouteRule> = out.rules.iter().filter(|r| r.action == "proxy").collect();
        assert!(blocked.iter().any(|r| r.value == "youtube.com"));
        assert!(blocked.iter().any(|r| r.value == "1.2.3.0/24"));
        assert!(out.skipped >= 2);
        assert!(out.rules.iter().all(|r| r.value != "not a domain"));
    }

    #[test]
    fn missing_folder_is_not_an_error() {
        let out = import("C:/no/such/path", true);
        assert!(out.rules.is_empty());
        assert!(!scan("C:/no/such/path").exists);
    }
}
