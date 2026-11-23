import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
import "@fontsource-variable/manrope";
import { useT, type Lang } from "./i18n";
import { servers as demoCatalog, type AppEntry, type ConnState, type Server } from "./data";
import { ccFromName, knownCc, nameOf, stripCc } from "./flags";
import type { ChosenApp, KillSwitchStatus, OrchRow, RouteRule } from "./api";
import { isBusy, pickServer, splitReserve } from "./autoSelect";
import { slowSwitchTarget } from "./health";
import { parseEvents, pushEvent, serializeEvents, type HistoryEvent } from "./history";
import { HistoryScreen } from "./screens/History";
import { activeScenario, changedKeys, scenarioById, type ScenarioId, type ScenarioSettings } from "./scenarios";
import { buildReport } from "./selfcheck";
import { pairKey, quarantinedIds } from "./orchestrator";
import { probeOnce } from "./probe";
import { describe as describeSubError } from "./subError";
import { describe as describeSrsError } from "./srsError";
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
  { id: "split", key: "navSplit", icon: SplitIcon },
  { id: "route", key: "navRoute", icon: RouteIcon },
  { id: "zapret", key: "navZapret", icon: ShieldIcon },
  { id: "stats", key: "navStats", icon: RouteIcon },
  { id: "history", key: "navHistory", icon: LogIcon },
  { id: "logs", key: "navLogs", icon: LogIcon },
  { id: "settings", key: "navSettings", icon: GearIcon },
];

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
  const [screen, setScreen] = useState<Screen>((initial.get("screen") as Screen) || "home");
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
  /// routes changed while the tunnel is up: engine reads them only on start
  const [splitDirty, setSplitDirty] = useState(false);
  /// "only" = tunnel carries just the chosen programs (the owner's default)
  const [splitMode, setSplitMode] = useState<"only" | "all">("only");
  // правила маршрутизации: домены/адреса и пресеты списков
  const [rules, setRules] = useState<RouteRule[]>([]);
  const [routeRu, setRouteRu] = useState(false);
  const [routeAds, setRouteAds] = useState(false);
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);
  // Автообновление: тихо проверяем версию и показываем баннер, если вышла новая.
  const [upd, setUpd] = useState<{ version: string; url: string } | null>(null);
  const [updBusy, setUpdBusy] = useState(false);
  const [ver, setVer] = useState("");
  const autoUpd = useRef(false);
  /// real counters from the engine, never a made-up number
  const [traffic, setTraffic] = useState({ down: 0, up: 0 });
  const [tgProxy, setTgProxy] = useState(false);
  // накопленное с последней записи в статистику, байты
  const statsPending = useRef({ down: 0, up: 0 });
  const prevTotals = useRef<{ down: number; up: number } | null>(null);
  const [ip, setIp] = useState("");
  const [ipBusy, setIpBusy] = useState(false);

  const checkIp = async () => {
    if (!inTauri) return;
    setIpBusy(true);
    try {
      setIp(await api.myIp());
    } catch {
      setIp("");
    } finally {
      setIpBusy(false);
    }
  };
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState(initial.get("error") ?? "");
  const [busy, setBusy] = useState(false);
  const [lat, setLat] = useState<Record<string, number | null>>({});
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
  const [admin, setAdmin] = useState(true);
  const [zapretDir, setZapretDir] = useState<string | null>(null);
  /// the preset the owner picked must survive a restart, not snap back to the first
  const [zapretPreset, setZapretPreset] = useState("");
  const [autostart, setAutostart] = useState(false);
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
  const probeFail = useRef(0);
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
  /** Идёт автопереключение: не даём таймеру и триггеру потери сработать повторно. */
  const switching = useRef(false);
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
      // Страна из разбора подписки точнее, чем попытка угадать её по имени.
      const cc = p.cc && knownCc(p.cc) ? p.cc : ccFromName(p.name);
      const country = nameOf(cc ?? "");
      const title = stripCc(p.name) || p.host;
      // вторая строка: страна, если она не повторяет название; иначе адрес сервера
      const sub = country && country.toLowerCase() !== title.toLowerCase() ? country : `${p.host}:${p.port}`;
      return {
      id: p.id,
      cc: cc ?? "",
      flag: cc ?? "",
      city: title,
      country: sub,
      tag: protoTag(p),
      lat: lat[p.id] ?? 0,
      quality: "good" as const,
      reserve: p.reserve ?? false,
      kind: p.kind,
      };
    });
  }, [profiles, lat]);

  const toggleReserve = useCallback((id: string) => {
    setProfiles((list) => list.map((p) => (p.id === id ? { ...p, reserve: !p.reserve } : p)));
  }, []);

  const addWireguard = useCallback(async (text: string | null) => {
    // null = «зарегистрируй бесплатный WARP сам»
    const profile = text === null ? await api.warpRegister() : await api.wireguardAdd(text);
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
        setAdmin(info.admin);
        setZapretDir(info.zapret_dir);
        setAutostart(info.autostart);
      })
      .catch(() => setAdmin(true));
  }, []);

  // Restore what the user had last time; the app must work with zero external programs.
  useEffect(() => {
    if (!inTauri) return;
    api
      .stateLoad()
      .then((st) => {
        if (st.profiles.length) setProfiles(st.profiles);
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
    zapretPreset, tgProxy, rules, routeRu, routeAds, zapretAuto,
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

  // Keep UI in sync with the real process while a tunnel is up.
  useEffect(() => {
    if (!inTauri || conn === "idle") return;
    const id = window.setInterval(async () => {
      try {
        const st = await api.engineStatus();
        if (st.state === "error") {
          setConn("error");
          setError(st.message);
        }
        if (st.state === "idle" && conn !== "connecting") {
          setConn("idle");
        }
      } catch {
        /* engine not reachable: keep current state */
      }
    }, 2000);
    return () => window.clearInterval(id);
  }, [conn]);

  useEffect(() => {
    if (!inTauri) return;
    if (conn !== "connected") {
      setTraffic({ down: 0, up: 0 });
      return;
    }
    let alive = true;
    const read = () =>
      api
        .engineTraffic()
        .then((t) => {
          if (!alive) return;
          setTraffic({ down: t.down, up: t.up });
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
  }, [conn]);

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
    setError("");
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

  const startTunnel = useCallback(async () => {
    setError("");
    setConn("connecting");
    prevTotals.current = null;
    const profile = profiles.find((p) => p.id === selectedId);

    if (inTauri) {
      if (!profile) {
        setConn("error");
        setError("нет серверов: сначала загрузи подписку на экране «Серверы»");
        return;
      }
      const excluded = chosen.filter((a) => !a.via).map((a) => a.exe);
      const via = chosen.filter((a) => a.via).map((a) => a.exe);
      try {
        const st = await api.engineStart(
          profile,
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
  }, [chosen, profiles, selectedId, dnsMode]);

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
  const reconnectTunnel = useCallback(async () => {
    setSplitDirty(false);
    // переподключение не должно открывать интернет: блокировку не снимаем
    await stopTunnel(false);
    await startTunnel();
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

  const loadSubscription = useCallback(async () => {
    setBusy(true);
    setWarnings([]);
    if (!inTauri) {
      setWarnings(["Загрузка подписки работает в приложении, а не в браузере"]);
      setBusy(false);
      return;
    }
    const sources: SubSource[] = subs.length
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
    setProfiles(unique);
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
  }, [subUa, subUrl, subs]);

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

  // refresh subscriptions twice a day, like a normal client
  useEffect(() => {
    if (!inTauri || !loaded) return;
    const id = window.setInterval(() => loadSubscription(), 12 * 60 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [loaded, loadSubscription]);

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
        await reconnectTunnel();
      } finally {
        window.setTimeout(() => {
          switching.current = false;
        }, 4000);
      }
    },
    [conn, lat, measurePing, orch, profiles, reconnectTunnel, record, selectedId, t],
  );

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
    if (!inTauri || conn !== "connected") return;
    const current = profiles.find((p) => p.id === selectedId);
    if (!current) return;
    const key = pairKey(current);
    const res = await probeOnce();
    if (res.ok) {
      probeFail.current = 0;
      const rows = await api.orchestratorRecord(key, true, res.ms).catch(() => undefined);
      if (rows) setOrch(rows);
      return;
    }
    probeFail.current += 1;
    if (probeFail.current < 2) return;
    const rows = await api.orchestratorRecord(key, false, 0).catch(() => undefined);
    if (rows) setOrch(rows);
    probeFail.current = 0;
    setToast({ title: t("autoSelect"), body: t("orchDead") });
    // Один сервер — только переподключение; несколько — выбираем живой.
    if (profiles.length > 1) {
      void autoTick(true);
    } else {
      void reconnectTunnel().catch(() => undefined);
    }
  }, [autoTick, conn, profiles, reconnectTunnel, selectedId, t]);

  // Пока туннель поднят — раз в 15 секунд проверяем, что интернет реально идёт.
  useEffect(() => {
    if (!inTauri || conn !== "connected") {
      probeFail.current = 0;
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
        setUpd({ version: res.version, url: res.url });
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
      const path = await api.updateDownload(upd.url);
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
  };

  return (
    <div className="shell">
      <header className="titlebar" data-tauri-drag-region>
        <div className="brand">
          <img src="/mascot/glyph-on.png" alt="" />
          <span>K4R Neko VPN</span>
          <span className="tag">{t("tagBeta")}</span>
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

      {!admin && (
        <div className="banner">
          <span>Для туннеля нужны права администратора — Windows не даёт создать сетевой адаптер без них.</span>
          <button className="btn primary" style={{ width: "auto", paddingInline: 14 }} onClick={() => api.relaunchAdmin()}>
            Перезапустить как администратор
          </button>
        </div>
      )}

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
              killSwitch={killSwitch}
              blocked={false}
              ip={ip}
              ipBusy={ipBusy}
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
          {screen === "split" && <SplitScreen {...ctx} />}
          {screen === "stats" && <StatsScreen t={t} />}
          {screen === "history" && (
            <HistoryScreen
              t={t}
              lang={lang}
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
          {screen === "route" && (
            <RouteScreen
              t={t}
              rules={rules}
              setRules={setRules}
              ruDirect={routeRu}
              setRuDirect={setRouteRu}
              blockAds={routeAds}
              setBlockAds={setRouteAds}
              connected={conn === "connected"}
              onReconnect={reconnectTunnel}
            />
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
