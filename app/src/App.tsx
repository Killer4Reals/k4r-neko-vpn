import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
import "@fontsource-variable/manrope";
import { useT, type Lang } from "./i18n";
import { apps as appCatalog, servers as demoCatalog, type AppEntry, type ConnState, type Server } from "./data";
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

export default function App() {
  const initial = new URLSearchParams(window.location.search);
  const [lang, setLang] = useState<Lang>("ru");
  const [theme, setTheme] = useState<Theme>(
    () =>
      (initial.get("theme") as Theme) ||
      (localStorage.getItem("k4r.theme") as Theme) ||
      "dark",
  );
  const [screen, setScreen] = useState<Screen>((initial.get("screen") as Screen) || "home");
  const [conn, setConn] = useState<ConnState>((initial.get("state") as ConnState) || "idle");
  const [selectedId, setSelectedId] = useState(demoCatalog[0].id);
  const [zapretOn, setZapretOn] = useState(true);
  const [killSwitch, setKillSwitch] = useState(true);
  const [list, setList] = useState<AppEntry[]>(appCatalog);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lat, setLat] = useState<Record<string, number | null>>({});
  const [loaded, setLoaded] = useState(!inTauri);
  const [admin, setAdmin] = useState(true);
  const [zapretDir, setZapretDir] = useState<string | null>(null);
  const [autostart, setAutostart] = useState(false);
  const [subUrl, setSubUrl] = useState(DEFAULT_SUB);
  const [subUa, setSubUa] = useState(DEFAULT_UA);
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
        if (st.split.length) {
          setList((prev) =>
            prev.map((a) => {
              const saved = st.split.find((s) => s.exe === a.exe);
              return saved ? { ...a, via: saved.via } : a;
            }),
          );
        }
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
          split: list.map((a) => ({ exe: a.exe, via: a.via })),
          zapret_dir: zapretDir ?? "",
          zapret_preset: "",
        })
        .catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(id);
  }, [loaded, profiles, subUrl, subUa, selectedId, list, zapretDir]);

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
      const excluded = list.filter((a) => !a.via).map((a) => a.exe);
      try {
        const st = await api.engineStart(profile, excluded, "1.1.1.1");
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
  }, [list, profiles, selectedId]);

  const toggleConnection = useCallback(() => {
    if (busy) return;
    setBusy(true);
    const run = conn === "connected" || conn === "connecting" ? stopTunnel() : startTunnel();
    run.finally(() => setBusy(false));
  }, [busy, conn, startTunnel, stopTunnel]);

  const toggleApp = (id: string) =>
    setList((prev) => prev.map((a) => (a.id === id ? { ...a, via: !a.via } : a)));

  const loadSubscription = useCallback(async () => {
    setBusy(true);
    setWarnings([]);
    if (!inTauri) {
      setWarnings(["Загрузка подписки работает в приложении, а не в браузере"]);
      setBusy(false);
      return;
    }
    try {
      const res = await api.fetchSub(subUrl, subUa, []);
      setProfiles(res.profiles);
      setWarnings(res.warnings);
      if (res.profiles[0]) setSelectedId(res.profiles[0].id);
    } catch (e) {
      setWarnings([String(e)]);
    } finally {
      setBusy(false);
    }
  }, [subUa, subUrl]);

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
    if (!inTauri || profiles.length === 0) return;
    try {
      const res = await api.probePing(profiles);
      const next: Record<string, number | null> = {};
      for (const r of res) next[r.id] = r.ms;
      setLat(next);
    } catch (e) {
      setWarnings([String(e)]);
    }
  }, [profiles]);

  const ctx = {
    t,
    lang,
    conn,
    toggleConnection,
    selected,
    servers: viewServers,
    selectedId,
    setSelectedId,
    list,
    toggleApp,
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
              zapretOn={zapretOn}
              setZapretOn={setZapretOn}
              killSwitch={killSwitch}
              setKillSwitch={setKillSwitch}
              onOpenSplit={() => setScreen("split")}
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
            />
          )}
          {screen === "split" && <SplitScreen {...ctx} />}
          {screen === "zapret" && (
            <ZapretScreen t={t} zapretOn={zapretOn} setZapretOn={setZapretOn} initialDir={zapretDir} />
          )}
          {screen === "logs" && <LogsScreen t={t} conn={conn} error={error} />}
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
            />
          )}
        </main>
      </div>
    </div>
  );
}
