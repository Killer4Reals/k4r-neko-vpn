import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles.css";
import "@fontsource-variable/manrope";
import { useT, type Lang } from "./i18n";
import { apps as appCatalog, servers, type AppEntry, type ConnState } from "./data";
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

export type Screen = "home" | "servers" | "split" | "zapret" | "logs" | "settings";

const navItems: { id: Screen; key: string; icon: typeof PowerIcon }[] = [
  { id: "home", key: "navHome", icon: PowerIcon },
  { id: "servers", key: "navServers", icon: ServerIcon },
  { id: "split", key: "navSplit", icon: SplitIcon },
  { id: "zapret", key: "navZapret", icon: ShieldIcon },
  { id: "logs", key: "navLogs", icon: LogIcon },
  { id: "settings", key: "navSettings", icon: GearIcon },
];

export default function App() {
  const initial = new URLSearchParams(window.location.search);
  const [lang, setLang] = useState<Lang>("ru");
  const [screen, setScreen] = useState<Screen>((initial.get("screen") as Screen) || "home");
  const [conn, setConn] = useState<ConnState>((initial.get("state") as ConnState) || "idle");
  const [selectedId, setSelectedId] = useState(servers[0].id);
  const [zapretOn, setZapretOn] = useState(true);
  const [killSwitch, setKillSwitch] = useState(true);
  const [list, setList] = useState<AppEntry[]>(appCatalog);
  const timer = useRef<number | null>(null);
  const win = "__TAURI_INTERNALS__" in window ? getCurrentWindow() : null;

  const t = useT(lang);
  const selected = useMemo(
    () => servers.find((s) => s.id === selectedId) ?? servers[0],
    [selectedId],
  );

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const toggleConnection = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    if (conn === "connected") {
      setConn("idle");
      return;
    }
    if (conn === "connecting") {
      setConn("idle");
      return;
    }
    setConn("connecting");
    timer.current = window.setTimeout(() => setConn("connected"), 1600);
  }, [conn]);

  const toggleApp = (id: string) =>
    setList((prev) => prev.map((a) => (a.id === id ? { ...a, via: !a.via } : a)));

  const ctx = { t, lang, conn, toggleConnection, selected, servers, selectedId, setSelectedId, list, toggleApp };

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
          {screen === "home" && <HomeScreen {...ctx} zapretOn={zapretOn} setZapretOn={setZapretOn} killSwitch={killSwitch} setKillSwitch={setKillSwitch} onOpenSplit={() => setScreen("split")} />}
          {screen === "servers" && <ServersScreen {...ctx} />}
          {screen === "split" && <SplitScreen {...ctx} />}
          {screen === "zapret" && <ZapretScreen t={t} zapretOn={zapretOn} setZapretOn={setZapretOn} />}
          {screen === "logs" && <LogsScreen t={t} conn={conn} />}
          {screen === "settings" && (
            <SettingsScreen
              t={t}
              lang={lang}
              setLang={setLang}
              killSwitch={killSwitch}
              setKillSwitch={setKillSwitch}
            />
          )}
        </main>
      </div>
    </div>
  );
}
