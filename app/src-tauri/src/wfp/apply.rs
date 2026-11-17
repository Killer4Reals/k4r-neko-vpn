//! Применение плана фильтров к WFP.
//!
//! Сессия helper'а динамическая: при смерти процесса BFE снимает все наши
//! фильтры сам. Блокирующие фильтры ставятся один раз и живут весь сеанс;
//! разрешающие пересобираются транзакцией, чтобы при ошибке остался старый
//! рабочий набор, а не пустота.

use std::net::{Ipv4Addr, Ipv6Addr};

use wfp::{
    AppIdConditionBuilder, FilterBuilder, FilterEngine, FilterEngineBuilder, FilterEnumerator,
    FilterWeight, Guid, InterfaceConditionBuilder, IpAddressConditionBuilder, Layer,
    PortConditionBuilder, ProtocolConditionBuilder, SubLayerBuilder, Transaction,
};

use super::filters::{self, Action, Cond, Family, PlanOpts, RuleSpec};

/// Наш sublayer. GUID фиксированный: по нему helper находит свои фильтры.
const SUBLAYER_GUID: u128 = 0x6b3477a1_9f2e_4c8b_9d31_5a1c0e7f2b10;

pub struct Keeper {
    engine: FilterEngine,
    sublayer: Guid,
    /// Блокирующие фильтры: ставятся при открытии и не пересобираются.
    blocks: Vec<u64>,
    /// Разрешающие фильтры: пересобираются целиком.
    permits: Vec<u64>,
    /// Правило #6 (LUID): добавляется/снимается отдельно watcher'ом.
    tun: Vec<u64>,
    tun_luid: Option<u64>,
}

impl Keeper {
    /// Открывает динамическую сессию, создаёт sublayer и ставит BLOCK.
    ///
    /// Порядок важен: сначала защита, потом всё остальное. Если разрешения
    /// применить не удалось, блокировка всё равно уже стоит.
    pub fn open() -> Result<Self, String> {
        let engine = FilterEngineBuilder::default()
            .dynamic()
            .open()
            .map_err(|e| friendly(e))?;
        let sublayer = Guid::from_u128(SUBLAYER_GUID);

        let mut keeper = Self {
            engine,
            sublayer,
            blocks: Vec::new(),
            permits: Vec::new(),
            tun: Vec::new(),
            tun_luid: None,
        };
        keeper.setup_sublayer()?;
        keeper.add_blocks()?;
        Ok(keeper)
    }

    fn setup_sublayer(&mut self) -> Result<(), String> {
        let guid = self.sublayer;
        let transaction = Transaction::new(&mut self.engine).map_err(|e| friendly(e))?;
        SubLayerBuilder::default()
            .name(filters::SUBLAYER_NAME)
            .weight(filters::SUBLAYER_WEIGHT)
            .guid(guid)
            .add(&transaction)
            .map_err(|e| friendly(e))?;
        transaction.commit().map_err(|e| friendly(e))
    }

    fn add_blocks(&mut self) -> Result<(), String> {
        let sublayer = self.sublayer;
        let transaction = Transaction::new(&mut self.engine).map_err(|e| friendly(e))?;
        let mut ids = Vec::new();
        for rule in filters::block_rules() {
            ids.push(add_rule(&transaction, sublayer, &rule)?);
        }
        transaction.commit().map_err(|e| friendly(e))?;
        self.blocks = ids;
        Ok(())
    }

    /// Пересобирает разрешения. Старый набор живёт до успешного commit.
    pub fn apply(&mut self, opts: &PlanOpts) -> Result<usize, String> {
        let plan = filters::startup_plan(opts);
        let sublayer = self.sublayer;
        let luid = self.tun_luid;
        let transaction = Transaction::new(&mut self.engine).map_err(|e| friendly(e))?;

        for id in self.permits.drain(..) {
            let _ = wfp::delete_filter(&transaction, id);
        }
        for id in self.tun.drain(..) {
            let _ = wfp::delete_filter(&transaction, id);
        }
        if let Some(luid) = luid {
            for rule in filters::tun_rule(luid) {
                self.tun.push(add_rule(&transaction, sublayer, &rule)?);
            }
        }
        let mut added = 0;
        for rule in plan.iter().filter(|r| r.action == Action::Permit) {
            self.permits.push(add_rule(&transaction, sublayer, rule)?);
            added += 1;
        }
        transaction.commit().map_err(|e| friendly(e))?;

        // Транзакция прошла — но защита не должна зависеть от веры: проверяем,
        // что BLOCK на месте. Пропал — кричим и ставим заново немедленно.
        if !self.block_present() {
            log_critical("BLOCK исчез после пересборки — ставлю заново");
            self.blocks.clear();
            self.add_blocks()?;
        }
        Ok(added + self.blocks.len() + self.tun.len())
    }

    /// Правило #6: появился/исчез TUN.
    pub fn set_tun(&mut self, luid: Option<u64>) -> Result<(), String> {
        if self.tun_luid == luid {
            return Ok(());
        }
        let sublayer = self.sublayer;
        let transaction = Transaction::new(&mut self.engine).map_err(|e| friendly(e))?;
        for id in self.tun.drain(..) {
            let _ = wfp::delete_filter(&transaction, id);
        }
        if let Some(luid) = luid {
            for rule in filters::tun_rule(luid) {
                self.tun.push(add_rule(&transaction, sublayer, &rule)?);
            }
        }
        transaction.commit().map_err(|e| friendly(e))?;
        match luid {
            Some(l) => log_line(&format!("TUN LUID {l} обнаружен, правило #6 добавлено")),
            None => log_line("TUN LUID исчез, правило #6 снято"),
        }
        self.tun_luid = luid;
        Ok(())
    }

    /// Проверка через перечисление фильтров: BLOCK с нашим именем существует.
    fn block_present(&mut self) -> bool {
        let Ok(transaction) = Transaction::new(&mut self.engine) else {
            return false;
        };
        let Ok(mut list) = FilterEnumerator::new(&transaction) else {
            return false;
        };
        while let Some(item) = list.next() {
            if let Ok(filter) = item {
                if filter
                    .name()
                    .map(|n| n.to_string_lossy().contains(filters::BLOCK_NAME))
                    .unwrap_or(false)
                {
                    return true;
                }
            }
        }
        false
    }

    /// Снимает всё: закрытие сессии убирает фильтры (dynamic).
    pub fn close(self) {
        drop(self);
    }

    /// Известен ли уже LUID TUN (для статуса в UI).
    pub fn tun_known(&self) -> bool {
        self.tun_luid.is_some()
    }

    pub fn counts(&self) -> (usize, usize) {
        (self.blocks.len(), self.permits.len())
    }
}

fn add_rule(transaction: &Transaction<'_>, sublayer: Guid, rule: &RuleSpec) -> Result<u64, String> {
    let mut builder = FilterBuilder::default()
        .name(rule.name)
        .action(match rule.action {
            Action::Permit => wfp::ActionType::Permit,
            Action::Block => wfp::ActionType::Block,
        })
        .layer(match rule.family {
            Family::V4 => Layer::ConnectV4,
            Family::V6 => Layer::ConnectV6,
        })
        .sublayer(sublayer)
        .weight(FilterWeight::Exact(rule.weight));
    for cond in &rule.conds {
        match to_condition(cond) {
            Some(c) => builder = builder.condition(c),
            // Путь движка мог исчезнуть между стартом и пересборкой: правило
            // без app-id бесполезно, но и падать из-за него нельзя.
            None => log_line("не смог собрать условие фильтра — пропускаю прав��ло"),
        }
    }
    builder.add(transaction).map_err(|e| friendly(e))
}

fn to_condition(cond: &Cond) -> Option<wfp::Condition> {
    Some(match cond {
        Cond::LocalV4(addr, len) => IpAddressConditionBuilder::local()
            .subnet_v4(*addr, *len)
            .build(),
        Cond::LocalV6(addr, len) => IpAddressConditionBuilder::local()
            .subnet_v6(*addr, *len)
            .build(),
        Cond::RemoteV4(addr, len) => IpAddressConditionBuilder::remote()
            .subnet_v4(*addr, *len)
            .build(),
        Cond::RemoteV6(addr, len) => IpAddressConditionBuilder::remote()
            .subnet_v6(*addr, *len)
            .build(),
        Cond::RemoteHostV4(addr) => IpAddressConditionBuilder::remote().host_v4(*addr).build(),
        Cond::RemoteHostV6(addr) => IpAddressConditionBuilder::remote().host_v6(*addr).build(),
        Cond::LocalLuid(luid) => InterfaceConditionBuilder::local().luid(*luid).build(),
        Cond::AppId(path) => AppIdConditionBuilder::default().equal(path).ok()?.build(),
        Cond::Tcp => ProtocolConditionBuilder::tcp().build(),
        Cond::Udp => ProtocolConditionBuilder::udp().build(),
        Cond::RemotePort(port) => PortConditionBuilder::remote().equal(*port).build(),
    })
}

/// Приводим коды WinAPI к понятным фразам.
fn friendly(e: std::io::Error) -> String {
    match e.raw_os_error() {
        Some(5) => "нужны права администратора: WFP не пускает без повышения".to_string(),
        Some(87) => format!("WFP отклонил параметры фильтра: {e}"),
        _ => format!("WFP: {e}"),
    }
}

pub fn log_line(text: &str) {
    let path = log_path();
    if path.is_empty() {
        eprintln!("{text}");
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
        let _ = writeln!(f, "{stamp} {text}");
    }
}

fn log_critical(text: &str) {
    log_line(&format!("CRITICAL {text}"));
}

pub fn log_path() -> String {
    if let Ok(custom) = std::env::var("K4R_WFP_LOG") {
        if !custom.is_empty() {
            return custom;
        }
    }
    run_dir().join("killswitch.log").display().to_string()
}

/// Каталог helper'а: журнал и pid-файл. Отдельно от данных приложения, чтобы
/// `--wfp-off` находил их, даже если приложение переустановили.
pub fn run_dir() -> std::path::PathBuf {
    let base = std::env::var("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir());
    let dir = base.join("K4R-Neko-VPN");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Где helper хранит свой pid: по нему `--wfp-off` находит процесс, если канал
/// завис.
pub fn pid_path() -> std::path::PathBuf {
    run_dir().join("wfp-helper.pid")
}

/// Адреса из строк IPC. Мусор — None, а не паника: helper не должен падать
/// из-за кривого запроса.
pub fn parse_v4(raw: &Option<String>) -> Option<Ipv4Addr> {
    raw.as_deref().and_then(|s| s.trim().parse().ok())
}

pub fn parse_v6(raw: &Option<String>) -> Option<Ipv6Addr> {
    raw.as_deref().and_then(|s| s.trim().parse().ok())
}
