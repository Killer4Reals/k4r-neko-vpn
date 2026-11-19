import { useEffect, useState } from "react";
import { Globe } from "../GlobeView";
import { countryOf } from "../globe";
import type { ConnState, Server } from "../data";
import { BoltIcon, RefreshIcon } from "../icons";
import { Flag } from "../Flag";
import { humanBytes, leftBytes, subTiming } from "../sub";

type Props = {
  t: (k: string) => string;
  conn: ConnState;
  toggleConnection: () => void;
  selected: Server;
  servers: Server[];
  selectedId: string;
  setSelectedId: (id: string) => void;
  /** real state of the guard, not a wish: off / running / external / error */
  zapretState: "off" | "running" | "external" | "error";
  killSwitch: boolean;
  /** id -> ms of the last health check, null = no answer */
  lat: Record<string, number | null>;
  /** bytes per second measured by the engine */
  down: number;
  up: number;
  /** true only when traffic is really being held back (needs the WFP backend) */
  blocked: boolean;
  onOpenSplit: () => void;
  onOpenZapret: () => void;
  onOpenSettings: () => void;
  onOpenServers: () => void;
  onRefreshServers: () => void;
  onAutoPick: () => void;
  /** address the internet sees right now, "" until measured */
  ip: string;
  ipBusy: boolean;
  onCheckIp: () => void;
  realCount: number;
  error: string;
  /** срок подписки, unix-секунды; 0 — провайдер не сказал */
  subExpire: number;
  /** лимит трафика в байтах; 0 — без лимита */
  subTotal: number;
  /** сколько уже израсходовано, байты */
  subUsed: number;
};

// sizes live in CSS: each art has a different amount of empty canvas, so the
// per-state scale keeps the drawn character the same height everywhere
const GUARD = "/mascot/guard.webp";

const mascot: Record<ConnState, string> = {
  idle: "/mascot/idle.webp",
  connecting: "/mascot/connecting.webp",
  connected: "/mascot/connected.webp",
  error: "/mascot/error.webp",
};

/** bytes per second -> "12.4"; small traffic keeps one decimal, not "0.0" */
const fmt = (bytesPerSec: number) => {
  const mb = bytesPerSec / (1024 * 1024);
  if (!Number.isFinite(mb) || mb <= 0) return "0.0";
  if (mb < 0.1) return "<0.1";
  return mb.toFixed(mb < 10 ? 1 : 0);
};

export function HomeScreen(p: Props) {
  const { t, conn, toggleConnection, selected, servers, selectedId, setSelectedId } = p;
  const [uptime, setUptime] = useState(0);

  useEffect(() => {
    if (conn !== "connected") {
      setUptime(0);
      return;
    }
    const id = window.setInterval(() => setUptime((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, [conn]);

  // Never claim "blocked" on the strength of a toggle: the guard art only
  // appears when the backend reports real enforcement.
  const guarded = p.blocked;
  const statusKey = guarded
    ? "stBlocked"
    : conn === "connected" ? "stConnected" : conn === "connecting" ? "stConnecting" : conn === "error" ? "stError" : "stOff";
  const hintKey = conn === "connected" ? "hintConnected" : conn === "connecting" ? "hintConnecting" : "hintOff";
  const view = guarded ? "guard" : conn;
  const m = guarded ? GUARD : mascot[conn];
  const mm = String(Math.floor(uptime / 60)).padStart(2, "0");
  const ss = String(uptime % 60).padStart(2, "0");

  return (
    <div className="home" data-nosub={p.realCount === 0 && !p.error ? "true" : undefined}>
      {p.realCount === 0 && !p.error && (
        <div className="welcome">
          <div className="welcome-copy">
            <h2>{t("welcomeTitle")}</h2>
            <p>{t("welcomeText")}</p>
            <button
              className="btn primary"
              style={{ width: "auto", paddingInline: 18 }}
              onClick={p.onOpenServers}
            >
              {t("welcomeCta")}
            </button>
          </div>
          <img className="welcome-art" src="/mascot/offer.webp" alt="" draggable={false} />
        </div>
      )}
      <section className="hero">
        <div className="grid-lines" />
        <div className="globe-bg">
          <Globe
            size={460}
            target={countryOf(selected.flag || selected.cc)}
            connected={conn === "connected"}
          />
        </div>

        <div className="status-pill" data-state={view}>
          <span className="dot" />
          {t(statusKey)}
        </div>

        <button
          className="orb"
          data-state={view}
          onClick={toggleConnection}
          aria-label={`${t(statusKey)}. ${t(hintKey)}`}
          title={t(hintKey)}
        >
          <span className="ring" />
          <img className="mascot" src={m} alt="" draggable={false} />
        </button>

        {/* Кружок — единственная кнопка включения: подпись под ним
            объясняет, что нажатие делает, чтобы это не приходилось угадывать */}
        <div className="orb-hint" data-state={view}>
          {t(hintKey)}
        </div>

        <div className="server-line">
          <Flag cc={selected.flag || selected.cc} size="sm" />
          <strong>{selected.city}</strong>
          <span>{selected.country}</span>
          <span className="lat">{selected.lat === 0 ? "—" : `${selected.lat} ms`}</span>
        </div>

        {p.error && <div className="hero-error">{p.error}</div>}

        <div className="stats">
          <div className="stat">
            <div className="k">{t("down")}</div>
            <div className="v">
              {fmt(p.down)} <small>MB/s</small>
            </div>
          </div>
          <div className="stat">
            <div className="k">{t("up")}</div>
            <div className="v">
              {fmt(p.up)} <small>MB/s</small>
            </div>
          </div>
          <div className="stat">
            <div className="k">{t("uptime")}</div>
            <div className="v">
              {mm}:{ss}
            </div>
          </div>
        </div>

        <div className="server-line ip-line">
          <span className="k">{t("myIp")}</span>
          <strong className="ip">{p.ip || "—"}</strong>
          <button className="ghost-btn" onClick={p.onCheckIp} disabled={p.ipBusy} title={t("myIpHint")}>
            {p.ipBusy ? "…" : t("ipCheck")}
          </button>
        </div>

        <SubLine expire={p.subExpire} total={p.subTotal} used={p.subUsed} t={t} />

        <div className="quick">
          <button
            className="chip"
            data-on={p.zapretState === "running" || p.zapretState === "external"}
            title={t("zapretRealState")}
            onClick={p.onOpenZapret}
          >
            <span className="led" />
            {t("tunnelGuard")}
          </button>
          <button
            className="chip"
            data-on={p.killSwitch}
            title={t("killSwitchHint")}
            onClick={p.onOpenSettings}
          >
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
          <button className="ghost-btn" onClick={p.onRefreshServers} title={t("refresh")}>
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
              <Flag cc={s.flag || s.cc} size="sm" />
              <span>
                <div className="name">{s.city}</div>
                <div className="sub">
                  {s.country} · {s.tag}
                </div>
              </span>
              <span className="lat">
                {p.lat[s.id] === null ? (
                  <span className="dead">{t("serverDead")}</span>
                ) : (
                  <>
                    <span className="bars" data-q={s.quality}>
                      <i />
                      <i />
                      <i />
                    </span>
                    {p.lat[s.id] ?? (s.lat === 0 ? "—" : s.lat)}
                  </>
                )}
              </span>
            </button>
          ))}
        </div>

        <div className="panel-foot">
          <button className="btn" onClick={p.onAutoPick}>
            {t("autoPick")}
          </button>
        </div>
      </aside>
    </div>
  );
}

/**
 * Срок подписки и остаток трафика. Показываем только то, что провайдер
 * действительно сообщил: выдуманная дата хуже, чем пустое место.
 */
function SubLine(p: { expire: number; total: number; used: number; t: (k: string) => string }) {
  const timing = subTiming(p.expire);
  const left = leftBytes(p.total, p.used, 0);
  if (timing.state === "none" && !p.total) return null;
  const date = p.expire > 0 ? new Date((p.expire > 1e12 ? p.expire : p.expire * 1000) * 1).toLocaleDateString() : "";
  return (
    <div className="sub-line" data-state={timing.state}>
      {timing.state !== "none" && (
        <span>
          {timing.state === "expired"
            ? p.t("subExpired")
            : p.t("subUntil").replace("{d}", date).replace("{n}", String(timing.days))}
        </span>
      )}
      {p.total > 0 && (
        <span>
          {p.t("subLeft").replace("{l}", humanBytes(left)).replace("{t}", humanBytes(p.total))}
        </span>
      )}
    </div>
  );
}
