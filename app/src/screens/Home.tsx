import { useEffect, useRef, useState } from "react";
import { Globe, takePick } from "../GlobeView";
import type { GlobeNode } from "../GlobePlanet";
import { countryOf, spreadGlobeNodes } from "../globe";
import type { ConnState, Server } from "../data";
import { BoltIcon, RefreshIcon } from "../icons";
import { SCENARIOS, type ScenarioId } from "../scenarios";
import { Flag } from "../Flag";
import { nameOf } from "../flags";
import { humanBytes, leftBytes, subTiming } from "../sub";
import { providerOf } from "../passport";
import { connectedStatusKey } from "../protection";
import { isFresh } from "../health";
import { dayKey, human } from "../stats";
import { api } from "../api";

type Props = {
  t: (k: string) => string;
  lang: "ru" | "en";
  conn: ConnState;
  toggleConnection: () => void;
  selected: Server;
  servers: Server[];
  selectedId: string;
  setSelectedId: (id: string) => void;
  /** real state of the guard, not a wish: off / running / external / error */
  zapretState: "off" | "running" | "external" | "error";
  killSwitch: boolean;
  /** реальное состояние ОС-блокировки, а не только тумблер в настройках */
  killSwitchActive: boolean;
  /** только выбранные программы или весь трафик */
  splitMode: "only" | "all";
  /** id -> ms of the last health check, null = no answer */
  lat: Record<string, number | null>;
  /** id -> когда мерили, чтобы отличить живой замер от старого */
  latAt?: Record<string, number>;
  /** bytes per second measured by the engine */
  down: number;
  /** последние замеры скорости, МБ/с — для живой кривой */
  trail: number[];
  /** сколько узлов в пуле: больше одного — работает умный выбор */
  poolSize: number;
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
  /** страна фактического выхода, две буквы; пусто — ещё не измерили */
  exitCc: string;
  /** город фактического выхода, если сервис его знает */
  exitCity: string;
  /** провайдер фактического выхода, например "AS... WAIcore" */
  exitOrg: string;
  onCheckIp: () => void;
  realCount: number;
  /** какой сценарий сейчас включён; null — настройки смешаны руками */
  scenario: ScenarioId | null;
  onScenario: (id: ScenarioId) => void;
  error: string;
  /** все узлы измерены, свежо, и ни один не ответил */
  dead: { dead: number; total: number } | null;
  /** когда последний раз кто-то отвечал, мс эпохи; 0 — не было */
  lastAliveAt: number;
  onCheckNodes: () => void;
  nodesBusy: boolean;
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

  // Паспорт выхода: только измеренный пинг и свежесть. «40 мс» недельной
  // давности — это не 40 мс, а выдуманная оценка не значит ничего.
  const passMs = typeof p.lat[selected.id] === "number" ? p.lat[selected.id] : null;
  const passFresh = isFresh(p.latAt?.[selected.id]);
  const exitAt = p.exitCc ? countryOf(p.exitCc) : null;
  const exitName = exitAt ? nameOf(p.exitCc, p.lang) : "";
  const profileName = nameOf(selected.cc || selected.flag, p.lang) ?? selected.country;
  // Профиль и фактический выход разошлись. Тогда и флаг, и подпись, и
  // кольцо на глобусе показывают выход, а имя профиля остаётся пояснением.
  const actualExit = Boolean(exitName && exitName !== profileName);

  // Узлы на планете: без открытия списка видно, кто ответил, кто тормозит, а
  // кто ещё не мерили. Замер старше 12 минут считаем старым — он не врёт, но
  // устарел. Точки с одинаковой страной разводим, иначе десять серверов из
  // одного города сливаются в одну и кажется, что «всё в одном месте».
  const globeNodes: GlobeNode[] = spreadGlobeNodes(
    servers.flatMap((s) => {
      // Активный узел показываем там, где он реально выпускает трафик, а не
      // там, где провайдер написал его название. Остальные узлы — по профилю:
      // их фактический выход можно узнать только отдельным подключением.
      const isSelected = s.id === selected.id;
      const at = isSelected && exitAt ? exitAt : countryOf(s.flag || s.cc);
      if (!at) return [];
      const measured = s.id in p.lat;
      const ms = measured ? p.lat[s.id] : null;
      const stamp = p.latAt?.[s.id];
      const stale = measured && (typeof stamp !== "number" || Date.now() - stamp > 12 * 60 * 1000);
      const renamed = isSelected && exitName && exitName !== profileName;
      return [{
        id: s.id,
        lat: at.lat,
        lon: at.lon,
        ms,
        stale: ms !== null && stale,
        pending: !measured,
        label: renamed ? `${s.city || s.country} → ${exitName}` : s.city || s.country,
      }];
    }),
  );
  const [uptime, setUptime] = useState(0);

  // Трафик за сегодня: цифра нужна на главной, а не только в «Аналитике».
  // Обновляем раз в минуту и при смене состояния — этого достаточно, чтобы
  // число не отставало, но не дёргало экран каждую секунду.
  const [today, setToday] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .statsRead()
        .then((days) => {
          if (!alive) return;
          const row = days.find((d) => d.day === dayKey());
          setToday(row ? row.down + row.up : 0);
        })
        .catch(() => undefined);
    void load();
    const id = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [conn]);

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
  // «Защищено» — только когда весь трафик идёт в туннель и OS-блокировка
  // реально включена. Иначе честно говорим, что именно защищено.
  const connectedKey = connectedStatusKey(p.splitMode, p.killSwitch, p.killSwitchActive);
  const statusKey = guarded
    ? "stBlocked"
    : conn === "connected" ? connectedKey : conn === "connecting" ? "stConnecting" : conn === "error" ? "stError" : "stOff";
  const statusHint = conn === "connected" ? t("stScopeHint") : undefined;
  const hintKey = conn === "connected" ? "hintConnected" : conn === "connecting" ? "hintConnecting" : "hintOff";
  const view = guarded ? "guard" : conn;
  const m = guarded ? GUARD : mascot[conn];
  const mm = String(Math.floor(uptime / 60)).padStart(2, "0");
  const ss = String(uptime % 60).padStart(2, "0");
  // Время последнего живого ответа: без него «все мертвы» звучит как паника,
  // а с ним — как факт, который можно проверить.
  const deadAgo = p.lastAliveAt
    ? new Date(p.lastAliveAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : t("deadNever");

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
      const byHeight = h - 360;
      const size = Math.max(210, Math.min(400, Math.min(w - 36, byHeight)));
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
          <div className="status-pill" data-state={view} title={statusHint}>
            <span className="dot" />
            {t(statusKey)}
            {p.poolSize > 1 && view === "connected" && (
              <em className="pool-chip" title={t("poolHint")}>
                {t("poolChip").replace("{n}", String(p.poolSize))}
              </em>
            )}
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
              // точка на шаре уже выбрала сервер — это не «включить»
              if (takePick()) return;
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
              {/* Пакеты по кольцу: видно, что соединение живое, а не «крутится
                  спиннер». Показываем только на подключении и на связи. */}
              <circle className="pg-packets" cx="50" cy="50" r="49" />
            </svg>
            <Globe
              size={globeSize}
              target={exitAt ?? countryOf(selected.flag || selected.cc)}
              connected={conn === "connected"}
              nodes={globeNodes}
              onPick={(id) => setSelectedId(id)}
            />
          </button>

          {/* Подпись под шаром объясняет, что нажатие делает; маскот рядом,
              а не поверх планеты */}
          <div className="orb-hint" data-state={view}>
            <span className="globe-mascot" aria-hidden data-state={view}>
              <img src={m} alt="" draggable={false} />
            </span>
            <span className="hint-text">{t(hintKey)}</span>
          </div>

          <div className="server-line">
            <Flag cc={actualExit ? p.exitCc : selected.flag || selected.cc} size="sm" />
            <strong>{actualExit ? exitName : selected.city}</strong>
            {actualExit ? (
              <span className="profile-tag">
                {t("profileOf")} {profileName}
              </span>
            ) : (
              <span>
                {selected.sub ? `${t("profileOf")} ${selected.sub}` : t("profile")} · {selected.tag}
              </span>
            )}
            <span className="lat" title={passFresh ? t("nodeFresh") : t("nodeStale")}>
              {passMs === null ? t("passportNoMeasure") : `${passMs} мс`}
            </span>
          </div>
        </div>

        {p.dead && conn !== "connected" && p.realCount > 0 && (
          <div className="dead-banner" role="status">
            <div className="dead-copy">
              <strong>{t("deadTitle")}</strong>
              <p>
                {t("deadText")
                  .replace("{n}", String(p.dead.total))
                  .replace("{ago}", deadAgo)}
              </p>
            </div>
            <div className="dead-actions">
              <button className="ghost-btn" onClick={p.onCheckNodes} disabled={p.nodesBusy}>
                {p.nodesBusy ? "…" : t("deadRetry")}
              </button>
              <button className="ghost-btn" onClick={p.onRefreshServers}>
                {t("deadRefreshSub")}
              </button>
            </div>
          </div>
        )}

        {p.error.trim() && <div className="hero-error">{p.error}</div>}

        {/* Сценарии: один клик вместо пяти переключателей в настройках */}
        <div className="quick scenarios">
          <span className="quick-label">{t("scLabel")}</span>
          {SCENARIOS.map((sc) => (
            <button
              key={sc.id}
              className="chip"
              data-on={p.scenario === sc.id}
              title={t(sc.hintKey)}
              onClick={() => p.onScenario(sc.id)}
            >
              {t(sc.titleKey)}
            </button>
          ))}
        </div>


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
            <div className="k">{t("trafficToday")}</div>
            <div className="v">{human(today)}</div>
          </div>
          <div className="stat">
            <div className="k">{t("uptime")}</div>
            <div className="v">
              {mm}:{ss}
            </div>
          </div>
        </div>

        {/* Паспорт выхода: то, что интернет знает о тебе прямо сейчас, и
            насколько этому выходу можно верить */}
        <details
          className="passport-box"
          onToggle={(e) => {
            // На низком окне раскрытый паспорт уходит под край. Подводим его
            // целиком, чтобы пояснение о реальном выходе не осталось скрытым.
            if (e.currentTarget.open) {
              e.currentTarget.scrollIntoView({ block: "nearest", behavior: "smooth" });
            }
          }}
        >
          <summary>
            <span className="k">{t("passportTitle")}</span>
            <span className="passport-latency" title={t("passportLatencyHint")}>
              {passMs !== null ? (
                <>
                  <b>{passMs}</b>
                  <small> мс</small>
                </>
              ) : (
                <b>—</b>
              )}
              <em>{passMs === null ? t("passportNoMeasure") : passFresh ? t("nodeFresh") : t("nodeStale")}</em>
            </span>
          </summary>
        <div className="passport">
          <div className="passport-grid">
            <div className="passport-cell">
              <span className="k">{t("passportIp")}</span>
              <strong className="ip" title={p.ip}>{p.ip || "—"}</strong>
              <button className="ghost-btn" onClick={p.onCheckIp} disabled={p.ipBusy} title={t("myIpHint")}>
                {p.ipBusy ? "…" : t("ipCheck")}
              </button>
            </div>
            <div className="passport-cell">
              <span className="k">{t("passportCountry")}</span>
              <strong>
                <Flag cc={p.exitCc || selected.flag || selected.cc} size="sm" />{" "}
                {/* В паспорте — страна фактического выхода. Название профиля
                    может врать: «Германия» провайдера выпускает в Финляндию. */}
                {exitName || profileName}
              </strong>
            </div>
            <div className="passport-cell">
              <span className="k">{t("passportProvider")}</span>
              <strong>{p.exitOrg || providerOf(selected.host)}</strong>
            </div>
            <div className="passport-cell">
              <span className="k">{t("passportProto")}</span>
              <strong>{selected.tag}</strong>
            </div>
          </div>
          {exitName && exitName !== profileName && (
            <p className="passport-note">
              {t("passportExitMismatch")
                .replace("{profile}", profileName)
                .replace("{exit}", exitName)}
            </p>
          )}
        </div>
        </details>

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
            data-on={p.killSwitchActive}
            title={p.killSwitchActive ? t("killSwitchHint") : t("killSwitchInactiveHint")}
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
                  {t("profileOf")} {s.sub ?? s.country} · {s.tag}
                </div>
              </span>
              <span className="lat">
                {p.lat[s.id] === null ? (
                  <span className="dead">{t("serverDead")}</span>
                ) : (
                  <>
                    {p.lat[s.id] ?? "—"}
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
      {p.total > 0 ? (
        <span>
          {p.t("subLeft").replace("{l}", humanBytes(left)).replace("{t}", humanBytes(p.total))}
        </span>
      ) : (
        p.used > 0 && (
          <span>{p.t("subUsedUnlimited").replace("{u}", humanBytes(p.used))}</span>
        )
      )}
    </div>
  );
}
