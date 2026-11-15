import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
import "@fontsource-variable/manrope";
import { useT, type Lang } from "./i18n";
import { servers as demoCatalog, type AppEntry, type ConnState, type Server } from "./data";
import type { ChosenApp } from "./api";
import type { SubSource } from "./api";
import { api, inTauri, type Profile } from "./api";
import {
  CloseIcon,
  GearIcon,
  LogIcon,
  MaxIcon,
  MinIcon,
  PowerIcon,
  ServerIcon,
  ShieldIcon,
  SplitIcon,
} from "./icons";
import { HomeScreen } from "./screens/Home";
import { ServersScreen } from "./screens/Servers";
import { SplitScreen } from "./screens/Split";
import { ZapretScreen } from "./screens/Zapret";
import { SettingsScreen } from "./screens/Settings";
import { LogsScreen } from "./screens/Logs";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type Screen = "home" | "servers" | "split" | "zapret" | "logs" | "settings";
export type Theme = "dark" | "light" | "mascot";

const navItems: { id: Screen; key: string; icon: typeof PowerIcon }[] = [
  { id: "home", key: "navHome", icon: PowerIcon },
  { id: "servers", key: "navServers", icon: ServerIcon },
  { id: "split", key: "navSplit", icon: SplitIcon },
  { id: "zapret", key: "navZapret", icon: ShieldIcon },
  { id: "logs", key: "navLogs", icon: LogIcon },
  { id: "settings", key: "navSettings", icon: GearIcon },
];

const DEFAULT_SUB = "https://example.invalid/subscription";
const DEFAULT_UA = "K4R-Neko-VPN/0.1";

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

export default function App() {
  const initial = new URLSearchParams(window.location.search);
  const [lang, setLang] = useState<Lang>("ru");
  const [theme, setTheme] = useState<Theme>(() => {
    // index.html already resolved this before first paint
    const applied = document.documentElement.dataset.theme as Theme | undefined;
    if (applied === "light" || applied === "mascot" || applied === "dark") return applied;
    return (initial.get("theme") as Theme) || "dark";
  });
  const [screen, setScreen] = useState<Screen>((initial.get("screen") as Screen) || "home");
  const [conn, setConn] = useState<ConnState>((initial.get("state") as ConnState) || "idle");
  const [selectedId, setSelectedId] = useState(demoCatalog[0].id);
  const [zapretState, setZapretState] = useState<"off" | "running" | "external" | "error">("off");
  const [killSwitch, setKillSwitch] = useState(true);
  const [catalog, setCatalog] = useState<AppEntry[]>([]);
  const [chosen, setChosen] = useState<ChosenApp[]>([]);
  const [scanning, setScanning] = useState(inTauri);
  /// routes changed while the tunnel is up: engine reads them only on start
  const [splitDirty, setSplitDirty] = useState(false);
  /// "only" = tunnel carries just the chosen programs (the owner's default)
  const [splitMode, setSplitMode] = useState<"only" | "all">("only");
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);
  /// real counters from the engine, never a made-up number
  const [traffic, setTraffic] = useState({ down: 0, up: 0 });
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState(initial.get("error") ?? "");
  const [busy, setBusy] = useState(false);
  const [lat, setLat] = useState<Record<string, number | null>>({});
  const [loaded, setLoaded] = useState(!inTauri);
  const [admin, setAdmin] = useState(true);
  const [zapretDir, setZapretDir] = useState<string | null>(null);
  /// the preset the owner picked must survive a restart, not snap back to the first
  const [zapretPreset, setZapretPreset] = useState("");
  const [autostart, setAutostart] = useState(false);
  const [subUrl, setSubUrl] = useState(DEFAULT_SUB);
  const [subUa, setSubUa] = useState(DEFAULT_UA);
  const [subs, setSubs] = useState<SubSource[]>([]);
  const [dnsMode, setDnsMode] = useState<"tunnel" | "system">("tunnel");
  const [blockIpv6, setBlockIpv6] = useState(true);
  /// resolver inside the tunnel: "1.1.1.1", "https://dns.google/dns-query" or "tls://..."
  const [dnsServer, setDnsServer] = useState("1.1.1.1");
  const [hotkey, setHotkey] = useState("Ctrl+Alt+V");
  const [closeToTray, setCloseToTray] = useState(true);
  const [minimizeToTray, setMinimizeToTray] = useState(true);
  /// device id the subscription server knows us by
  const [deviceId, setDeviceId] = useState("");
  const [notifyOn, setNotifyOn] = useState(true);
  const timer = useRef<number | null>(null);
  const win = inTauri ? getCurrentWindow() : null;

  const t = useT(lang);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("k4r.theme", theme);
  }, [theme]);

  const viewServers = useMemo<Server[]>(() => {
    if (profiles.length === 0) return demoCatalog;
    return profiles.map((p) => ({
      id: p.id,
      cc: "VPN",
      flag: "",
      city: p.name || p.host,
      country: `${p.host}:${p.port}`,
      tag: (p.security === "none" ? p.network : p.security).toUpperCase(),
      lat: lat[p.id] ?? 0,
      quality: "good" as const,
    }));
  }, [profiles, lat]);

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
        if (st.hotkey) setHotkey(st.hotkey);
        if (typeof st.close_to_tray === "boolean") setCloseToTray(st.close_to_tray);
        if (typeof st.minimize_to_tray === "boolean") setMinimizeToTray(st.minimize_to_tray);
        if (st.split_mode === "all" || st.split_mode === "only") setSplitMode(st.split_mode);
        if (st.dns_server) setDnsServer(st.dns_server);
        if (st.zapret_preset) setZapretPreset(st.zapret_preset);
        if (typeof st.notify === "boolean") setNotifyOn(st.notify);
        if (typeof st.kill_switch === "boolean") setKillSwitch(st.kill_switch);
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
          subs,
          dns_mode: dnsMode,
          block_ipv6: blockIpv6,
          reconnect: true,
          hotkey,
          close_to_tray: closeToTray,
          minimize_to_tray: minimizeToTray,
          notify: notifyOn,
          kill_switch: killSwitch,
          hwid: deviceId || undefined,
          split_mode: splitMode,
          dns_server: dnsServer,
        })
        .catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(id);
  }, [
    loaded, profiles, subUrl, subUa, selectedId, chosen, zapretDir,
    subs, dnsMode, blockIpv6, hotkey, closeToTray, minimizeToTray, notifyOn, killSwitch,
    deviceId, splitMode, dnsServer,
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
          if (alive) setTraffic({ down: t.down, up: t.up });
        })
        .catch(() => undefined);
    read();
    const id = window.setInterval(read, 1000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [conn]);

  const stopTunnel = useCallback(async () => {
    setError("");
    if (inTauri) {
      try {
        await api.engineStop();
      } catch (e) {
        setError(String(e));
      }
    }
    setConn("idle");
  }, []);

  const startTunnel = useCallback(async () => {
    setError("");
    setConn("connecting");
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
        if (st.state !== "running") setError(st.message);
      } catch (e) {
        setConn("error");
        setError(String(e));
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
    await stopTunnel();
    await startTunnel();
  }, [stopTunnel, startTunnel]);

  /** Fetches every subscription and merges the servers, keeping the selection. */
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

    for (const src of sources) {
      try {
        const res = await api.fetchSub(src.url, src.ua || subUa, []);
        merged.push(...res.profiles);
        notes.push(...res.warnings);
        refreshed[src.url] = stamp;
      } catch (e) {
        const msg = String(e);
        notes.push(
          src.name
            ? `${src.name}: ${msg}`
            : msg.includes("устройств")
              ? "Провайдер говорит «достигнут предел устройств»: удали лишнее устройство в личном кабинете или напиши в поддержку, приложив ID из настроек."
              : msg,
        );
      }
    }

    const seen = new Set<string>();
    const unique = merged.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
    setProfiles(unique);
    setWarnings(notes);
    setSubs((prev) =>
      prev.map((s) => (refreshed[s.url] ? { ...s, refreshed: refreshed[s.url] } : s)),
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
      setLat(next);
      return next;
    } catch (e) {
      setWarnings([String(e)]);
      return undefined;
    }
  }, [profiles]);

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
  // Windows toasts are unreliable for an unpackaged / portable exe (they need a
  // Start-menu shortcut with an app id), so the app always shows its own card in
  // the corner. The toast is a bonus on top of that, never the only channel.
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
    setToast({ title, body });
    if (!inTauri) return;
    (async () => {
      try {
        const n = await import("@tauri-apps/plugin-notification");
        let granted = await n.isPermissionGranted();
        if (!granted) granted = (await n.requestPermission()) === "granted";
        if (!granted) return;
        n.sendNotification({ title, body });
      } catch {
        /* the in-app card already told the owner what happened */
      }
    })();
  }, [conn, notifyOn, selected, error, t]);

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

  const ctx = {
    t,
    lang,
    conn,
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
          {screen === "home" && (
            <HomeScreen
              {...ctx}
              error={error}
              zapretState={zapretState}
              down={traffic.down}
              up={traffic.up}
              killSwitch={killSwitch}
              blocked={false}
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
            />
          )}
          {screen === "split" && <SplitScreen {...ctx} />}
          {screen === "zapret" && (
            <ZapretScreen
              t={t}
              initialDir={zapretDir}
              savedPreset={zapretPreset}
              onPreset={setZapretPreset}
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
              killSwitch={killSwitch}
              setKillSwitch={setKillSwitch}
              autostart={autostart}
              setAutostart={setAutostart}
              theme={theme}
              setTheme={setTheme}
              dnsMode={dnsMode}
              setDnsMode={setDnsMode}
              dnsServer={dnsServer}
              setDnsServer={setDnsServer}
              blockIpv6={blockIpv6}
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
