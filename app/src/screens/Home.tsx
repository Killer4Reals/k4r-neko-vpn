import { useEffect, useRef, useState } from "react";
import type { ConnState, Server } from "../data";
import { BoltIcon, RefreshIcon } from "../icons";

type Props = {
  t: (k: string) => string;
  conn: ConnState;
  toggleConnection: () => void;
  selected: Server;
  servers: Server[];
  selectedId: string;
  setSelectedId: (id: string) => void;
  zapretOn: boolean;
  setZapretOn: (v: boolean) => void;
  killSwitch: boolean;
  setKillSwitch: (v: boolean) => void;
  onOpenSplit: () => void;
  error: string;
};

const mascot: Record<ConnState, { src: string; w: number; h: number }> = {
  idle: { src: "/mascot/idle.png", w: 240, h: 184 },
  connecting: { src: "/mascot/connecting.png", w: 168, h: 210 },
  connected: { src: "/mascot/avatar.png", w: 168, h: 168 },
  error: { src: "/mascot/idle.png", w: 240, h: 184 },
};

const fmt = (n: number) => n.toFixed(1);

export function HomeScreen(p: Props) {
  const { t, conn, toggleConnection, selected, servers, selectedId, setSelectedId } = p;
  const [down, setDown] = useState(0);
  const [up, setUp] = useState(0);
  const [uptime, setUptime] = useState(0);
  const seed = useRef(1);

  useEffect(() => {
    if (conn !== "connected") {
      setDown(0);
      setUp(0);
      setUptime(0);
      return;
    }
    const id = window.setInterval(() => {
      seed.current += 0.7;
      const jitter = Math.sin(seed.current) * 1.6;
      setDown(Math.max(0.4, 12.4 + jitter));
      setUp(Math.max(0.2, 4.1 + jitter * 0.5));
      setUptime((v) => v + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [conn]);

  const statusKey = conn === "connected" ? "stConnected" : conn === "connecting" ? "stConnecting" : conn === "error" ? "stError" : "stOff";
  const hintKey = conn === "connected" ? "hintConnected" : conn === "connecting" ? "hintConnecting" : "hintOff";
  const m = mascot[conn];
  const mm = String(Math.floor(uptime / 60)).padStart(2, "0");
  const ss = String(uptime % 60).padStart(2, "0");

  return (
    <div className="home">
      <section className="hero">
        <div className="grid-lines" />

        <div className="status-pill" data-state={conn}>
          <span className="dot" />
          {t(statusKey)}
        </div>

        <div className="orb" data-state={conn}>
          <div className="ring" />
          <img
            className="mascot"
            src={m.src}
            alt=""
            style={{ width: m.w, height: m.h }}
            draggable={false}
          />
          <button className="orb-hit" onClick={toggleConnection} aria-label={t(hintKey)} />
        </div>

        <div className="server-line">
          <span className="flag-code">{selected.cc}</span>
          <strong>{selected.city}</strong>
          <span>{selected.country}</span>
          <span className="lat">{selected.lat === 0 ? "—" : `${selected.lat} ms`}</span>
        </div>

        {p.error && <div className="hero-error">{p.error}</div>}

        <div className="stats">
          <div className="stat">
            <div className="k">{t("down")}</div>
            <div className="v">
              {fmt(down)} <small>MB/s</small>
            </div>
          </div>
          <div className="stat">
            <div className="k">{t("up")}</div>
            <div className="v">
              {fmt(up)} <small>MB/s</small>
            </div>
          </div>
          <div className="stat">
            <div className="k">{t("uptime")}</div>
            <div className="v">
              {mm}:{ss}
            </div>
          </div>
        </div>

        <div className="quick">
          <button className="chip" data-on={p.zapretOn} onClick={() => p.setZapretOn(!p.zapretOn)}>
            <span className="led" />
            {t("tunnelGuard")}
          </button>
          <button className="chip" data-on={p.killSwitch} onClick={() => p.setKillSwitch(!p.killSwitch)}>
            <span className="led" />
            {t("killSwitch")}
          </button>
          <button className="chip" onClick={p.onOpenSplit}>
            <BoltIcon size={13} />
            Split
          </button>
        </div>
      </section>

      <aside className="panel">
        <div className="panel-head">
          <h2>{t("servers")}</h2>
          <span className="count">{servers.length}</span>
          <div className="spacer" />
          <button className="ghost-btn">
            <RefreshIcon size={13} />
          </button>
        </div>

        <div className="server-list">
          {servers.map((s) => (
            <button
              key={s.id}
              className="server"
              aria-current={s.id === selectedId}
              onClick={() => setSelectedId(s.id)}
            >
              <span className="flag-code" data-on={s.id === selectedId}>{s.cc}</span>
              <span>
                <div className="name">{s.city}</div>
                <div className="sub">
                  {s.country} · {s.tag}
                </div>
              </span>
              <span className="lat">
                <span className="bars" data-q={s.quality}>
                  <i />
                  <i />
                  <i />
                </span>
                {s.lat === 0 ? "—" : s.lat}
              </span>
            </button>
          ))}
        </div>

        <div className="panel-foot">
          <button className="btn">{t("autoPick")}</button>
        </div>
      </aside>
    </div>
  );
}
