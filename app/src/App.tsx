import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
import "@fontsource-variable/manrope";
import { useT, type Lang } from "./i18n";
import { servers as demoCatalog, type AppEntry, type ConnState, type Server } from "./data";
import { ccFromName, knownCc, nameOf, stripCc } from "./flags";
import type { ChosenApp, ExitInfo, KillSwitchStatus, OrchRow, RouteRule, SplitPreset } from "./api";
import { fillPool, isBusy, pickServer, smartPool, splitReserve } from "./autoSelect";
import { isDegraded, pushRate } from "./degrade";
import { lastAliveAt, poolDead, slowSwitchTarget } from "./health";
import { pickFailover, unexpectedStop } from "./failover";
import { parseEvents, pushEvent, serializeEvents, type HistoryEvent } from "./history";
import { HistoryScreen } from "./screens/History";
import { activeScenario, changedKeys, scenarioById, type ScenarioId, type ScenarioSettings } from "./scenarios";
import { buildReport } from "./selfcheck";
import { pairKey, quarantinedIds } from "./orchestrator";
import { probeOnce } from "./probe";
import { Splash } from "./Splash";
import { Onboarding, shouldOnboard } from "./Onboarding";
import { Aurora } from "./Aurora";
import { readAurora, writeAurora, type AuroraPhase } from "./auroraLogic";
import { pushSpark, type Sparks } from "./spark";
import { splashDelay } from "./splashTiming";
import { WATCHDOG_START, watchdogStep, type WatchdogState } from "./watchdog";
import { describe as describeSubError } from "./subError";
import { describe as describeSrsError } from "./srsError";
import { NET_KEY, recall, remember, type NetMap } from "./netMemory";
import type { SubInfo, SubSource } from "./api";
import { api, inTauri, type Profile } from "./api";
import {
  CloseIcon,
  GearIcon,
  LogIcon,
  MaxIcon,
  MinIcon,
  PowerIcon,
  RouteIcon,
  ServerIcon,
  ShieldIcon,
  SplitIcon,
} from "./icons";
import { HomeScreen } from "./screens/Home";
import { ServersScreen } from "./screens/Servers";
import { SplitScreen } from "./screens/Split";
import { RouteScreen } from "./screens/Route";
import { ZapretScreen } from "./screens/Zapret";
import { SettingsScreen } from "./screens/Settings";
import { StatsScreen } from "./screens/Stats";
import { MascotHint, type Pose } from "./MascotHint";
import { play, playConnected } from "./sound";
import { LogsScreen } from "./screens/Logs";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type Screen =
  | "home"
  | "servers"
  | "split"
  | "route"
  | "zapret"
  | "stats"
  | "history"
  | "logs"
  | "settings";
// Тема одна — «Неон». Светлую и тёмную убрали: две из трёх не прижились,
// а держать три палитры ради выбора из одного — лишняя работа.
export type Theme = "mascot";

/** Что говорит маскот на каждой вкладке. */
const HINT_KEY: Record<Screen, string> = {
  home: "hintHome",
  servers: "hintServers",
  split: "hintSplit",
  route: "hintRoute",
  zapret: "hintZapret",
  stats: "hintStats",
  history: "hintHistory",
  logs: "hintLogs",
  settings: "hintSettings",
};

const HINT_POSE: Record<Screen, Pose> = {
  home: 1,
  servers: 2,
  split: 5,
  route: 3,
  zapret: 4,
  stats: 2,
  history: 3,
  logs: 6,
  settings: 3,
};

const navItems: { id: Screen; key: string; icon: typeof PowerIcon }[] = [
  { id: "home", key: "navHome", icon: PowerIcon },
  { id: "servers", key: "navServers", icon: ServerIcon },
  { id: "split", key: "navRoutes", icon: SplitIcon },
  { id: "zapret", key: "navZapret", icon: ShieldIcon },
  { id: "stats", key: "navAnalytics", icon: RouteIcon },
  { id: "logs", key: "navLogs", icon: LogIcon },
  { id: "settings", key: "navSettings", icon: GearIcon },
];

/** Переключатель вкладок внутри слитых экранов: «Маршруты» и «Аналитика». */
function Seg<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="subtabs" role="tablist">
      {items.map((it) => (
        <button
          key={it.id}
          role="tab"
          aria-selected={value === it.id}
          className={value === it.id ? "on" : ""}
          onClick={() => onChange(it.id)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

const DEFAULT_SUB = "";
// Панели узнают клиента по UA и чужим отвечают 502 — берём самый
// распространённый; если провайдер знает только другой, клиент
// переберёт известные сам (см. ua_chain в subscription.rs).
const DEFAULT_UA = "v2rayNG/1.9.0";

/** "Ctrl+Alt+V" -> "Control+Alt+KeyV": what the shortcut plugin understands. */
function toAccelerator(hotkey: string): string {
  const parts = hotkey
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return "";
  const mods = new Set<string>();
  let code = "";
  for (const raw of parts) {
    const p = raw.toLowerCase();
    if (p === "ctrl" || p === "control") mods.add("Control");
    else if (p === "alt") mods.add("Alt");
    else if (p === "shift") mods.add("Shift");
    else if (p === "win" || p === "meta" || p === "super") mods.add("Super");
    else if (/^f\d{1,2}$/.test(p)) code = p.toUpperCase();
    else if (/^\d$/.test(p)) code = `Digit${p}`;
    else if (p.length === 1) code = `Key${p.toUpperCase()}`;
    else code = raw;
  }
  if (!code) return "";
  return [...mods, code].join("+");
}

/** Чем подписан узел в списке: протокол важнее режима TLS. */
function protoTag(p: Profile): string {
  switch ((p.kind || "").toLowerCase()) {
    case "trojan":
      return "TROJAN";
    case "shadowsocks":
      return (p.method || "SS").toUpperCase();
    case "vmess":
      return "VMESS";
    case "wireguard":
      return "WIREGUARD";
    default:
      return (p.security === "none" ? p.network : p.security).toUpperCase();
  }
}

export default function App() {
  const initial = new URLSearchParams(window.location.search);
  const [lang, setLang] = useState<Lang>("ru");
  const [screen, setScreen] = useState<Screen>(() => {
    const saved = initial.get("screen") as Screen | null;
    // Старые ссылки вели на отдельные «Маршрутизацию» и «Историю»: теперь это
    // вкладки внутри «Маршрутов» и «Аналитики».
    if (saved === "route") return "split";
    if (saved === "history") return "stats";
    return saved || "home";
  });
  // Каждый экран открывается сверху: прокрутка серверов не должна встречать
  // человека посреди списка после перехода с главной.
  useEffect(() => {
    const el = document.querySelector(".content");
    if (el) el.scrollTop = 0;
  }, [screen]);

  const [routesTab, setRoutesTab] = useState<"apps" | "rules">("apps");
  const [analyticsTab, setAnalyticsTab] = useState<"stats" | "history">("stats");
  // История событий: переживает перезапуск, 300 записей — это месяцы
  const [events, setEvents] = useState<HistoryEvent[]>(() => parseEvents(localStorage.getItem("k4r.history")));
  const record = useCallback((kind: HistoryEvent["kind"], a?: string, b?: string) => {
    setEvents((prev) => {
      const next = pushEvent(prev, { at: Date.now(), kind, a, b });
      if (next === prev) return prev;
      localStorage.setItem("k4r.history", serializeEvents(next));
      return next;
    });
  }, []);
  const [conn, setConn] = useState<ConnState>((initial.get("state") as ConnState) || "idle");
  const [selectedId, setSelectedId] = useState(demoCatalog[0].id);
  const [zapretAuto, setZapretAuto] = useState(false);
  const [zapretState, setZapretState] = useState<"off" | "running" | "external" | "error">("off");
  const [killSwitch, setKillSwitch] = useState(true);
  // состояние ОС-блокировки: зелёная/жёлтая/красная плашка в настройках
  const [ksState, setKsState] = useState<KillSwitchStatus>({
    state: "off",
    tun: false,
    filters: 0,
    message: "",
  });
  const [catalog, setCatalog] = useState<AppEntry[]>([]);
  const [chosen, setChosen] = useState<ChosenApp[]>([]);
  const [scanning, setScanning] = useState(inTauri);
  // X1: окно спрашивает у Rust, включилась ли подложка. Нет подложки — фон
  // остаётся прежним, поэтому Win10 ничего не теряет.
  useEffect(() => {
    if (!inTauri) return;
    api
      .windowBackdrop()
      .then((kind) => {
        if (kind === "mica" || kind === "acrylic") {
          document.documentElement.dataset.backdrop = kind;
        }
      })
      .catch(() => undefined);
  }, []);
  /// routes changed while the tunnel is up: engine reads them only on start
  const [splitDirty, setSplitDirty] = useState(false);
  /// Именованные наборы программ: «Работа», «Игры», «Кино».
  const [splitPresets, setSplitPresets] = useState<SplitPreset[]>([]);
  /// Избранные узлы: id со звёздочкой. Живут рядом с подпиской, а не в
  /// localStorage: при переносе настроек они должны переехать вместе с ней.
  const [favorites, setFavorites] = useState<string[]>([]);
  const toggleFavorite = useCallback((id: string) => {
    setFavorites((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  }, []);
  /// "only" = tunnel carries just the chosen programs (the owner's default)
  const [splitMode, setSplitMode] = useState<"only" | "all">("only");
  // правила маршрутизации: домены/адреса и пресеты списков
  const [rules, setRules] = useState<RouteRule[]>([]);
  const [routeRu, setRouteRu] = useState(false);
  const [routeAds, setRouteAds] = useState(false);
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);
  // Заставка висит поверх первого кадра 1.2 с: ничего не блокирует, окно уже живое.
  const [splash, setSplash] = useState(true);
  const [onboard, setOnboard] = useState(shouldOnboard);
  // Живой фон включается в настройках; по умолчанию — да, как и просили.
  const [auroraOn, setAuroraOn] = useState(readAurora);
  // Автообновление: тихо проверяем версию и показываем баннер, если вышла новая.
  const [upd, setUpd] = useState<{
    version: string;
    url: string;
    sha256: string;
  } | null>(null);
  const [updBusy, setUpdBusy] = useState(false);
  const [ver, setVer] = useState("");
  const autoUpd = useRef(false);
  /// real counters from the engine, never a made-up number
  // Акцент читаем до первой отрисовки: иначе при запуске мигнёт зелёным.
  useEffect(() => {
    const saved = localStorage.getItem("k4r.accent") || "neon";
    document.documentElement.dataset.accent = saved;
  }, []);

  // Заставка: при «уменьшить движение» не мигает, а просто коротко ждёт.
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    const id = window.setTimeout(() => setSplash(false), splashDelay(reduce));
    return () => window.clearTimeout(id);
  }, []);

  const [traffic, setTraffic] = useState({ down: 0, up: 0 });
  // след скорости для живой кривой на главной: последние сорок секунд
  const [trail, setTrail] = useState<number[]>([]);
  // Сколько узлов в пуле сейчас: один — обычный режим, больше — умный выбор.
  const [poolSize, setPoolSize] = useState(1);
  const [tgProxy, setTgProxy] = useState(false);
  // накопленное с последней записи в статистику, байты
  const statsPending = useRef({ down: 0, up: 0 });
  const prevTotals = useRef<{ down: number; up: number } | null>(null);
  // X3: секундные скорости за последние полминуты и защита от частых переключений.
  const rateHist = useRef<number[]>([]);
  const lastDegrade = useRef(0);
  const autoTickRef = useRef<((force?: boolean) => void) | null>(null);
  const [ip, setIp] = useState("");
  const [exit, setExit] = useState<ExitInfo | null>(null);
  const [ipBusy, setIpBusy] = useState(false);

  const checkIp = async () => {
    if (!inTauri) return;
    setIpBusy(true);
    try {
      const info = await api.exitInfo();
      setIp(info.ip);
      setExit(info);
    } catch {
      // Сервис геолокации мог не ответить, но адрес всё ещё полезен.
      try {
        setIp(await api.myIp());
      } catch {
        setIp("");
      }
      setExit(null);
    } finally {
      setIpBusy(false);
    }
  };

  // Выход — это факт, а не название профиля: провайдер может назвать узел
  // «Германия», а выпустить в Финляндию. Спрашиваем страну у самого адреса.
  // Первый запрос может попасть в момент, когда туннель ещё поднимается,
  // поэтому делаем несколько попыток с паузой, а не одну.
  useEffect(() => {
    if (!inTauri || conn !== "connected") {
      setExit(null);
      return;
    }
    let alive = true;
    let timer = 0;
    let attempt = 0;
    const run = async () => {
      if (!alive) return;
      try {
        const info = await api.exitInfo();
        if (!alive) return;
        setExit(info);
        setIp(info.ip);
      } catch {
        if (!alive) return;
        attempt += 1;
        if (attempt < 4) {
          timer = window.setTimeout(run, 1200 * attempt);
        } else {
          setExit(null);
        }
      }
    };
    timer = window.setTimeout(run, 1200);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [conn, selectedId]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState(initial.get("error") ?? "");
  /// Причина неожиданного обрыва: показывается поверх всех экранов, пока не восстановились.
  const [tunnelIssue, setTunnelIssue] = useState("");
  const [tunnelRecovered, setTunnelRecovered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lat, setLat] = useState<Record<string, number | null>>({});
  // История замеров на узел: спарклайн показывает не «сейчас», а динамику.
  const [sparks, setSparks] = useState<Sparks>({});
  const [nodesBusy, setNodesBusy] = useState(false);
  /// id -> когда последний раз мерили. Без этого «живой» узел не отличить от
  /// того, что отвечал час назад.
  const [latAt, setLatAt] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem("k4r.latAt") ?? "{}") as Record<string, number>;
    } catch {
      return {};
    }
  });
  /**
   * История пишется по факту смены состояния, а не в каждом месте, где мы его
   * меняем: путей много (кнопка, автопереключение, потеря данных, возврат сети),
   * и раньше о части из них знал только журнал ядра.
   */
  const histConn = useRef<ConnState>(conn);
  useEffect(() => {
    const was = histConn.current;
    if (was === conn) return;
    histConn.current = conn;
    if (conn === "connected") record("connect", selectedId);
    else if (conn === "error") record("fail", undefined, error || undefined);
    else if (conn === "idle" && (was === "connected" || was === "connecting")) record("disconnect");
  }, [conn, error, record, selectedId]);

  /** Узлы: событие — это переход «отвечал ↔ не отвечал», а не каждый замер. */
  const prevLat = useRef<Record<string, number | null>>({});
  useEffect(() => {
    const before = prevLat.current;
    for (const [id, ms] of Object.entries(lat)) {
      const was = before[id];
      if (was === undefined) continue; // первый замер узла — не событие
      if (was !== null && ms === null) record("nodeDown", id);
      else if (was === null && ms !== null) record("nodeUp", id);
    }
    prevLat.current = { ...before, ...lat };
  }, [lat, record]);

  const [loaded, setLoaded] = useState(!inTauri);
  const [zapretDir, setZapretDir] = useState<string | null>(null);
  /// the preset the owner picked must survive a restart, not snap back to the first
  const [zapretPreset, setZapretPreset] = useState("");
  const [autostart, setAutostart] = useState(false);
  const [startMinimized, setStartMinimized] = useState(true);
  const [connectOnStart, setConnectOnStart] = useState(false);
  // Автовыбор сервера: 0 — выключено. По умолчанию выключен, чтобы не менять
  // поведение тем, кто уже настроил сервер руками.
  const [autoSelect, setAutoSelect] = useState(0);
  const [autoSelectLoss, setAutoSelectLoss] = useState(false);
  /// Уходить с просевшего узла: по умолчанию выключено.
  const [autoSwitchSlow, setAutoSwitchSlow] = useState(false);
  const [autoHistory, setAutoHistory] = useState<string[]>([]);
  // Оркестратор: счётчики «сервер + транспорт» и состояние проб.
  const [orch, setOrch] = useState<OrchRow[]>([]);
  const wd = useRef<WatchdogState>(WATCHDOG_START);
  const [subUrl, setSubUrl] = useState(DEFAULT_SUB);
  const [subUa, setSubUa] = useState(DEFAULT_UA);
  const [subs, setSubs] = useState<SubSource[]>([]);
  /// hours between automatic subscription refreshes, 0 = only by hand
  const [subRefreshHours, setSubRefreshHours] = useState(12);
  /// manifest used by the "check for updates" button; empty = not set up yet
  const [updateUrl, setUpdateUrl] = useState("");
  const [dnsMode, setDnsMode] = useState<"tunnel" | "system">("tunnel");
  const [blockIpv6, setBlockIpv6] = useState(true);
  const [gameMode, setGameMode] = useState(false);
  const [gamePorts, setGamePorts] = useState("");
  /// resolver inside the tunnel: "1.1.1.1", "https://dns.google/dns-query" or "tls://..."
  const [dnsServer, setDnsServer] = useState("1.1.1.1");
  const [hotkey, setHotkey] = useState("Ctrl+Alt+V");
  const [closeToTray, setCloseToTray] = useState(true);
  const [minimizeToTray, setMinimizeToTray] = useState(true);
  /// device id the subscription server knows us by
  const [deviceId, setDeviceId] = useState("");
  const [notifyOn, setNotifyOn] = useState(true);
  const timer = useRef<number | null>(null);
  // Чего хочет человек: включить или выключить. Нужен, чтобы фоновая сверка
  // не «воскрешала» зелёный статус, пока команда остановки ещё выполняется.
  const tunnelWant = useRef<"on" | "off" | null>(null);
  // Ошибку стираем только при переходе «был не в сети → туннель поднялся»,
  // иначе фоновая сверка каждые 2 секунды затирала бы ошибки watchdog и
  // горячих клавиш.
  const tunnelWasRunning = useRef(false);
  /** Идёт автопереключение: не даём таймеру и триггеру потери сработать повторно. */
  const switching = useRef(false);
  const failoverRef = useRef<((reason?: string) => void) | null>(null);
  const lastFailover = useRef(0);
  const win = inTauri ? getCurrentWindow() : null;

  const t = useT(lang);

  // Старые сохранённые темы (dark/light) просто игнорируются: палитра одна.
  useEffect(() => {
    document.documentElement.dataset.theme = "mascot";
    localStorage.removeItem("k4r.theme");
  }, []);

  const viewServers = useMemo<Server[]>(() => {
    if (profiles.length === 0) return demoCatalog;
    return profiles.map((p) => {
      // Имя профиля — то, что владелец видит в списке, поэтому оно главнее
      // разбора домена: у CDN-доменов страна часто чужая. Если в имени страны
      // нет (например, «YouTube 2»), берём код, который дал разбор подписки.
      const named = ccFromName(p.name);
      const cc = named && knownCc(named) ? named : p.cc && knownCc(p.cc) ? p.cc : null;
      const country = nameOf(cc ?? "", lang);
      const title = stripCc(p.name) || p.host;
      // Вторая строка не должна быть сырым хостом: для названия-страны
      // («Финляндия») это выглядело как технический мусор. Показываем страну,
      // если она отличается, иначе поясняем, что это узел подписки.
      const sub = country && country.toLowerCase() !== title.toLowerCase() ? country : "";
      return {
      id: p.id,
      cc: cc ?? "",
      flag: cc ?? "",
      city: title,
      country: country ?? `${p.host}:${p.port}`,
      sub,
      tag: protoTag(p),
      lat: lat[p.id] ?? 0,
      reserve: p.reserve ?? false,
      kind: p.kind,
      host: p.host,
      };
    });
  }, [profiles, lat, lang, t]);

  const toggleReserve = useCallback((id: string) => {
    setProfiles((list) => list.map((p) => (p.id === id ? { ...p, reserve: !p.reserve } : p)));
  }, []);

  const addWireguard = useCallback(async (text: string) => {
    const profile = await api.wireguardAdd(text);
    setProfiles((list) => [...list, profile]);
    setSelectedId(profile.id);
  }, []);

  const selected = useMemo(
    () => viewServers.find((s) => s.id === selectedId) ?? viewServers[0],
    [viewServers, selectedId],
  );

  // The guard chip shows what is really running; we only ever read it.
  useEffect(() => {
    if (!inTauri) return;
    let alive = true;
    const read = () =>
      api
        .zapretStatus()
        .then((st) => {
          if (alive) setZapretState(st.state);
        })
        .catch(() => undefined);
    read();
    const id = window.setInterval(read, 15000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!inTauri) return;
    api
      .coreInfo()
      .then((info) => {
        setZapretDir(info.zapret_dir);
        setAutostart(info.autostart);
      })
      .catch(() => undefined);
  }, []);

  // Restore what the user had last time; the app must work with zero external programs.
  useEffect(() => {
    if (!inTauri) return;
    api
      .stateLoad()
      .then((st) => {
        if (st.profiles.length) {
          // WARP больше не часть приложения: старые профили, зарегистрированные
          // автоматически, убираем, чтобы в списке не висели мёртвые строки.
          const kept = st.profiles.filter((p) => !p.id.startsWith("warp-"));
          setProfiles(kept);
          if (kept.length !== st.profiles.length) {
            setFavorites((ids) => ids.filter((id) => kept.some((p) => p.id === id)));
          }
        }
        // Свежие серверы нужны сразу при запуске: провайдер мог добавить или
        // убрать узлы, а ждать двенадцать часов до таймера незачем. Источники
        // передаём явно: состояние `subs`/`subUrl` в этот момент ещё старое,
        // и загрузка молча выходила бы с «сначала вставь ссылку».
        const bootSources = st.subs?.length
          ? st.subs
          : st.sub_url
            ? [{ url: st.sub_url, ua: st.sub_ua || DEFAULT_UA, name: "", refreshed: 0 }]
            : [];
        if (bootSources.length) setTimeout(() => void loadSubscription(bootSources), 400);
        if (st.sub_url) setSubUrl(st.sub_url);
        if (st.sub_ua) setSubUa(st.sub_ua);
        if (st.selected) setSelectedId(st.selected);
        if (st.subs) setSubs(st.subs);
        if (st.dns_mode === "system" || st.dns_mode === "tunnel") setDnsMode(st.dns_mode);
        if (typeof st.block_ipv6 === "boolean") setBlockIpv6(st.block_ipv6);
        if (typeof st.game_mode === "boolean") setGameMode(st.game_mode);
        if (Array.isArray(st.game_ports)) setGamePorts(st.game_ports.join(", "));
        if (st.hotkey) setHotkey(st.hotkey);
        if (typeof st.close_to_tray === "boolean") setCloseToTray(st.close_to_tray);
        if (typeof st.start_minimized === "boolean") setStartMinimized(st.start_minimized);
        if (typeof st.minimize_to_tray === "boolean") setMinimizeToTray(st.minimize_to_tray);
        if (st.split_mode === "all" || st.split_mode === "only") setSplitMode(st.split_mode);
        if (st.dns_server) setDnsServer(st.dns_server);
        if (typeof st.sub_refresh_hours === "number") setSubRefreshHours(st.sub_refresh_hours);
        if (st.update_url) setUpdateUrl(st.update_url);
        if (st.zapret_preset) setZapretPreset(st.zapret_preset);
        if (typeof st.zapret_auto === "boolean") setZapretAuto(st.zapret_auto);
        if (typeof st.tg_proxy === "boolean") setTgProxy(st.tg_proxy);
        if (typeof st.notify === "boolean") setNotifyOn(st.notify);
        if (typeof st.kill_switch === "boolean") setKillSwitch(st.kill_switch);
        if (typeof st.connect_on_start === "boolean") setConnectOnStart(st.connect_on_start);
        if (typeof st.auto_select === "number") setAutoSelect(st.auto_select);
        if (typeof st.auto_select_on_loss === "boolean") setAutoSelectLoss(st.auto_select_on_loss);
        if (typeof st.auto_switch_slow === "boolean") setAutoSwitchSlow(st.auto_switch_slow);
        if (Array.isArray(st.rules)) setRules(st.rules);
        if (typeof st.route_ru_direct === "boolean") setRouteRu(st.route_ru_direct);
        if (typeof st.route_block_ads === "boolean") setRouteAds(st.route_block_ads);
        // only what the owner picked is restored — never a full scan dump
        setChosen(
          (st.split ?? []).map((s) => ({
            exe: s.exe,
            name: s.name || s.exe.replace(/\.exe$/i, ""),
            via: s.via,
          })),
        );
        if (Array.isArray(st.split_presets)) setSplitPresets(st.split_presets);
        if (Array.isArray(st.favorites)) setFavorites(st.favorites.filter((x) => typeof x === "string"));
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!inTauri || !loaded) return;
    const id = window.setTimeout(() => {
      api
        .stateSave({
          profiles,
          sub_url: subUrl,
          sub_ua: subUa,
          selected: selectedId,
          split: chosen.map((c) => ({ exe: c.exe, name: c.name, via: c.via })),
          split_presets: splitPresets,
          favorites,
          zapret_dir: zapretDir ?? "",
          zapret_preset: zapretPreset,
          zapret_auto: zapretAuto,
          tg_proxy: tgProxy,
          tg_port: 1354,
          subs,
          dns_mode: dnsMode,
          block_ipv6: blockIpv6,
          game_mode: gameMode,
          game_ports: gamePorts
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          reconnect: true,
          hotkey,
          close_to_tray: closeToTray,
          minimize_to_tray: minimizeToTray,
          notify: notifyOn,
          kill_switch: killSwitch,
          hwid: deviceId || undefined,
          split_mode: splitMode,
          dns_server: dnsServer,
          sub_refresh_hours: subRefreshHours,
          update_url: updateUrl,
          autostart,
          start_minimized: startMinimized,
          connect_on_start: connectOnStart,
          auto_select: autoSelect,
          auto_select_on_loss: autoSelectLoss,
          auto_switch_slow: autoSwitchSlow,
          rules,
          route_ru_direct: routeRu,
          route_block_ads: routeAds,
        })
        .catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(id);
  }, [
    loaded, profiles, subUrl, subUa, selectedId, chosen, zapretDir,
    subs, dnsMode, blockIpv6, gameMode, gamePorts, hotkey, closeToTray, minimizeToTray, notifyOn, killSwitch,
    deviceId, splitMode, dnsServer, subRefreshHours, updateUrl, autostart, connectOnStart,
    zapretPreset, tgProxy, rules, routeRu, routeAds, zapretAuto, startMinimized, splitPresets, favorites,
  ]);

  // Tray icon follows the tunnel state.
  useEffect(() => {
    if (!inTauri) return;
    const map: Record<ConnState, string> = {
      idle: "off",
      connecting: "connecting",
      connected: "on",
      error: "error",
    };
    api.setTrayState(map[conn]).catch(() => undefined);
  }, [conn]);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  // Процесс — единственный источник правды. Сверяемся и при открытии окна,
  // и постоянно: иначе запуск через «Автоподключение» или гонка старта
  // оставляют зелёный туннель с надписью «Отключено».
  useEffect(() => {
    if (!inTauri) return;
    let alive = true;
    const sync = async () => {
      try {
        const st = await api.engineStatus();
        if (!alive) return;
        if (st.state === "running") {
          if (tunnelWant.current === "off") return;
          // Туннель мог быть поднят до открытия окна: без этой строки
          // неожиданное падение такого туннеля не считается неожиданным.
          tunnelWant.current = "on";
          // Ядро могло только что подняться после перезапуска супервизором:
          // это не обрыв, и узел меняет только он.
          if (!tunnelWasRunning.current) setError("");
          tunnelWasRunning.current = true;
          setConn((prev) => (prev === "connected" ? prev : "connected"));
        } else if (st.state === "idle") {
          const unexpected = unexpectedStop(tunnelWant.current, tunnelWasRunning.current, "idle");
          tunnelWasRunning.current = false;
          setConn((prev) => (prev === "connected" ? "idle" : prev));
          if (unexpected) failoverRef.current?.(st.message || "");
        } else if (st.state === "starting") {
          // Супервизор перезапускает ядро или идёт смена узла: это не обрыв,
          // и собственный failover здесь запрещён — иначе два механизма
          // поднимают ядро по кругу. Но и зелёный статус при мёртвом туннеле
          // показывать нельзя: честно «подключаемся».
          if (tunnelWant.current === "on") setConn("connecting");
        } else if (st.state === "error" && tunnelWant.current !== "off") {
          const unexpected = unexpectedStop(tunnelWant.current, tunnelWasRunning.current, "error");
          tunnelWasRunning.current = false;
          setConn((prev) => (prev === "idle" ? prev : "error"));
          setError(st.message);
          if (unexpected) failoverRef.current?.(st.message || "");
        }
      } catch {
        /* движок недоступен: не выдумываем состояние */
      }
    };
    void sync();
    const id = window.setInterval(sync, 2000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [inTauri]);

  // Туннель могут выключить без окна — из трея или мини-плеера. Без этого
  // события фронтенд увидит Idle, сочтёт его обрывом и поднимет туннель назад.
  useEffect(() => {
    if (!inTauri) return;
    let un: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen("tunnel-off", () => {
          tunnelWant.current = "off";
          tunnelWasRunning.current = false;
          setConn("idle");
          setError("");
        }),
      )
      .then((fn) => {
        un = fn;
      })
      .catch(() => undefined);
    return () => un?.();
  }, []);

  useEffect(() => {
    if (!inTauri) return;
    if (conn !== "connected") {
      setTraffic({ down: 0, up: 0 });
      setTrail([]);
      rateHist.current = [];
      return;
    }
    let alive = true;
    const read = () =>
      api
        .engineTraffic()
        .then((t) => {
          if (!alive) return;
          setTraffic({ down: t.down, up: t.up });
          setTrail((prev) => [...prev.slice(-39), t.down]);
          // X3: узел может быть быстрым по пингу и мёртвым по скорости.
          rateHist.current = pushRate(rateHist.current, t.down);
          if (autoSwitchSlow && isDegraded(rateHist.current)) {
            const now = Date.now();
            if (now - lastDegrade.current > 10 * 60 * 1000) {
              lastDegrade.current = now;
              rateHist.current = [];
              autoTickRef.current?.(true);
            }
          }
          // копим прирост суммарных счётчиков: down/up — это байты в секунду,
          // для «сколько за день» они не годятся
          if (prevTotals.current) {
            const dDown = t.total_down - prevTotals.current.down;
            const dUp = t.total_up - prevTotals.current.up;
            if (dDown > 0) statsPending.current.down += dDown;
            if (dUp > 0) statsPending.current.up += dUp;
          }
          prevTotals.current = { down: t.total_down, up: t.total_up };
        })
        .catch(() => undefined);
    read();
    const id = window.setInterval(read, 1000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [conn, autoSwitchSlow]);

  // раз в минуту сбрасываем накопленное в дневную статистику
  useEffect(() => {
    if (!inTauri) return;
    const flush = async () => {
      const { down, up } = statsPending.current;
      if (!down && !up) return;
      statsPending.current = { down: 0, up: 0 };
      const now = new Date();
      const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
        now.getDate(),
      ).padStart(2, "0")}`;
      try {
        await api.statsAdd(day, down, up);
      } catch {
        statsPending.current.down += down;
        statsPending.current.up += up;
      }
    };
    const id = window.setInterval(flush, 60_000);
    return () => {
      window.clearInterval(id);
      void flush();
    };
  }, []);

  const stopTunnel = useCallback(async (release = true) => {
    tunnelWant.current = "off";
    setError("");
    setTunnelIssue("");
    setTunnelRecovered(false);
    if (inTauri) {
      try {
        await api.engineStop(release);
      } catch (e) {
        setError(String(e));
      }
    }
    setConn("idle");
  }, []);

  /**
   * Текст ошибки запуска движка. Списки маршрутизации (.srs) качает само ядро,
   * и раньше их беды выглядели как «движок не запустился». Если блокировка ОС
   * включена, добавляем ту же подсказку, что и для подписок.
   */
  const engineErrorText = useCallback(
    (raw: string) => {
      const srs = describeSrsError(raw);
      const base = srs ?? raw;
      const blocked = ksState.state === "on" && conn !== "connected";
      return blocked ? `${base} ${t("ksBlockedNet")}` : base;
    },
    [conn, ksState.state, t],
  );

  const readNetMap = useCallback((): NetMap => {
    try {
      return JSON.parse(localStorage.getItem(NET_KEY) || "{}") as NetMap;
    } catch {
      return {};
    }
  }, []);

  const writeNetMap = useCallback((map: NetMap) => {
    try {
      localStorage.setItem(NET_KEY, JSON.stringify(map));
    } catch {
      /* приватный режим — память просто не сохранится */
    }
  }, []);

  const startTunnel = useCallback(async (onlyId?: string) => {
    tunnelWant.current = "on";
    setError("");
    setConn("connecting");
    prevTotals.current = null;
    // onlyId — «поднимай именно этот узел»: после переключения состояние ещё не
    // успело перерисоваться, и без него туннель возвращался на старый сервер.
    let targetId = onlyId ?? selectedId;
    // Память по сети: домашний узел не должен выбираться заново в кафе.
    if (inTauri) {
      try {
        const st = await api.engineStatus();
        const key = st.gateway ?? "";
        if (key) {
          const saved = recall(readNetMap(), key);
          if (!onlyId && saved && profiles.some((p) => p.id === saved)) targetId = saved;
          writeNetMap(remember(readNetMap(), key, targetId));
        }
      } catch {
        /* без шлюза память просто не включается — туннель важнее */
      }
    }
    const profile = profiles.find((p) => p.id === targetId);

    if (inTauri) {
      if (!profile) {
        setConn("error");
        setError("нет серверов: сначала загрузи подписку на экране «Серверы»");
        return;
      }
      const excluded = chosen.filter((a) => !a.via).map((a) => a.exe);
      const via = chosen.filter((a) => a.via).map((a) => a.exe);
      try {
        // Замеры могли не прийти к первому запуску: без добивки ядро получило
        // бы один узел и не смогло бы переключиться при его падении.
        const pool = fillPool(profile, smartPool(profile, profiles, lat), profiles);
        setPoolSize(pool.length || 1);
        const st = await api.engineStart(
          profile,
          pool,
          excluded,
          dnsMode === "tunnel" ? dnsServer : "",
          splitMode,
          via,
        );
        setConn(st.state === "running" ? "connected" : "error");
        if (st.state !== "running") setError(engineErrorText(st.message));
      } catch (e) {
        setConn("error");
        setError(engineErrorText(String(e)));
      }
      return;
    }

    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setConn("connected"), 1500);
  }, [chosen, profiles, selectedId, dnsMode, readNetMap, writeNetMap]);

  /**
   * Неожиданный обрыв — не повод молча остаться без VPN. Пробуем другой узел
   * и оставляем на экране причину; ручное отключение сюда не попадает.
   */
  const failover = useCallback(async (reason?: string) => {
    if (!inTauri || switching.current) return;
    if (Date.now() - lastFailover.current < 8000) return;
    lastFailover.current = Date.now();
    switching.current = true;
    const why = reason?.trim() || t("failoverEngineLost");
    setTunnelIssue(why);
    setTunnelRecovered(false);
    setError("");
    try {
      const next = pickFailover(profiles, selectedId, lat, quarantinedIds(orch));
      if (!next) {
        switching.current = false;
        setTunnelIssue(t("failoverNoAlt"));
        setError(t("failoverNoAlt"));
        setConn("idle");
        return;
      }
      setSelectedId(next.id);
      record("switch", selectedId, next.id);
      setToast({
        title: t("failoverTitle"),
        body: `${t("failoverSwitching")} ${next.name || next.host}`,
      });
      await startTunnel(next.id);
    } finally {
      window.setTimeout(() => {
        switching.current = false;
      }, 4000);
    }
  }, [inTauri, lat, orch, profiles, record, selectedId, startTunnel, t]);

  useEffect(() => {
    failoverRef.current = (reason) => void failover(reason);
    return () => {
      failoverRef.current = null;
    };
  }, [failover]);

  const issueConn = useRef(conn);
  useEffect(() => {
    // Не стираем причину сразу: человек должен увидеть, что именно оборвалось
    // и что приложение переключилось само. Баннер убирается кнопкой.
    const was = issueConn.current;
    issueConn.current = conn;
    if (conn === "connected" && was !== "connected" && tunnelIssue) setTunnelRecovered(true);
  }, [conn, tunnelIssue]);

  const retryTunnel = useCallback(() => {
    lastFailover.current = 0;
    void failover(t("failoverManual"));
  }, [failover, t]);

  const toggleConnection = useCallback(() => {
    if (busy) return;
    setBusy(true);
    const run = conn === "connected" || conn === "connecting" ? stopTunnel() : startTunnel();
    run.finally(() => setBusy(false));
  }, [busy, conn, startTunnel, stopTunnel]);

  /** Puts one program on a route; the list stays short because it holds choices only. */
  const assignApp = (exe: string, name: string, via: boolean) => {
    setChosen((prev) => [...prev.filter((c) => c.exe !== exe), { exe, name, via }]);
    if (conn === "connected") setSplitDirty(true);
  };
  const unassignApp = (exe: string) => {
    setChosen((prev) => prev.filter((c) => c.exe !== exe));
    if (conn === "connected") setSplitDirty(true);
  };

  /** New routes need a fresh tunnel: the engine reads the list on start only. */
  const reconnectTunnel = useCallback(async (onlyId?: string) => {
    setSplitDirty(false);
    // переподключение не должно открывать интернет: блокировку не снимаем
    await stopTunnel(false);
    await startTunnel(onlyId);
  }, [stopTunnel, startTunnel]);

  // Срок и остаток берём у действующей подписки: у разных подписок они разные
  const activeSub =
    subs.find((s) => s.url === subUrl && s.info) ?? subs.find((s) => s.info) ?? null;

  /** Fetches every subscription and merges the servers, keeping the selection. */
  /**
   * Текст ошибки загрузки списка: сначала понятная причина, потом слова
   * сервера. Если блокировка ОС включена, а туннель нет — сеть закрыта
   * намеренно, и об этом надо сказать прямо, иначе человек ищет баг.
   */
  const subErrorText = useCallback(
    (raw: string) => {
      const base = describeSubError(raw).text;
      const blocked = ksState.state === "on" && conn !== "connected";
      return blocked ? `${base} ${t("ksBlockedNet")}` : base;
    },
    [conn, ksState.state, t],
  );

  const loadSubscription = useCallback(
    async (explicit?: SubSource[]) => {
    setBusy(true);
    setWarnings([]);
    if (!inTauri) {
      setWarnings(["Загрузка подписки работает в приложении, а не в браузере"]);
      setBusy(false);
      return;
    }
    const sources: SubSource[] = explicit?.length
      ? explicit
      : subs.length
        ? subs
        : subUrl.trim()
          ? [{ url: subUrl.trim(), ua: subUa, name: "", refreshed: 0 }]
          : [];
    if (!sources.length) {
      setWarnings(["Сначала вставь ссылку подписки"]);
      setBusy(false);
      return;
    }

    const merged: Profile[] = [];
    const notes: string[] = [];
    const stamp = Math.floor(Date.now() / 1000);
    const refreshed: Record<string, number> = {};
    const infos: Record<string, SubInfo | null> = {};

    for (const src of sources) {
      try {
        const res = await api.fetchSub(src.url, src.ua || subUa, []);
        merged.push(...res.profiles);
        notes.push(...res.warnings);
        refreshed[src.url] = stamp;
        infos[src.url] = res.info ?? null;
      } catch (e) {
        const msg = String(e);
        notes.push(
          src.name
            ? `${src.name}: ${subErrorText(msg)}`
            : msg.includes("устройств")
              ? "Провайдер говорит «достигнут предел устройств»: удали лишнее устройство в личном кабинете или напиши в поддержку, приложив ID из настроек."
              : subErrorText(msg),
        );
      }
    }

    const seen = new Set<string>();
    const unique = merged.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
    // Узлы из подписки заменяем целиком: провайдер убрал сервер — он должен уйти
    // и у нас. Свои узлы (импорт по ссылке и WireGuard) остаются всегда.
    // Узлы без отметки `from_sub` — наследие старых версий: они пришли из подписки,
    // но отметки не имеют, поэтому тоже уходят. Свои узлы (импорт, WireGuard) помечены
    // явным `false` и остаются.
    // Разовая уборка: у узлов из старых версий отметки источника нет, поэтому
    // отличить «свой» узел от устаревшего узла подписки нельзя. Один раз
    // оставляем только свои узлы (они не из подписки) и наливаем свежий список.
    // Ключ с версией: одна и та же уборка должна отработать ровно один раз,
    // и повторный запуск уже не должен трогать ничего.
    const migrated = localStorage.getItem("k4r.migrated.subNodes.v3") === "1";
    setProfiles((prev) => {
      if (!unique.length) return prev;
      const kept = prev.filter((p) =>
        migrated ? p.from_sub === false : p.kind === "wireguard",
      );
      // Одна и та же строка не должна попасть дважды ни при каком раскладе.
      const seen = new Set<string>();
      return [...kept, ...unique].filter((p) =>
        seen.has(p.id) ? false : (seen.add(p.id), true),
      );
    });
    if (unique.length) localStorage.setItem("k4r.migrated.subNodes.v3", "1");
    setWarnings(notes);
    setSubs((prev) =>
      prev.map((s) =>
        refreshed[s.url]
          ? { ...s, refreshed: refreshed[s.url], info: infos[s.url] ?? s.info ?? null }
          : s,
      ),
    );
    if (unique.length) {
      setSelectedId((cur) => (unique.some((p) => p.id === cur) ? cur : unique[0].id));
    }
    setBusy(false);
    },
    [subUa, subUrl, subs],
  );

  const addSub = useCallback((url: string, ua: string, name: string) => {
    const clean = url.trim();
    if (!clean) return;
    setSubs((prev) =>
      prev.some((s) => s.url === clean)
        ? prev
        : [...prev, { url: clean, ua: ua || DEFAULT_UA, name: name.trim(), refreshed: 0 }],
    );
  }, []);

  const removeSub = useCallback((url: string) => {
    setSubs((prev) => prev.filter((s) => s.url !== url));
  }, []);

  const exportLog = useCallback(async () => {
    try {
      const path = await api.exportLog();
      setWarnings([`Журнал сохранён: ${path}`]);
      return path;
    } catch (e) {
      setWarnings([String(e)]);
      return "";
    }
  }, []);

  // Подписка обновляется сама с выбранным в настройках шагом. Раньше здесь
  // стояли жёсткие 12 часов, и выбор «каждые 3 часа» ничего не менял.
  useEffect(() => {
    if (!inTauri || !loaded || subRefreshHours <= 0) return;
    const id = window.setInterval(() => loadSubscription(), subRefreshHours * 60 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [loaded, loadSubscription, subRefreshHours]);

  // Туннель поднялся, а серверов нет: подписку могли не пустить напрямую
  // (домен режут по SNI), но через туннель она открывается. Одна повторная
  // попытка — без циклов, чтобы не долбить панель.
  const subRetried = useRef(false);
  useEffect(() => {
    if (conn !== "connected" || !subUrl || profiles.length > 0) return;
    if (subRetried.current) return;
    subRetried.current = true;
    void loadSubscription();
  }, [conn, subUrl, profiles.length, loadSubscription]);

  const importLinks = useCallback(async (text: string) => {
    if (!inTauri) {
      setWarnings(["Импорт работает в приложении, а не в браузере"]);
      return;
    }
    try {
      const imported = await api.profilesImport(text);
      setProfiles((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        const merged = [...prev, ...imported.filter((p) => !seen.has(p.id))];
        setSelectedId((cur) => (merged.some((p) => p.id === cur) ? cur : merged[0].id));
        return merged;
      });
      setWarnings([]);
    } catch (e) {
      setWarnings([String(e)]);
    }
  }, []);

  const measurePing = useCallback(async () => {
    if (!inTauri || profiles.length === 0) return undefined;
    try {
      const res = await api.probePing(profiles);
      const next: Record<string, number | null> = {};
      for (const r of res) next[r.id] = r.ms;
      const stamp: Record<string, number> = {};
      const now = Date.now();
      for (const r of res) stamp[r.id] = now;
      setLat(next);
      setSparks((prev) => res.reduce((acc, r) => pushSpark(acc, r.id, r.ms), prev));
      setLatAt(stamp);
      try {
        localStorage.setItem("k4r.latAt", JSON.stringify(stamp));
      } catch {
        /* метка не критична: без неё точки просто серые */
      }
      return next;
    } catch (e) {
      setWarnings([String(e)]);
      return undefined;
    }
  }, [profiles]);

  // «Все молчат» — отдельный диагноз, а не ошибка движка. Показываем только на
  // полном и свежем замере: неполный список не даёт права объявлять провайдера
  // мёртвым, а старый замер — это «давно не спрашивали».
  const dead = useMemo(
    () => poolDead(profiles.map((p) => p.id), lat, latAt),
    [profiles, lat, latAt],
  );
  const lastOk = useMemo(() => lastAliveAt(lat, latAt), [lat, latAt]);
  const checkNodes = useCallback(async () => {
    setNodesBusy(true);
    try {
      await measurePing();
    } finally {
      setNodesBusy(false);
    }
  }, [measurePing]);

  // A server that does not answer must be visible as such, not discovered by a
  // failed connection. Runs once per server list, in the background.
  useEffect(() => {
    if (!inTauri || profiles.length === 0) return;
    const timer = window.setTimeout(() => void measurePing(), 800);
    return () => window.clearTimeout(timer);
  }, [profiles, measurePing]);

  // Серверы отваливаются и возвращаются сами. Без повторного замера «не
  // отвечает» залипает навсегда, хотя узел уже жив — и человек выбирает наугад.
  // Тот же проход, если включён тумблер, уводит с просевшего узла.
  useEffect(() => {
    if (!inTauri || profiles.length === 0) return;
    const tick = async () => {
      const measured = (await measurePing()) ?? lat;
      if (!autoSwitchSlow || conn !== "connected" || switching.current) return;
      // Порог 40 мс и правило выбора живут в health.ts: там же их тесты.
      const targetId = slowSwitchTarget(selectedId, measured);
      if (!targetId) return;
      const best = profiles.find((p) => p.id === targetId);
      if (!best) return;
      const name = best.name || best.host;
      setSelectedId(targetId);
      setToast({
        title: t("autoSwitchSlow"),
        body: `${t("slowSwitched")} ${name} · ${measured[targetId]} мс`,
      });
      await reconnectTunnel();
    };
    const timer = window.setInterval(() => void tick(), 10 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [
    autoSwitchSlow, conn, lat, measurePing, profiles, reconnectTunnel, selectedId, t,
  ]);

  /**
   * Один проход автовыбора: замер всех серверов → решение → переподключение.
   * Замер идёт по TCP-рукопожатию, трафика не тратит и сервер не нагружает.
   */
  const autoTick = useCallback(
    async (force = false) => {
      if (!inTauri || profiles.length < 2 || conn !== "connected") return;
      if (switching.current) return;
      // Активную закачку не рвём: 2 МБ/с в обе стороны — это заметный трафик.
      if (!force) {
        try {
          const speed = await api.engineTraffic();
          if (isBusy(speed.down + speed.up)) {
            setToast({ title: t("autoSelect"), body: t("busyLater") });
            return;
          }
        } catch {
          /* нет счётчиков — считаем, что не занято */
        }
      }
      const measured = (await measurePing()) ?? lat;
      const all = profiles.map((p) => ({ id: p.id, ms: measured[p.id] ?? null }));
      // Серверы в карантине не рассматриваем: за них уже проголосовали провалы.
      const blocked = quarantinedIds(orch);
      const usable = all.filter((m) => !blocked.has(m.id));
      // Резерв — последний шанс: сначала основные, и только если их нет, резервные.
      const reserveIds = new Set(profiles.filter((p) => p.reserve).map((p) => p.id));
      const { main, reserve } = splitReserve(usable, reserveIds);
      const mainAlive = main.filter((m) => typeof m.ms === "number");
      const pool = mainAlive.length > 0 ? main : reserve;
      const target =
        blocked.has(selectedId) && pool.length > 0
          ? pickServer(undefined, pool)
          : pickServer({ id: selectedId, ms: measured[selectedId] ?? null }, pool);
      if (!target || target === selectedId) return;
      const chosen = profiles.find((p) => p.id === target);
      if (!chosen) return;
      switching.current = true;
      setSelectedId(target);
      setToast({
        title: t("autoSelect"),
        body: `${t("autoSelectSwitched")} ${chosen.name || chosen.host}`,
      });
      {
        const from = profiles.find((p) => p.id === selectedId);
        const stamp = new Date().toLocaleString();
        const line = `${stamp}  ${from?.name || selectedId} -> ${chosen.name || chosen.host}`;
        api.autoHistoryAdd(line).then(setAutoHistory).catch(() => undefined);
        record("switch", selectedId, target);
      }
      try {
        await reconnectTunnel(target);
      } finally {
        window.setTimeout(() => {
          switching.current = false;
        }, 4000);
      }
    },
    [conn, lat, measurePing, orch, profiles, reconnectTunnel, record, selectedId, t],
  );

  // Просадка скорости приходит из секундного опроса, а переключение живёт здесь:
  // ссылка разрывает круг зависимостей, не создавая второй таймер.
  useEffect(() => {
    autoTickRef.current = (force) => void autoTick(force);
    return () => {
      autoTickRef.current = null;
    };
  }, [autoTick]);

  /**
   * Замер всех узлов → самый быстрый. Один и тот же путь для игрового режима
   * и для автостарта игры: разные поводы, одно решение.
   */
  const pickFastestNode = useCallback(
    async (title: string) => {
      if (!inTauri || profiles.length < 2) return;
      const measured = (await measurePing()) ?? lat;
      const alive = profiles
        .map((p) => ({ p, ms: measured[p.id] }))
        .filter((x): x is { p: Profile; ms: number } => typeof x.ms === "number");
      if (alive.length === 0) {
        setToast({ title, body: t("gameNoPing") });
        return;
      }
      const best = alive.reduce((a, b) => (a.ms <= b.ms ? a : b));
      const name = best.p.name || best.p.host;
      if (best.p.id === selectedId) {
        setToast({ title, body: `${t("gameFastest")} ${name} · ${best.ms} мс` });
        return;
      }
      setSelectedId(best.p.id);
      setToast({ title, body: `${t("gamePicked")} ${name} · ${best.ms} мс` });
      // Переподключаемся только если туннель уже стоит: рвать ручное
      // подключение ради замера нельзя.
      if (conn === "connected") await reconnectTunnel();
    },
    [conn, lat, measurePing, profiles, reconnectTunnel, selectedId, t],
  );

  /**
   * Игровой режим включают перед игрой, и в этот момент честнее выбрать узел
   * по замеру, чем оставить тот, что был выбран для браузера.
   */
  const toggleGameMode = useCallback(
    async (on: boolean) => {
      setGameMode(on);
      if (on) await pickFastestNode(t("gameTitle"));
    },
    [pickFastestNode, t],
  );

  /**
   * Игра запустилась сама — узел под неё тоже стоит выбрать самому. Снимок
   * процессов дешёвый, поэтому опрос раз в 15 секунд ничего не стоит.
   */
  const gameWatch = useRef<Set<string>>(new Set());
  const pickFastestRef = useRef(pickFastestNode);
  pickFastestRef.current = pickFastestNode;
  useEffect(() => {
    if (!inTauri || chosen.length === 0) return;
    const wanted = chosen.map((c) => ({
      key: c.exe.toLowerCase(),
      base: c.exe.split(/[\/]/).pop()?.toLowerCase() ?? c.exe.toLowerCase(),
      name: c.name,
    }));
    let alive = true;
    const tick = async () => {
      let running: Set<string>;
      try {
        running = new Set(await api.runningExes());
      } catch {
        return; // нет снимка — молчим, это не ошибка для человека
      }
      if (!alive) return;
      for (const w of wanted) {
        const on = running.has(w.base);
        const was = gameWatch.current.has(w.key);
        if (on && !was) {
          gameWatch.current.add(w.key);
          void pickFastestRef.current(`${t("gameStart")}: ${w.name}`);
        } else if (!on && was) {
          gameWatch.current.delete(w.key);
        }
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 15_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [chosen, t]);

  /**
   * Проба «туннель реально работает». Ловит самую частую беду: соединение
   * поднято, а трафик молча выкидывается провайдером (silent drop).
   */
  const probeTunnel = useCallback(async () => {
    if (!inTauri || conn !== "connected") {
      wd.current = WATCHDOG_START;
      return;
    }
    const current = profiles.find((p) => p.id === selectedId);
    if (!current) return;
    const res = await probeOnce();
    // Ядро могло умереть, а галочка «connected» осталась: без этой проверки
    // сторож честно ждал бы второй пробы, хотя трафика нет вовсе.
    let coreAlive = true;
    try {
      const state = (await api.engineStatus()).state;
      // «starting» — это штатный перезапуск супервизором, а не мёртвое ядро:
      // иначе сторож дублирует перезапуск и обрывает только что поднятый туннель.
      coreAlive = state === "running" || state === "starting";
    } catch {
      coreAlive = true; // статус не спросили — это не приговор движку
    }
    const next = watchdogStep({ connected: true, coreAlive, probeOk: res.ok, state: wd.current });
    wd.current = next.state;
    if (res.ok) {
      const rows = await api.orchestratorRecord(pairKey(current), true, res.ms).catch(() => undefined);
      if (rows) setOrch(rows);
      return;
    }
    if (next.action === "wait") return;
    if (next.action === "giveup") {
      wd.current = WATCHDOG_START;
      setError(t("wdGaveUp"));
      await stopTunnel();
      return;
    }
    const rows = await api.orchestratorRecord(pairKey(current), false, 0).catch(() => undefined);
    if (rows) setOrch(rows);
    setToast({ title: t("autoSelect"), body: t("orchDead") });
    // «На другой узел»: текущий уже под подозрением, берём лучший из остальных.
    const others = profiles
      .filter((p) => p.id !== selectedId && typeof lat[p.id] === "number")
      .sort((a, b) => (lat[a.id] ?? Number.MAX_SAFE_INTEGER) - (lat[b.id] ?? Number.MAX_SAFE_INTEGER));
    const target = others[0] ?? profiles.find((p) => p.id !== selectedId);
    if (!target) {
      await reconnectTunnel();
      return;
    }
    setSelectedId(target.id);
    record("switch", selectedId, target.id);
    await reconnectTunnel(target.id);
  }, [conn, lat, profiles, reconnectTunnel, record, selectedId, stopTunnel, t]);

  // Пока туннель поднят — раз в 15 секунд проверяем, что интернет реально идёт.
  useEffect(() => {
    if (!inTauri || conn !== "connected") {
      wd.current = WATCHDOG_START;
      return;
    }
    const id = window.setInterval(() => void probeTunnel(), 15_000);
    const first = window.setTimeout(() => void probeTunnel(), 4_000);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(first);
    };
  }, [conn, probeTunnel]);

  // Таймер: перемеряем раз в N минут, пока туннель поднят.
  useEffect(() => {
    if (!inTauri || autoSelect <= 0) return;
    const id = window.setInterval(() => void autoTick(), autoSelect * 60 * 1000);
    return () => window.clearInterval(id);
  }, [autoSelect, autoTick]);

  // Триггер «при потере соединения»: туннель сам упал — сразу ищем живой сервер,
  // не дожидаясь таймера. Явное отключение человеком сюда не попадает.
  const wasConnected = useRef(false);
  useEffect(() => {
    if (!inTauri || !autoSelectLoss) {
      wasConnected.current = conn === "connected";
      return;
    }
    if (wasConnected.current && conn !== "connected" && !switching.current) {
      void autoTick(true);
    }
    wasConnected.current = conn === "connected";
  }, [autoSelectLoss, autoTick, conn]);

  // Звук состояния: подключились — короткий сигнал, оборвались — низкий тон.
  const prevConnSound = useRef<ConnState | null>(null);
  useEffect(() => {
    const was = prevConnSound.current;
    if (was && was !== conn) {
      // Мотив зависит от страны узла: страну видно и на слух
      if (conn === "connected") playConnected(selected?.flag || selected?.cc);
      if (conn === "error") play("error");
      if (conn === "idle" && was === "connected") play("disconnect");
    }
    prevConnSound.current = conn;
  }, [conn, selected]);

  // Kill-switch на уровне ОС: спрашиваем helper и слушаем надзор.
  useEffect(() => {
    if (!inTauri) return;
    const poll = () =>
      api
        .killSwitchStatus()
        .then((st) => {
          setKsState(st);
          // Защиту снял сбой, а не человек: галка не должна врать.
          if (st.state === "lost") setKillSwitch(false);
        })
        .catch((e) =>
          setKsState({ state: "unavailable", tun: false, filters: 0, message: String(e) }),
        );
    void poll();
    api.autoHistoryGet().then(setAutoHistory).catch(() => undefined);
    api.orchestratorList().then(setOrch).catch(() => undefined);
    const id = window.setInterval(poll, 3000);
    let un: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<string>("killswitch", (e) => {
          setKsState((prev) => ({
            ...prev,
            state: e.payload === "lost" ? "lost" : e.payload === "on" ? "on" : "restarting",
          }));
          if (e.payload === "lost") setKillSwitch(false);
        }),
      )
      .then((fn) => {
        un = fn;
      })
      .catch(() => undefined);
    return () => {
      window.clearInterval(id);
      un?.();
    };
  }, []);

  // --- automatic subscription refresh ---------------------------------------
  // The server list goes stale: providers rotate hosts and add servers. A timer
  // keeps it fresh by itself when the owner asked for it.
  const refreshing = useRef(false);
  useEffect(() => {
    if (!inTauri || subRefreshHours <= 0) return;
    const due = () => {
      if (refreshing.current || busy) return;
      const stamp = Math.floor(Date.now() / 1000);
      const limit = subRefreshHours * 3600;
      const sources = subs.length ? subs : subUrl.trim() ? [{ url: subUrl, refreshed: 0 }] : [];
      if (!sources.length) return;
      const oldest = Math.min(...sources.map((s) => s.refreshed || 0));
      if (stamp - oldest < limit) return;
      refreshing.current = true;
      void loadSubscription().finally(() => {
        refreshing.current = false;
      });
    };
    due();
    const id = window.setInterval(due, 60_000);
    return () => window.clearInterval(id);
  }, [subs, subUrl, subRefreshHours, busy, loadSubscription]);

  // --- global hotkey ---------------------------------------------------------
  const toggleRef = useRef(toggleConnection);
  toggleRef.current = toggleConnection;

  useEffect(() => {
    if (!inTauri || !hotkey.trim()) return;
    let alive = true;
    let stop: (() => void) | null = null;
    (async () => {
      try {
        const { register, unregister } = await import("@tauri-apps/plugin-global-shortcut");
        const { unregisterAll } = await import("@tauri-apps/plugin-global-shortcut");
        await unregisterAll().catch(() => undefined);
        if (!alive) return;
        const accelerator = toAccelerator(hotkey);
        if (!accelerator) {
          setError("горячая клавиша записана непонятно: нужен вид Ctrl+Alt+V");
          return;
        }
        await register(accelerator, (event) => {
          if (event.state === "Pressed") toggleRef.current();
        });
        stop = () => {
          unregister(accelerator).catch(() => undefined);
        };
      } catch (e) {
        setError(`горячая клавиша «${hotkey}» не сработала: ${e}`);
      }
    })();
    return () => {
      alive = false;
      stop?.();
    };
  }, [hotkey]);

  // --- notifications ---------------------------------------------------------
  // One channel only: our own card in the corner of the window.
  const prevConn = useRef<ConnState>(conn);
  useEffect(() => {
    const was = prevConn.current;
    prevConn.current = conn;
    if (!notifyOn || was === conn) return;
    if (conn !== "connected" && conn !== "error") return;
    const title = conn === "connected" ? t("notifyOnTitle") : t("notifyOffTitle");
    const body =
      conn === "connected"
        ? `${t("notifyOnBody")} ${selected?.city ?? ""}`.trim()
        : error || t("notifyOffBody");
    // The owner chose one channel only: the card in the corner. Windows toasts
    // were tried and proved unreliable for a portable exe anyway.
    setToast({ title, body });
  }, [conn, notifyOn, selected, error, t]);

  // Zapret не поднялся при автозапуске: говорим об этом тостом и красной
  // плашкой, а не оставляем человека с выключенной защитой и без объяснений.
  useEffect(() => {
    if (!inTauri) return;
    let alive = true;
    let un: (() => void) | null = null;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      if (!alive) return;
      un = await listen<string>("zapret-failed", (e) => {
        setZapretState("error");
        setToast({ title: t("zapretFailed"), body: e.payload });
      });
    })().catch(() => undefined);
    return () => {
      alive = false;
      un?.();
    };
  }, [t]);

  // Автозапуск не зарегистрировался (политика, планировщик): не молчим.
  useEffect(() => {
    if (!inTauri) return;
    let alive = true;
    let un: (() => void) | null = null;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      if (!alive) return;
      un = await listen<string>("autostart-failed", (e) => {
        setToast({ title: t("autostartFailed"), body: e.payload });
      });
    })().catch(() => undefined);
    return () => {
      alive = false;
      un?.();
    };
  }, [t]);

  useEffect(() => {
    api.appVersion().then(setVer).catch(() => undefined);
  }, []);

  // Тихая проверка обновлений: один раз за запуск, через 12 секунд после старта,
  // чтобы не мешать подключению. При включённой защите без VPN сеть закрыта —
  // тогда молчим, обход защиты не делаем.
  useEffect(() => {
    if (autoUpd.current) return;
    autoUpd.current = true;
    const id = window.setTimeout(async () => {
      if (!updateUrl.trim()) return;
      if (killSwitch && conn !== "connected") return;
      try {
        const res = await api.updateCheck(updateUrl, ver || (await api.appVersion()));
        if (!res) return;
        const skipped = localStorage.getItem("k4r-skip-update");
        if (skipped === res.version) return;
        setUpd({ version: res.version, url: res.url, sha256: res.sha256 });
      } catch {
        // нет сети или адрес не задан — это не ошибка для человека
      }
    }, 12000);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startUpdate = async () => {
    if (!upd || updBusy) return;
    setUpdBusy(true);
    setToast({ title: t("updReadyTitle"), body: t("updInstalling") });
    try {
      const path = await api.updateDownload(upd.url, upd.sha256);
      await api.updateInstall(path);
    } catch (e) {
      setUpdBusy(false);
      setToast({ title: t("updReadyTitle"), body: String(e) });
    }
  };

  // the card fades away by itself, like a toast should
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(id);
  }, [toast]);

  // --- minimize must land in the tray ---------------------------------------
  // The Rust side watches the window event, but WebView2 does not always report
  // it, so we ask the window itself right after a resize.
  useEffect(() => {
    if (!inTauri || !win) return;
    let stop: (() => void) | undefined;
    let alive = true;
    (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const un = await getCurrentWindow().onResized(async () => {
        if (!minimizeToTray) return;
        try {
          if (await getCurrentWindow().isMinimized()) await getCurrentWindow().hide();
        } catch {
          /* nothing to hide */
        }
      });
      if (alive) stop = un;
      else un();
    })();
    return () => {
      alive = false;
      stop?.();
    };
  }, [minimizeToTray]);

  // --- installed programs for split tunneling --------------------------------
  useEffect(() => {
    if (!inTauri || !loaded) return;
    setScanning(true);
    api
      .appsScan()
      .then((found) => {
        setCatalog(
          found.map((f) => ({
            id: f.exe,
            name: f.name || f.exe.replace(/\.exe$/i, ""),
            exe: f.exe,
            via: false,
            running: f.running,
          })),
        );
      })
      .catch(() => undefined)
      .finally(() => setScanning(false));
  }, [loaded]);

  /** Переключатель kill-switch: сначала команда helper'у, потом состояние. */
  const setKillSwitchNow = useCallback(async (next: boolean) => {
    if (!inTauri) {
      setKillSwitch(next);
      return;
    }
    try {
      const st = await api.killSwitchSet(next);
      setKillSwitch(next);
      setKsState(st);
      setError("");
    } catch (e) {
      setKsState({ state: "unavailable", tun: false, filters: 0, message: String(e) });
      setError(String(e));
    }
  }, []);

  /** Какой сценарий соответствует текущим настройкам (или null). */
  const scenarioNow: ScenarioSettings = { autoSwitchSlow, blockIpv6, dnsMode, gameMode, splitMode };
  const scenarioId = activeScenario(scenarioNow);
  /** Защита от двойного клика: второй перезапуск подряд рвёт соединение зря. */
  const scenarioBusy = useRef(false);
  const applyScenario = (id: ScenarioId) => {
    if (scenarioBusy.current) return;
    const sc = scenarioById(id);
    if (!sc) return;
    const diff = changedKeys(scenarioNow, sc.settings);
    if (diff.length === 0) {
      setToast({ title: t("scTitle"), body: t("scAlready") });
      return;
    }
    // split_mode и DNS ядро читает только при старте, поэтому поднятый туннель
    // перезапускаем сразу: иначе кнопка «сработала», а поведение прежнее
    const needsRestart = diff.includes("splitMode") || diff.includes("dnsMode");
    setAutoSwitchSlow(sc.settings.autoSwitchSlow);
    setBlockIpv6(sc.settings.blockIpv6);
    setDnsMode(sc.settings.dnsMode);
    setGameMode(sc.settings.gameMode);
    setSplitMode(sc.settings.splitMode);
    play("click");
    setToast({ title: t("scTitle"), body: `${t(sc.titleKey)} — ${t("scApplied")}` });
    if (needsRestart && conn === "connected") {
      scenarioBusy.current = true;
      window.setTimeout(() => {
        void reconnectTunnel().finally(() => {
          scenarioBusy.current = false;
        });
      }, 120);
    }
  };

  /**
   * Данные для «проверки одной кнопкой». Собираем здесь, потому что состояние
   * размазано по App; сама логика — в selfcheck.ts, она под тестами.
   */
  const selfCheck = () => {
    const measured = Object.keys(lat);
    const alive = measured.filter((id) => typeof lat[id] === "number").length;
    return buildReport({
      servers: profiles.length,
      alive,
      measured: measured.length,
      conn,
      subExpire: activeSub?.info?.expire ?? 0,
      subTotal: activeSub?.info?.total ?? 0,
      subUsed: (activeSub?.info?.upload ?? 0) + (activeSub?.info?.download ?? 0),
      killSwitchOn: killSwitch,
      ksState: ksState.state,
      splitMode,
      splitCount: chosen.length,
      now: Date.now(),
    });
  };

  const ctx = {
    t,
    lang,
    conn,
    /// id -> ms, null means the server did not answer at all
    lat,
    /// id -> когда мерили (мс эпохи)
    latAt,
    /// id -> история замеров для спарклайна
    sparks,
    toggleConnection,
    selected,
    servers: viewServers,
    selectedId,
    setSelectedId,
    catalog,
    chosen,
    assignApp,
    unassignApp,
    scanning,
    connState: conn,
    splitDirty,
    reconnectTunnel,
    mode: splitMode,
    setMode: (m: "only" | "all") => {
      setSplitMode(m);
      setSplitDirty(true);
    },
    presets: splitPresets,
    setPresets: setSplitPresets,
    favorites,
    toggleFavorite,
    applyPreset: (apps: ChosenApp[]) => {
      setChosen(apps.map((a) => ({ exe: a.exe, name: a.name, via: a.via })));
      setSplitDirty(true);
    },
  };

  // Аврора: состояние важнее трафика. Кольцо блокировки — только когда
  // туннель выключен, иначе «защита» красила бы фон при каждом обрыве.
  const auroraPhase: AuroraPhase =
    conn === "connected"
      ? "connected"
      : conn === "connecting"
        ? "connecting"
        : conn === "error"
          ? "error"
          : killSwitch && ksState.state === "on"
            ? "guard"
            : "idle";

  return (
    <div className="shell">
      {splash && <Splash />}
      {!splash && onboard && <Onboarding t={t} onDone={() => setOnboard(false)} />}
      {auroraOn && <Aurora phase={auroraPhase} down={traffic.down} up={traffic.up} />}
      <header className="titlebar" data-tauri-drag-region>
        <div className="brand">
          <img src="/mascot/glyph-on.png" alt="" />
          <span>K4R Neko VPN</span>
        </div>
        <div className="spacer" />
        <button className="winbtn" aria-label="minimize" onClick={() => win?.minimize()}>
          <MinIcon size={16} />
        </button>
        <button className="winbtn" aria-label="maximize" onClick={() => win?.toggleMaximize()}>
          <MaxIcon size={14} />
        </button>
        <button className="winbtn close" aria-label="close" onClick={() => win?.close()}>
          <CloseIcon size={14} />
        </button>
      </header>

      {upd && (
        <div className="banner">
          <span>
            <b>{t("updReadyTitle")}</b> {upd.version} — {t("updReadyBody")}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" style={{ width: "auto", paddingInline: 14 }} disabled={updBusy} onClick={startUpdate}>
              {updBusy ? "…" : t("updInstall")}
            </button>
            <button
              className="ghost-btn"
              onClick={() => {
                localStorage.setItem("k4r-skip-update", upd.version);
                setUpd(null);
              }}
            >
              {t("updLater")}
            </button>
          </div>
        </div>
      )}

      {tunnelIssue && (
        <div className="banner tunnel-banner" data-recovered={tunnelRecovered ? "true" : undefined} role="alert">
          <span>
            <b>{t(tunnelRecovered ? "failoverRecoveredTitle" : "failoverTitle")}</b> {tunnelIssue}
          </span>
          {tunnelRecovered ? (
            <button
              className="btn"
              style={{ width: "auto", paddingInline: 14 }}
              onClick={() => {
                setTunnelIssue("");
                setTunnelRecovered(false);
              }}
            >
              {t("failoverDismiss")}
            </button>
          ) : (
            <button className="btn" style={{ width: "auto", paddingInline: 14 }} onClick={retryTunnel}>
              {t("failoverRetry")}
            </button>
          )}
        </div>
      )}

      <div className="body">
        <nav className="rail">
          {navItems.map(({ id, key, icon: Icon }) => (
            <button
              key={id}
              className={`nav${screen === id ? " active" : ""}`}
              onClick={() => setScreen(id)}
              aria-label={t(key)}
            >
              <Icon size={20} />
              <span className="label">{t(key)}</span>
            </button>
          ))}
          <div className="grow" />
        </nav>

        <main className="content">
          <MascotHint
            screen={screen}
            text={t(HINT_KEY[screen] ?? "hintHome")}
            pose={HINT_POSE[screen] ?? 1}
          />
          {screen === "home" && (
            <HomeScreen
              {...ctx}
              error={error}
              zapretState={zapretState}
              down={traffic.down}
              up={traffic.up}
              trail={trail}
              poolSize={poolSize}
              killSwitch={killSwitch}
              killSwitchActive={ksState.state === "on"}
              splitMode={splitMode}
              blocked={false}
              ip={ip}
              ipBusy={ipBusy}
              exitCc={conn === "connected" ? exit?.country ?? "" : ""}
              exitCity={conn === "connected" ? exit?.city ?? "" : ""}
              exitOrg={conn === "connected" ? exit?.org ?? "" : ""}
              onCheckIp={checkIp}
              onOpenSplit={() => setScreen("split")}
              onOpenZapret={() => setScreen("zapret")}
              onOpenSettings={() => setScreen("settings")}
              onOpenServers={() => setScreen("servers")}
              onRefreshServers={loadSubscription}
              onAutoPick={async () => {
                const measured = (await measurePing()) ?? lat;
                const best = [...viewServers].sort((a, b) => {
                  const la = measured[a.id] ?? Number.MAX_SAFE_INTEGER;
                  const lb = measured[b.id] ?? Number.MAX_SAFE_INTEGER;
                  return la - lb;
                })[0];
                if (best) setSelectedId(best.id);
              }}
              dead={dead}
              lastAliveAt={lastOk}
              onCheckNodes={checkNodes}
              nodesBusy={nodesBusy}
              realCount={profiles.length}
              scenario={scenarioId}
              onScenario={applyScenario}
              subExpire={activeSub?.info?.expire ?? 0}
              subTotal={activeSub?.info?.total ?? 0}
              subUsed={(activeSub?.info?.upload ?? 0) + (activeSub?.info?.download ?? 0)}
            />
          )}
          {screen === "servers" && (
            <ServersScreen
              {...ctx}
              subUrl={subUrl}
              subUa={subUa}
              setSubUrl={setSubUrl}
              setSubUa={setSubUa}
              onLoad={loadSubscription}
              onImport={importLinks}
              onPing={measurePing}
              warnings={warnings}
              busy={busy}
              realCount={profiles.length}
              subs={subs}
              addSub={addSub}
              removeSub={removeSub}
              onToggleReserve={toggleReserve}
              onAddWireguard={addWireguard}
            />
          )}
          {screen === "split" && (
            <>
              <div className="page-head">
                <h1>{t("splitTitle")}</h1>
                <p>{t("splitSub")}</p>
              </div>
              <Seg
                items={[
                  { id: "apps", label: t("tabApps") },
                  { id: "rules", label: t("tabRules") },
                ]}
                value={routesTab}
                onChange={setRoutesTab}
              />
              {routesTab === "apps" ? (
                <SplitScreen {...ctx} head={false} />
              ) : (
                <RouteScreen
                  t={t}
                  head={false}
                  rules={rules}
                  setRules={setRules}
                  ruDirect={routeRu}
                  setRuDirect={setRouteRu}
                  blockAds={routeAds}
                  setBlockAds={setRouteAds}
                  connected={conn === "connected"}
                  onReconnect={reconnectTunnel}
                  city={selected.city}
                  country={selected.country}
                  guard={zapretState === "running"}
                />
              )}
            </>
          )}
          {screen === "stats" && (
            <>
              <Seg
                items={[
                  { id: "stats", label: t("navStats") },
                  { id: "history", label: t("navHistory") },
                ]}
                value={analyticsTab}
                onChange={setAnalyticsTab}
              />
              {analyticsTab === "stats" ? (
                <StatsScreen t={t} head={false} />
              ) : (
                <HistoryScreen
                  t={t}
                  lang={lang}
                  head={false}
                  events={events}
                  nameOfId={(id) => {
                    const v = viewServers.find((x) => x.id === id);
                    if (v) return v.city || v.country || v.tag || id;
                    // узел мог уйти из подписки: остался только id. Две буквы —
                    // это код страны, покажем страну, а не «jp»
                    if (/^[a-z]{2}$/i.test(id)) return nameOf(id.toLowerCase()) || id;
                    return id;
                  }}
                  onSave={async (csv) => {
                    try {
                      const path = await api.exportText("history", csv);
                      setWarnings([`История сохранена: ${path}`]);
                    } catch (e) {
                      setWarnings([String(e)]);
                    }
                  }}
                  onClear={() => {
                    setEvents([]);
                    localStorage.removeItem("k4r.history");
                  }}
                />
              )}
            </>
          )}
          {screen === "zapret" && (
            <ZapretScreen
              t={t}
              initialDir={zapretDir}
              savedPreset={zapretPreset}
              onPreset={setZapretPreset}
              auto={zapretAuto}
              setAuto={setZapretAuto}
              tgProxy={tgProxy}
              setTgProxy={setTgProxy}
              tgPort={1354}
            />
          )}
          {screen === "logs" && (
            <LogsScreen t={t} error={error} onExport={exportLog} />
          )}
          {screen === "settings" && (
            <SettingsScreen
              t={t}
              lang={lang}
              setLang={setLang}
              aurora={auroraOn}
              setAurora={(v) => {
                setAuroraOn(v);
                writeAurora(v);
              }}
              selfCheck={selfCheck}
              killSwitch={killSwitch}
              setKillSwitch={setKillSwitchNow}
              ksState={ksState}
              connected={conn === "connected"}
              autoSelect={autoSelect}
              setAutoSelect={setAutoSelect}
              autoHistory={autoHistory}
              orch={orch}
              serverNames={Object.fromEntries(
                profiles.map((pr) => [pr.id, pr.name || pr.host]),
              )}
              onOrchReset={() => api.orchestratorReset().then(setOrch).catch(() => undefined)}
              autoSelectLoss={autoSelectLoss}
              autoSwitchSlow={autoSwitchSlow}
              setAutoSwitchSlow={setAutoSwitchSlow}
              setAutoSelectLoss={setAutoSelectLoss}
              autostart={autostart}
              startMinimized={startMinimized}
              setStartMinimized={setStartMinimized}
              connectOnStart={connectOnStart}
              setConnectOnStart={setConnectOnStart}
              setAutostart={setAutostart}
              dnsMode={dnsMode}
              setDnsMode={setDnsMode}
              dnsServer={dnsServer}
              setDnsServer={setDnsServer}
              blockIpv6={blockIpv6}
              gameMode={gameMode}
              setGameMode={toggleGameMode}
              gamePorts={gamePorts}
              setGamePorts={setGamePorts}
              setBlockIpv6={setBlockIpv6}
              closeToTray={closeToTray}
              setCloseToTray={setCloseToTray}
              minimizeToTray={minimizeToTray}
              setMinimizeToTray={setMinimizeToTray}
              notifyOn={notifyOn}
              setNotifyOn={setNotifyOn}
              hotkey={hotkey}
              setHotkey={setHotkey}
              onExportLog={exportLog}
              onDeviceId={setDeviceId}
              subRefreshHours={subRefreshHours}
              setSubRefreshHours={setSubRefreshHours}
              updateUrl={updateUrl}
              setUpdateUrl={setUpdateUrl}
              onSaveReport={async (report) => {
                try {
                  const path = await api.exportText("selfcheck", report, "txt");
                  setWarnings([`Отчёт сохранён: ${path}`]);
                } catch (e) {
                  setWarnings([String(e)]);
                }
              }}
            />
          )}
        </main>
      </div>

      {toast && (
        <button className="toast" onClick={() => setToast(null)}>
          <img src="/mascot/glyph-on.png" alt="" />
          <span>
            <b>{toast.title}</b>
            <span>{toast.body}</span>
          </span>
        </button>
      )}
    </div>
  );
}
