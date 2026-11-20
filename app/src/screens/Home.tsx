import { useEffect, useRef, useState } from "react";
import { Globe } from "../GlobeView";
import type { GlobeNode } from "../GlobePlanet";
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
  /** id -> когда мерили, чтобы отличить живой замер от старого */
  latAt?: Record<string, number>;
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

  // Узлы на планете: без открытия списка видно, кто ответил, кто тормозит, а
  // кто молчит. Замер старше 12 минут считаем старым — он не врёт, но устарел.
  const globeNodes: GlobeNode[] = [];
  for (const s of servers) {
    if (!(s.id in p.lat)) continue; // ещё не мерили — точку не рисуем
    const at = countryOf(s.flag || s.cc);
    if (!at) continue;
    const ms = p.lat[s.id];
    const stamp = p.latAt?.[s.id];
    const stale = typeof stamp !== "number" || Date.now() - stamp > 12 * 60 * 1000;
    globeNodes.push({
      lat: at.lat,
      lon: at.lon,
      ms,
      stale: ms !== null && stale,
      label: s.city || s.country,
    });
  }
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

  // Глобус подстраивается под ширину блока: в узком окне шар меньше, а кнопка
  // уезжает под него, чтобы шар и маскот больше не наезжали друг на друга.
  const heroRef = useRef<HTMLElement | null>(null);
  const [globeSize, setGlobeSize] = useState(360);

  // Дуга подключения: пока идёт рукопожатие — заполняется до 85% и ждёт,
  // на «подключено» доходит до 100%. Никаких выдуманных «этапов».
  const [fill, setFill] = useState(0);
  useEffect(() => {
    if (conn === "connected") {
      setFill(1);
      return;
    }
    if (conn !== "connecting") {
      setFill(0);
      return;
    }
    const started = performance.now();
    const id = window.setInterval(() => {
      const t = (performance.now() - started) / 2600;
      setFill(Math.min(0.85, t * 0.85));
    }, 90);
    return () => window.clearInterval(id);
  }, [conn]);

  const CIRC = 2 * Math.PI * 49;

  useEffect(() => {
    const el = heroRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      // высота hero минус подписи сверху и снизу — остальное отдаём шару
      const w = el.clientWidth || 0;
      const h = el.clientHeight || 0;
      const byHeight = h - 196;
      const size = Math.max(220, Math.min(440, Math.min(w - 36, byHeight)));
      setGlobeSize((prev) => (Math.abs(prev - size) < 2 ? prev : Math.round(size)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
      <section className="hero" ref={heroRef}>
        <div className="grid-lines" />
        {/* Планета — это и индикатор, и кнопка: тонкое кольцо по краю
            показывает состояние, нажатие на шар включает и выключает VPN.
            Маскот — маленький компаньон в углу, он больше ничего не закрывает. */}
        <div className="hero-top">
          <div className="status-pill" data-state={view}>
            <span className="dot" />
            {t(statusKey)}
          </div>

          <button
            className="globe-btn"
            data-state={view}
            onClick={(e) => {
              // после перетаскивания шара клик не должен включать VPN
              const c = e.currentTarget.querySelector("canvas:last-of-type") as HTMLCanvasElement | null;
              if (c?.dataset.dragged) {
                delete c.dataset.dragged;
                return;
              }
              toggleConnection();
            }}
            aria-label={`${t(statusKey)}. ${t(hintKey)}`}
            title={t(hintKey)}
          >
            <span className="globe-ring" aria-hidden />
            <svg className="globe-progress" viewBox="0 0 100 100" aria-hidden data-state={view}>
              <circle className="pg-track" cx="50" cy="50" r="49" />
              <circle
                className="pg-fill"
                cx="50"
                cy="50"
                r="49"
                strokeDasharray={CIRC}
                strokeDashoffset={CIRC * (1 - fill)}
              />
            </svg>
            <Globe
              size={globeSize}
              target={countryOf(selected.flag || selected.cc)}
              connected={conn === "connected"}
              nodes={globeNodes}
            />
          </button>

          {/* Подпись под шаром объясняет, что нажатие делает; маскот рядом,
              а не поверх планеты */}
          <div className="orb-hint" data-state={view}>
            <span className="globe-mascot" aria-hidden>
              <img src={m} alt="" draggable={false} />
            </span>
            <span className="hint-text">{t(hintKey)}</span>
          </div>

          <div className="server-line">
            <Flag cc={selected.flag || selected.cc} size="sm" />
            <strong>{selected.city}</strong>
            <span>{selected.country}</span>
            <span className="lat">{selected.lat === 0 ? "—" : `${selected.lat} ms`}</span>
          </div>
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
