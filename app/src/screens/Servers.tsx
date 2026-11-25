import { useEffect, useState } from "react";
import type { Server } from "../data";
import type { SubInfo, SubSource } from "../api";
import { QrSheet } from "../Qr";
import { api } from "../api";
import { aliveCount, isFresh } from "../health";
import { sparkPoints, sparkTone } from "../spark";
import { BoltIcon, RefreshIcon } from "../icons";
import { Flag } from "../Flag";
import { ServerMap } from "../ServerMap";
import { sortServers, type SortMode } from "../serverSort";
import { classifyClip, shouldOffer } from "../clipHint";
import { decodeSubLink, encodeSubLink } from "../subLink";



type Props = {
  t: (k: string) => string;
  servers: Server[];
  selectedId: string;
  setSelectedId: (id: string) => void;
  /** id -> ms of the last health check, null = no answer */
  lat: Record<string, number | null>;
  /** id -> когда мерили, чтобы отличать свежий замер от старого */
  latAt?: Record<string, number>;
  /** id -> последние замеры: линия динамики рядом с цифрой */
  sparks?: Record<string, (number | null)[]>;
  subUrl: string;
  subUa: string;
  setSubUrl: (v: string) => void;
  setSubUa: (v: string) => void;
  onLoad: () => void;
  onImport: (text: string) => Promise<void>;
  onPing: () => Promise<unknown>;
  warnings: string[];
  busy: boolean;
  realCount: number;
  subs: SubSource[];
  addSub: (url: string, ua: string, name: string) => void;
  removeSub: (url: string) => void;
  onToggleReserve: (id: string) => void;
  /** text = конфиг, null = зарегистрировать WARP автоматически */
  onAddWireguard: (text: string | null) => Promise<void>;
  /** id узлов, отмеченных звёздочкой */
  favorites?: string[];
  toggleFavorite?: (id: string) => void;
};

const shortUrl = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u.slice(0, 32);
  }
};


function gb(bytes: number): string {
  if (!bytes) return "";
  const g = bytes / 1024 / 1024 / 1024;
  return g >= 100 ? `${Math.round(g)} ГБ` : `${g.toFixed(1)} ГБ`;
}

/// Providers announce the allowance; we show it as it is, including "unknown".
function subUsage(s: { info?: SubInfo | null } | null | undefined, t: (k: string) => string): string {
  const info = s?.info;
  if (!info || (!info.total && !info.expire && !info.download && !info.upload)) return "";
  const parts: string[] = [];
  const used = (info.upload || 0) + (info.download || 0);
  if (info.total) {
    const left = Math.max(0, info.total - used);
    parts.push(`${t("trafficLeft")} ${gb(left)} ${t("ofTotal")} ${gb(info.total)}`);
  } else if (used > 0) {
    // провайдер не ограничивает объём, но расход честно показывает
    parts.push(`${t("trafficUsed")} ${gb(used)} (${t("noLimit")})`);
  }
  if (info.expire) {
    const date = new Date(info.expire * 1000);
    const days = Math.ceil((date.getTime() - Date.now()) / 86_400_000);
    const when = date.toLocaleDateString();
    parts.push(days >= 0 ? `${t("until")} ${when} (${days} ${t("days")})` : `${t("expired")} ${when}`);
  }
  return parts.join(" · ");
}

export function ServersScreen(p: Props) {
  const { t, servers, selectedId, setSelectedId, warnings, busy, realCount } = p;
  const [link, setLink] = useState("");
  // «4 из 6 отвечают»: считаем по последнему замеру
  const alive = aliveCount(servers.map((s) => s.id), p.lat);
  // «проверено 3 мин назад»: без этого серые точки выглядят как приговор
  const measuredAgo = (() => {
    const stamps = Object.values(p.latAt ?? {}).filter((v) => typeof v === "number");
    if (stamps.length === 0) return "";
    const mins = Math.floor((Date.now() - Math.max(...stamps)) / 60000);
    if (mins < 1) return t("agoNow");
    if (mins === 1) return t("agoMin");
    return `${mins} ${t("agoMins")}`;
  })();
  const [showImport, setShowImport] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [showQr, setShowQr] = useState(false);
  // Перенос на телефон: подписка + выбранный узел в одной ссылке.
  const [showTransfer, setShowTransfer] = useState(false);
  // Буфер обмена: предлагаем вставить, но никогда не подставляем молча.
  const [clipText, setClipText] = useState("");
  const [clipDismissed, setClipDismissed] = useState(false);
  // Поиск по списку: у провайдеров бывает по 30–60 узлов, и «найди мне Токио»
  // глазами — это прокрутка на полминуты.
  const [query, setQuery] = useState("");
  // «Только избранные» и порядок запоминаем: список узлов меняется, привычка
  // смотреть сначала быстрые — нет.
  const [favOnly, setFavOnly] = useState(false);
  const [sort, setSort] = useState<SortMode>(() => {
    const saved = localStorage.getItem("k4r.serverSort");
    return saved === "name" || saved === "country" ? saved : "ping";
  });
  const changeSort = (v: SortMode) => {
    setSort(v);
    try {
      localStorage.setItem("k4r.serverSort", v);
    } catch {
      /* настройка не критична */
    }
  };
  const favs = p.favorites ?? [];
  const q = query.trim().toLowerCase();
  const filtered = q
    ? servers.filter((s) =>
        [s.city, s.country, s.tag, s.cc].some((v) => (v ?? "").toLowerCase().includes(q)),
      )
    : servers;
  const shown = sortServers(favOnly ? filtered.filter((s) => favs.includes(s.id)) : filtered, sort, favs);
  const [hwidNote, setHwidNote] = useState("");
  // Сброс HWID прямо из ошибки: не нужно искать карточку в настройках
  const resetHwid = async () => {
    setHwidNote("");
    try {
      const next = await api.installIdReset();
      setHwidNote(`${t("hwidNew")}: ${next}`);
      // Новый слот у провайдера — сразу пробуем загрузить список, иначе
      // человеку придётся самому догадаться нажать «Обновить».
      void p.onLoad();
    } catch (e) {
      setHwidNote(String(e));
    }
  };
  const [speed, setSpeed] = useState<{ mbytes_per_second: number; bytes: number } | null>(null);

  // Буфер читаем только по нажатию: иначе Windows показывает запрос доступа
  // к буферу при каждом входе на экран — выглядит как слежка.
  const readClip = async () => {
    try {
      const text = await navigator.clipboard?.readText();
      if (!text) return;
      setClipText(text);
      setClipDismissed(false);
    } catch {
      /* доступа нет — молчим, человек нажмёт ещё раз */
    }
  };

  /** Вставить из буфера: перенос разворачиваем в адрес и узел. */
  const applyClip = () => {
    const kind = classifyClip(clipText);
    if (kind === "transfer") {
      const link = decodeSubLink(clipText);
      if (link) {
        p.setSubUrl(link.u);
        if (link.ua) p.setSubUa(link.ua);
        if (link.id) setSelectedId(link.id);
      }
    } else if (kind === "sub") {
      p.setSubUrl(clipText.trim());
    }
    setClipDismissed(true);
  };
  const [speedBusy, setSpeedBusy] = useState(false);
  const [speedNote, setSpeedNote] = useState("");
  const [wgOpen, setWgOpen] = useState(false);
  const [wgText, setWgText] = useState("");
  const [wgError, setWgError] = useState("");
  const [wgBusy, setWgBusy] = useState(false);
  const [warpBusy, setWarpBusy] = useState(false);
  const [warpNote, setWarpNote] = useState("");

  const doImport = async () => {
    await p.onImport(link);
    setLink("");
    setShowImport(false);
  };

  // Every visit re-checks the list: a server that died five minutes ago must not
  // still look healthy just because it answered when the app started.
  useEffect(() => {
    void doPing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doPing = async () => {
    setPinging(true);
    try {
      await p.onPing();
    } finally {
      setPinging(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>{t("serversTitle")}</h1>
        <p>{t("serversSub")}</p>
      </div>

      {!clipDismissed && shouldOffer(classifyClip(clipText), clipText, p.subUrl) && (
        <div className="clip-hint">
          <span className="grow">{t("clipHint")}</span>
          <button className="btn" style={{ width: "auto", paddingInline: 12 }} onClick={applyClip}>
            {t("clipPaste")}
          </button>
          <button className="ghost-btn" onClick={() => setClipDismissed(true)}>
            {t("clipNo")}
          </button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 12 }}>
          <div className="field">
            <label>{t("subUrl")}</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="input"
                value={p.subUrl}
                onChange={(e) => p.setSubUrl(e.target.value)}
                spellCheck={false}
              />
              <button
                className="ghost-btn"
                style={{ whiteSpace: "nowrap" }}
                onClick={() => void readClip()}
              >
                {t("clipRead")}
              </button>
            </div>
          </div>
          <div className="field">
            <label>{t("subHeaders")}</label>
            <input
              className="input"
              value={p.subUa}
              onChange={(e) => p.setSubUa(e.target.value)}
              spellCheck={false}
            />
          </div>
        </div>
        <p className="muted" style={{ margin: "10px 0 0" }}>{t("subHeadersHint")}</p>

        {p.subs.length > 0 && (
          <div className="sub-list">
            <div className="sub-list-head">{t("subsTitle")}</div>
            {p.subs.map((s) => (
              <div className="sub-row" key={s.url}>
                <span className="grow">
                  <div className="nm">{s.name || shortUrl(s.url)}</div>
                  <div className="sub">
                    {s.refreshed
                      ? `${t("updated")} ${new Date(s.refreshed * 1000).toLocaleString()}`
                      : t("neverUpdated")}
                  </div>
                  {subUsage(s, t) && <div className="sub usage">{subUsage(s, t)}</div>}
                </span>
                <button className="ghost-btn danger" onClick={() => p.removeSub(s.url)} aria-label={t("remove")}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {showQr && (
          <QrSheet
            t={t}
            value={p.subUrl}
            onCopy={() => navigator.clipboard?.writeText(p.subUrl).catch(() => undefined)}
          />
        )}

        {showTransfer && (
          <QrSheet
            t={t}
            value={p.subUrl.trim() ? encodeSubLink({ u: p.subUrl, ua: p.subUa, id: selectedId }) : ""}
            onCopy={() => {
              if (!p.subUrl.trim()) return;
              const link = encodeSubLink({ u: p.subUrl, ua: p.subUa, id: selectedId });
              navigator.clipboard?.writeText(link).catch(() => undefined);
            }}
          />
        )}

        {warnings.length > 0 && (
          <div className="notice">
            {warnings.map((w, i) => (
              <div key={i}>{w}</div>
            ))}
            {/* Лимит устройств: панель считает слоты по HWID. Сброс даёт новый
                слот на стороне панели — это первое, что стоит попробовать. */}
            {warnings.some((w) => /лимит устройств|device limit/i.test(w)) && (
              <>
                <button
                  className="ghost-btn"
                  style={{ marginTop: 8 }}
                  onClick={() => void resetHwid()}
                >
                  {t("hwidReset")}
                </button>
                <div style={{ marginTop: 6, opacity: 0.75 }}>
                  {t("hwidResetHint")}
                </div>
                {hwidNote && <div style={{ marginTop: 6 }}>{hwidNote}</div>}
              </>
            )}
          </div>
        )}

        <div className="sub-actions">
          <button className="btn primary" style={{ width: "auto", paddingInline: 16 }} onClick={p.onLoad} disabled={busy}>
            <RefreshIcon size={14} />
            {busy ? "…" : t("refresh")}
          </button>
          <button
            className="btn"
            style={{ width: "auto", paddingInline: 14 }}
            onClick={() => setShowImport((v) => !v)}
          >
            {t("importLink")}
          </button>
          <button
            className="btn"
            style={{ width: "auto", paddingInline: 14 }}
            onClick={() => setShowQr((v) => !v)}
            data-on={showQr}
          >
            {t("qrTitle")}
          </button>
          <button
            className="btn"
            style={{ width: "auto", paddingInline: 14 }}
            onClick={() => setShowTransfer((v) => !v)}
            data-on={showTransfer}
          >
            {t("transferBtn")}
          </button>
          <button
            className="btn"
            style={{ width: "auto", paddingInline: 14 }}
            onClick={() => {
              if (p.subUrl.trim()) p.addSub(p.subUrl, p.subUa, "");
            }}
            disabled={!p.subUrl.trim()}
          >
            {t("addSub")}
          </button>
          <button className="btn" style={{ width: "auto", paddingInline: 14 }} onClick={doPing} disabled={pinging}>
            <BoltIcon size={14} />
            {pinging ? t("checking") : t("pingAll")}
          </button>
          <button
            className="btn"
            style={{ width: "auto", paddingInline: 14 }}
            disabled={speedBusy}
            title={t("speedHint")}
            onClick={async () => {
              setSpeedBusy(true);
              setSpeedNote("");
              try {
                setSpeed(await api.speedTest());
              } catch (e) {
                setSpeed(null);
                setSpeedNote(String(e));
              } finally {
                setSpeedBusy(false);
              }
            }}
          >
            {speedBusy ? "…" : t("speedTest")}
          </button>
          {speed && (
            <span className="muted speed-out">
              {speed.mbytes_per_second.toFixed(1)} МБ/с · {Math.round(speed.bytes / 1024 / 1024)} МБ
            </span>
          )}
          {speedNote && <span className="muted warn-txt">{speedNote}</span>}
          <span className="muted">
            {realCount > 0 ? `${realCount} ${t("serversCount")}` : t("serversDemo")}
          </span>
          {/* Сколько узлов реально отвечает: видно до открытия списка */}
          {alive.total > 0 && (
            <span className="muted" title={`${t("aliveHint")}. ${t("globeLegend")}`}>
              {alive.alive} {t("aliveOf")} {alive.total}
              {/* когда мерили: серые точки — это «давно», а не «мёртв» */}
              {measuredAgo && ` · ${measuredAgo}`}
            </span>
          )}
        </div>

        {showImport && (
          <div style={{ marginTop: 12 }}>
            <div className="field">
              <label>{t("pasteLink")}</label>
              <textarea
                className="input"
                style={{ height: 84, padding: 10, resize: "vertical", lineHeight: 1.5 }}
                placeholder="vless://…"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                spellCheck={false}
              />
            </div>
            <button
              className="btn primary"
              style={{ width: "auto", marginTop: 8, paddingInline: 16 }}
              onClick={doImport}
              disabled={!link.trim()}
            >
              {t("importLink")}
            </button>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row">
          <div className="txt">
            <b>{t("wgTitle")}</b>
            <span>{t("wgHint")}</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button
              className="btn primary"
              style={{ width: "auto", paddingInline: 14 }}
              disabled={warpBusy}
              title={t("warpHint")}
              onClick={async () => {
                setWarpBusy(true);
                setWarpNote("");
                try {
                  await p.onAddWireguard(null);
                  setWarpNote("");
                } catch (e) {
                  setWarpNote(String(e));
                } finally {
                  setWarpBusy(false);
                }
              }}
            >
              {warpBusy ? t("warpBusy") : t("warpButton")}
            </button>
            <button
              className="btn"
              style={{ width: "auto", paddingInline: 14 }}
              onClick={() => setWgOpen((v) => !v)}
            >
              {wgOpen ? t("wgCancel") : t("wgAdd")}
            </button>
          </div>
        </div>
        <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>{t("warpHint")}</div>
        {warpNote && <div className="muted warn-txt" style={{ marginTop: 6 }}>{warpNote}</div>}
        {wgOpen && (
          <div style={{ marginTop: 10 }}>
            <div className="field">
              <label>{t("wgPaste")}</label>
              <textarea
                className="input"
                style={{ height: 130, padding: 10, resize: "vertical", lineHeight: 1.5, fontFamily: "var(--mono)" }}
                placeholder="[Interface]&#10;PrivateKey = …&#10;[Peer]&#10;PublicKey = …&#10;Endpoint = engage.cloudflareclient.com:2408"
                value={wgText}
                onChange={(e) => setWgText(e.target.value)}
                spellCheck={false}
              />
            </div>
            {wgError && <div className="muted warn-txt" style={{ marginTop: 6 }}>{wgError}</div>}
            <button
              className="btn primary"
              style={{ width: "auto", marginTop: 8, paddingInline: 16 }}
              disabled={wgBusy || !wgText.trim()}
              onClick={async () => {
                setWgBusy(true);
                setWgError("");
                try {
                  await p.onAddWireguard(wgText);
                  setWgText("");
                  setWgOpen(false);
                } catch (e) {
                  setWgError(String(e));
                } finally {
                  setWgBusy(false);
                }
              }}
            >
              {wgBusy ? "…" : t("wgAdd")}
            </button>
          </div>
        )}
      </div>

      {servers.length === 0 && (
        <div className="card empty-box">
          <img src="/mascot/offer.webp" alt="" draggable={false} />
          <div>
            <h3>{t("noServersTitle")}</h3>
            <p className="muted">{t("noServersText")}</p>
          </div>
        </div>
      )}

      {servers.length > 0 && (
        <div className="card server-tools">
          <input
            className="input"
            placeholder={t("searchNodes")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
            aria-label={t("searchNodes")}
          />
          {q && (
            <button className="ghost-btn" onClick={() => setQuery("")} aria-label={t("clear")}>
              ×
            </button>
          )}
          <button
            className="filter-chip"
            data-on={favOnly}
            aria-pressed={favOnly}
            onClick={() => setFavOnly((v) => !v)}
            title={t("favoritesHint")}
          >
            ★ {t("favorites")}
            {favs.length > 0 && <b>{favs.length}</b>}
          </button>
          <select
            className="input select sort-select"
            value={sort}
            onChange={(e) => changeSort(e.target.value as SortMode)}
            aria-label={t("sortBy")}
          >
            <option value="ping">{t("sortPing")}</option>
            <option value="name">{t("sortName")}</option>
            <option value="country">{t("sortCountry")}</option>
          </select>
          <span className="muted count">
            {shown.length} / {servers.length}
          </span>
        </div>
      )}

      {servers.length > 0 && (
        <ServerMap
          servers={servers}
          selectedId={selectedId}
          onPick={setSelectedId}
          t={t}
        />
      )}

      {servers.length > 0 && (q || favOnly) && shown.length === 0 && (
        <div className="card" style={{ padding: 14 }}>
          <span className="muted">{favOnly && !q ? t("favEmpty") : t("nothingFound")}</span>
        </div>
      )}

      {servers.length > 0 && shown.length > 0 && (
      <div className="card" style={{ padding: 8 }}>
        <div className="server-list">
          {shown.map((s) => (
            <button
              key={s.id}
              className="server"
              aria-current={s.id === selectedId}
              onClick={() => setSelectedId(s.id)}
              style={{ gridTemplateColumns: "22px 26px minmax(0,1fr) 90px 70px auto" }}
            >
              <span
                className="fav-star"
                role="button"
                tabIndex={0}
                aria-pressed={favs.includes(s.id)}
                aria-label={favs.includes(s.id) ? t("favoriteRemove") : t("favoriteAdd")}
                data-on={favs.includes(s.id) ? "1" : "0"}
                onClick={(e) => {
                  e.stopPropagation();
                  p.toggleFavorite?.(s.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    p.toggleFavorite?.(s.id);
                  }
                }}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path
                    d="M12 3.7l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 17l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"
                    fill={favs.includes(s.id) ? "currentColor" : "none"}
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <Flag cc={s.flag || s.cc} />
              <span>
                <div className="name">{s.city}</div>
                <div className="sub">{s.country}</div>
              </span>
              <span className="sub" style={{ fontFamily: "var(--mono)" }}>
                {s.kind === "wireguard" ? "WG" : s.tag}
              </span>
              <span
                role="checkbox"
                aria-checked={!!s.reserve}
                title={t("wgReserveHint")}
                className="sub"
                style={{ fontSize: 11, opacity: s.reserve ? 1 : 0.45 }}
                onClick={(e) => {
                  e.stopPropagation();
                  p.onToggleReserve(s.id);
                }}
              >
                {t("wgReserve")}
              </span>
              <span className="lat" style={{ justifyContent: "flex-end" }}>
                {p.lat[s.id] === null ? (
                  <span className="dead">{t("serverDead")}</span>
                ) : (
                  <>
                    <span
                      className="node-dot"
                      data-fresh={isFresh(p.latAt?.[s.id]) ? "1" : "0"}
                      title={isFresh(p.latAt?.[s.id]) ? t("nodeFresh") : t("nodeStale")}
                    />
                    <span className="bars" data-q={s.quality}>
                      <i />
                      <i />
                      <i />
                    </span>
                    {(() => {
                      const hist = p.sparks?.[s.id] ?? [];
                      const pts = sparkPoints(hist, 40, 12);
                      return pts ? (
                        <svg
                          className="node-spark"
                          width="40"
                          height="12"
                          viewBox="0 0 40 12"
                          data-tone={sparkTone(hist[hist.length - 1])}
                          aria-hidden="true"
                        >
                          <polyline points={pts} />
                        </svg>
                      ) : null;
                    })()}
                    {p.lat[s.id] ?? (s.lat === 0 ? "—" : s.lat)}
                  </>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>
      )}
    </>
  );
}
