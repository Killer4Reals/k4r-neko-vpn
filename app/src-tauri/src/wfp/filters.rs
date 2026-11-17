//! План фильтров kill-switch.
//!
//! Здесь нет ни одного вызова WinAPI: план — чистая функция от того, что знает
//! приложение (пути движка, IP резолверов, флаги DoT/DoH). Поэтому его состав,
//! веса и семейства адресов проверяются тестами без прав администратора, а
//! Windows-часть только применяет готовый план.
//!
//! Правила и их смысл — в docs/kill-switch.md.

use std::net::{Ipv4Addr, Ipv6Addr};

/// Sublayer наш, с весом выше системных: иначе разрешающие правила Windows
/// Firewall могут оказаться раньше наших.
pub const SUBLAYER_NAME: &str = "K4R Neko VPN kill-switch";
pub const SUBLAYER_WEIGHT: u16 = 0xFFF0;

/// Адрес TUN, который поднимает наш движок (см. engine.rs, `build_config`).
pub const TUN_ADDR_V4: Ipv4Addr = Ipv4Addr::new(172, 19, 0, 1);
pub const TUN_PREFIX_V4: u8 = 30;

/// Веса внутри sublayer: больше — раньше. Permits обязаны быть выше BLOCK,
/// иначе блокировка съест и разрешённое.
pub const W_LOOPBACK: u64 = 15;
pub const W_LAN: u64 = 14;
pub const W_ENGINE: u64 = 13;
pub const W_TUN: u64 = 12;
pub const W_DNS: u64 = 11;
pub const W_DOH: u64 = 10;
pub const W_BLOCK: u64 = 1;

/// Имя блокирующего правила: по нему проверяем, что защита на месте.
pub const BLOCK_NAME: &str = "k4r:block-all";
/// Страховочный permit на адрес TUN (правило #6b).
pub const TUN_ADDR_NAME: &str = "k4r:tun-address";
/// Permit по LUID интерфейса TUN (правило #6), ставится динамически.
pub const TUN_LUID_NAME: &str = "k4r:tun-luid";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Family {
    V4,
    V6,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Permit,
    Block,
}

/// Условие фильтра. Несколько условий в одном правиле — это И (AND).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Cond {
    /// Локальная подсеть (FWPM_CONDITION_IP_LOCAL_ADDRESS).
    LocalV4(Ipv4Addr, u8),
    LocalV6(Ipv6Addr, u8),
    /// Удалённая подсеть (FWPM_CONDITION_IP_REMOTE_ADDRESS).
    RemoteV4(Ipv4Addr, u8),
    RemoteV6(Ipv6Addr, u8),
    /// Конкретный удалённый адрес.
    RemoteHostV4(Ipv4Addr),
    RemoteHostV6(Ipv6Addr),
    /// Интерфейс, через который пойдёт соединение (FWPM_CONDITION_IP_LOCAL_INTERFACE).
    LocalLuid(u64),
    /// Путь программы (FWPM_CONDITION_ALE_APP_ID).
    AppId(String),
    Tcp,
    Udp,
    RemotePort(u16),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RuleSpec {
    /// Имя для журнала и для поиска правила в sublayer.
    pub name: &'static str,
    pub family: Family,
    pub action: Action,
    pub weight: u64,
    pub conds: Vec<Cond>,
}

impl RuleSpec {
    fn permit(name: &'static str, family: Family, weight: u64, conds: Vec<Cond>) -> Self {
        Self {
            name,
            family,
            action: Action::Permit,
            weight,
            conds,
        }
    }

    fn block(family: Family) -> Self {
        Self {
            name: BLOCK_NAME,
            family,
            action: Action::Block,
            weight: W_BLOCK,
            conds: Vec::new(),
        }
    }
}

/// Всё, от чего зависит план. Пути движков — абсолютные.
#[derive(Clone, Debug, Default)]
pub struct PlanOpts {
    /// Фактические пути `sing-box.exe` (обновлённое ядро и/или бандл).
    pub engine_paths: Vec<String>,
    pub resolver_v4: Option<Ipv4Addr>,
    pub resolver_v6: Option<Ipv6Addr>,
    /// DoT включён — разрешаем TCP/853 к резолверу.
    pub dot: bool,
    /// DoH разрешаем только когда известен IP: URL без IP — не разрешение.
    pub doh_v4: Option<Ipv4Addr>,
    pub doh_v6: Option<Ipv6Addr>,
}

/// Стартовый план: ставится сразу при включении kill-switch, ещё без TUN.
///
/// Здесь НЕТ правила #6 (LUID): интерфейса TUN в этот момент не существует.
/// Вместо него — #6b, permit на адрес TUN: он безвреден, пока адрес никому не
/// принадлежит, и закрывает окно между появлением TUN и добавлением #6.
pub fn startup_plan(o: &PlanOpts) -> Vec<RuleSpec> {
    let mut plan = Vec::new();

    // #1/#2 — loopback: без него ломаются локальные сервисы и сам движок
    plan.push(RuleSpec::permit(
        "k4r:loopback-v4",
        Family::V4,
        W_LOOPBACK,
        vec![Cond::LocalV4(Ipv4Addr::new(127, 0, 0, 0), 8)],
    ));
    plan.push(RuleSpec::permit(
        "k4r:loopback-v6",
        Family::V6,
        W_LOOPBACK,
        vec![Cond::LocalV6(Ipv6Addr::LOCALHOST, 128)],
    ));

    // #3/#4 — локальная сеть: роутер, принтер, локальный DNS. Интернет это не
    // открывает: диапазоны приватные.
    for (name, addr, len) in [
        ("k4r:lan-10", Ipv4Addr::new(10, 0, 0, 0), 8),
        ("k4r:lan-172", Ipv4Addr::new(172, 16, 0, 0), 12),
        ("k4r:lan-192", Ipv4Addr::new(192, 168, 0, 0), 16),
        ("k4r:lan-linklocal", Ipv4Addr::new(169, 254, 0, 0), 16),
    ] {
        plan.push(RuleSpec::permit(
            name,
            Family::V4,
            W_LAN,
            vec![Cond::RemoteV4(addr, len)],
        ));
    }
    plan.push(RuleSpec::permit(
        "k4r:lan-ula",
        Family::V6,
        W_LAN,
        vec![Cond::RemoteV6("fc00::".parse().expect("валидный адрес"), 7)],
    ));
    plan.push(RuleSpec::permit(
        "k4r:lan-linklocal-v6",
        Family::V6,
        W_LAN,
        vec![Cond::RemoteV6(
            "fe80::".parse().expect("валидный адрес"),
            10,
        )],
    ));

    // #5 — сам движок: он соединяется с сервером через физический интерфейс,
    // а не через TUN. Без этого правила туннель заблокирует сам себя.
    for path in &o.engine_paths {
        if path.trim().is_empty() {
            continue;
        }
        plan.push(RuleSpec::permit(
            "k4r:engine",
            Family::V4,
            W_ENGINE,
            vec![Cond::AppId(path.clone())],
        ));
        plan.push(RuleSpec::permit(
            "k4r:engine",
            Family::V6,
            W_ENGINE,
            vec![Cond::AppId(path.clone())],
        ));
    }

    // #6b — страховка для трафика, явно привязавшегося к адресу TUN (и для
    // DNS-запросов на него). Основной permit для TUN-трафика — #6 (LUID),
    // который добавляется watcher'ом, когда адаптер появился. /32, а не /30:
    // только наш адрес, без соседних адресов чужой сети.
    // Кандидат на удаление после живой проверки, если не матчит ничего реального.
    plan.push(RuleSpec::permit(
        TUN_ADDR_NAME,
        Family::V4,
        W_TUN,
        vec![Cond::LocalV4(TUN_ADDR_V4, 32)],
    ));

    // #7–#10 — DNS и DoH: только к резолверу, только своим семейством,
    // только нужные протокол и порт. «Любой порт» не разрешаем: это дыра.
    if let Some(ip) = o.resolver_v4 {
        plan.extend(dns_rules(Family::V4, DnsHost::V4(ip), o.dot));
    }
    if let Some(ip) = o.resolver_v6 {
        plan.extend(dns_rules(Family::V6, DnsHost::V6(ip), o.dot));
    }
    if let Some(ip) = o.doh_v4 {
        plan.extend(doh_rule(Family::V4, DnsHost::V4(ip)));
    }
    if let Some(ip) = o.doh_v6 {
        plan.extend(doh_rule(Family::V6, DnsHost::V6(ip)));
    }

    // #11 — всё, что не попало в permit. Ставится последним в плане, но в
    // helper'е коммитится первым, отдельно: защита не должна зависеть от того,
    // успели ли примениться разрешения.
    plan.push(RuleSpec::block(Family::V4));
    plan.push(RuleSpec::block(Family::V6));

    plan
}

/// Правило #6: permit по LUID интерфейса. Ставится только когда адаптер есть.
pub fn tun_rule(luid: u64) -> Vec<RuleSpec> {
    vec![
        RuleSpec::permit(
            TUN_LUID_NAME,
            Family::V4,
            W_TUN,
            vec![Cond::LocalLuid(luid)],
        ),
        RuleSpec::permit(
            TUN_LUID_NAME,
            Family::V6,
            W_TUN,
            vec![Cond::LocalLuid(luid)],
        ),
    ]
}

/// Отдельно взятые блокирующие правила — их helper ставит первыми.
pub fn block_rules() -> Vec<RuleSpec> {
    vec![RuleSpec::block(Family::V4), RuleSpec::block(Family::V6)]
}

enum DnsHost {
    V4(Ipv4Addr),
    V6(Ipv6Addr),
}

impl DnsHost {
    fn cond(&self) -> Cond {
        match self {
            DnsHost::V4(ip) => Cond::RemoteHostV4(*ip),
            DnsHost::V6(ip) => Cond::RemoteHostV6(*ip),
        }
    }
}

fn dns_rules(family: Family, host: DnsHost, dot: bool) -> Vec<RuleSpec> {
    let mut out = vec![
        RuleSpec::permit(
            "k4r:dns-udp53",
            family,
            W_DNS,
            vec![host.cond(), Cond::Udp, Cond::RemotePort(53)],
        ),
        RuleSpec::permit(
            "k4r:dns-tcp53",
            family,
            W_DNS,
            vec![host.cond(), Cond::Tcp, Cond::RemotePort(53)],
        ),
    ];
    if dot {
        out.push(RuleSpec::permit(
            "k4r:dns-dot853",
            family,
            W_DNS,
            vec![host.cond(), Cond::Tcp, Cond::RemotePort(853)],
        ));
    }
    out
}

/// DoH — осознанное исключение: только если владелец задал IP резолвера.
/// URL без IP не разрешаем, иначе 443 пришлось бы открыть «куда угодно».
fn doh_rule(family: Family, host: DnsHost) -> Vec<RuleSpec> {
    vec![RuleSpec::permit(
        "k4r:doh-443",
        family,
        W_DOH,
        vec![host.cond(), Cond::Tcp, Cond::RemotePort(443)],
    )]
}

/// Есть ли в плане блокировка на обоих семействах. Helper проверяет это после
/// каждой пересборки: если BLOCK пропал, защита не работает.
pub fn has_block(plan: &[RuleSpec]) -> bool {
    [Family::V4, Family::V6].iter().all(|f| {
        plan.iter()
            .any(|r| r.action == Action::Block && r.family == *f && r.conds.is_empty())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan() -> Vec<RuleSpec> {
        startup_plan(&PlanOpts::default())
    }

    fn find<'a>(plan: &'a [RuleSpec], name: &str) -> Vec<&'a RuleSpec> {
        plan.iter().filter(|r| r.name == name).collect()
    }

    /// Если кто-то уберёт BLOCK из стартового плана, защита станет фикцией —
    /// этот тест обязан упасть.
    #[test]
    fn startup_plan_always_has_block() {
        let p = plan();
        assert!(
            has_block(&p),
            "в стартовом плане нет BLOCK на оба семейства"
        );
        for family in [Family::V4, Family::V6] {
            let block = p
                .iter()
                .find(|r| r.action == Action::Block && r.family == family)
                .unwrap_or_else(|| panic!("нет BLOCK для {family:?}"));
            assert!(
                block.conds.is_empty(),
                "BLOCK должен ловить всё, без условий"
            );
        }
    }

    /// #6b — страховка, которая висит с момента включения kill-switch. Её
    /// случайное удаление снова открывает окно гонки при появлении TUN.
    #[test]
    fn startup_plan_always_has_tun_address_permit() {
        let p = plan();
        let tun = find(&p, TUN_ADDR_NAME);
        assert_eq!(tun.len(), 1, "ожидали ровно один permit на адрес TUN");
        assert_eq!(tun[0].action, Action::Permit);
        assert_eq!(tun[0].family, Family::V4);
        assert_eq!(tun[0].weight, W_TUN);
        assert_eq!(tun[0].conds, vec![Cond::LocalV4(TUN_ADDR_V4, 32)]);
        // и он не должен зависеть от того, знаем ли мы уже LUID
        assert!(p
            .iter()
            .all(|r| !matches!(r.conds.as_slice(), [Cond::LocalLuid(_)])));
    }

    #[test]
    fn tun_luid_rule_only_when_known() {
        // стартовый план #6 не содержит: интерфейса ещё нет
        assert!(plan()
            .iter()
            .all(|r| !r.conds.iter().any(|c| matches!(c, Cond::LocalLuid(_)))));
        let rules = tun_rule(0x1234);
        assert_eq!(rules.len(), 2, "по правилу на каждое семейство");
        for r in &rules {
            assert_eq!(r.name, TUN_LUID_NAME);
            assert_eq!(r.action, Action::Permit);
            assert_eq!(r.conds, vec![Cond::LocalLuid(0x1234)]);
        }
        assert!(rules.iter().any(|r| r.family == Family::V4));
        assert!(rules.iter().any(|r| r.family == Family::V6));
    }

    #[test]
    fn resolver_rules_match_family() {
        let v4 = PlanOpts {
            resolver_v4: Some(Ipv4Addr::new(1, 1, 1, 1)),
            ..PlanOpts::default()
        };
        let p = startup_plan(&v4);
        let dns: Vec<&RuleSpec> = p.iter().filter(|r| r.name.starts_with("k4r:dns")).collect();
        assert!(!dns.is_empty());
        assert!(dns.iter().all(|r| r.family == Family::V4));
        assert!(dns.iter().all(|r| r
            .conds
            .contains(&Cond::RemoteHostV4(Ipv4Addr::new(1, 1, 1, 1)))));

        let v6 = PlanOpts {
            resolver_v6: Some("2606:4700:4700::1111".parse().unwrap()),
            ..PlanOpts::default()
        };
        let p = startup_plan(&v6);
        let dns: Vec<&RuleSpec> = p.iter().filter(|r| r.name.starts_with("k4r:dns")).collect();
        assert!(!dns.is_empty());
        assert!(dns.iter().all(|r| r.family == Family::V6));

        // dual-stack — оба семейства, каждое на своём слое
        let both = PlanOpts {
            resolver_v4: Some(Ipv4Addr::new(1, 1, 1, 1)),
            resolver_v6: Some("2606:4700:4700::1111".parse().unwrap()),
            ..PlanOpts::default()
        };
        let p = startup_plan(&both);
        assert!(p
            .iter()
            .any(|r| r.name == "k4r:dns-udp53" && r.family == Family::V4));
        assert!(p
            .iter()
            .any(|r| r.name == "k4r:dns-udp53" && r.family == Family::V6));
    }

    #[test]
    fn doh_needs_explicit_ip() {
        // URL без IP — правило 443 не ставится вообще
        assert!(plan().iter().all(|r| r.name != "k4r:doh-443"));

        let with_ip = PlanOpts {
            doh_v4: Some(Ipv4Addr::new(1, 1, 1, 1)),
            ..PlanOpts::default()
        };
        let p = startup_plan(&with_ip);
        let doh = find(&p, "k4r:doh-443");
        assert_eq!(doh.len(), 1);
        assert_eq!(doh[0].family, Family::V4);
        assert_eq!(doh[0].weight, W_DOH);
        assert!(doh[0].conds.contains(&Cond::Tcp));
        assert!(doh[0].conds.contains(&Cond::RemotePort(443)));

        let with_ip6 = PlanOpts {
            doh_v6: Some("2606:4700:4700::1111".parse().unwrap()),
            ..PlanOpts::default()
        };
        let p = startup_plan(&with_ip6);
        assert!(p
            .iter()
            .any(|r| r.name == "k4r:doh-443" && r.family == Family::V6));
    }

    #[test]
    fn permits_outweigh_block() {
        let p = plan();
        let block = p.iter().find(|r| r.action == Action::Block).unwrap().weight;
        for r in p.iter().filter(|r| r.action == Action::Permit) {
            assert!(r.weight > block, "permit {} не перебивает BLOCK", r.name);
        }
    }

    #[test]
    fn dot_and_doh_are_opt_in() {
        let base = plan();
        assert!(base.iter().all(|r| r.name != "k4r:dns-dot853"));
        let dot = startup_plan(&PlanOpts {
            resolver_v4: Some(Ipv4Addr::new(1, 1, 1, 1)),
            dot: true,
            ..PlanOpts::default()
        });
        assert!(dot
            .iter()
            .any(|r| r.name == "k4r:dns-dot853" && r.family == Family::V4));
    }

    #[test]
    fn engine_permit_uses_every_path_and_is_absolute() {
        let p = startup_plan(&PlanOpts {
            engine_paths: vec![
                r"C:\Program Files\K4R Neko VPN\sing-box.exe".into(),
                r"C:\Users\me\AppData\Roaming\K4R\core\sing-box.exe".into(),
            ],
            ..PlanOpts::default()
        });
        let apps: Vec<&Cond> = p
            .iter()
            .filter(|r| r.name == "k4r:engine")
            .flat_map(|r| r.conds.iter())
            .collect();
        assert_eq!(apps.len(), 4, "два пути × два семейства");
        for c in apps {
            match c {
                Cond::AppId(path) => assert!(path.contains(":\\"), "путь должен быть абсолютным"),
                _ => panic!("у engine-правила только app-id"),
            }
        }
    }
}
