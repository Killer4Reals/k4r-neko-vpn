import { useEffect, useState } from "react";
import type { Server } from "../data";
import type { SubInfo, SubSource } from "../api";
import { QrSheet } from "../Qr";
import { api } from "../api";
import { isFresh } from "../health";
import { BoltIcon, RefreshIcon } from "../icons";
import { Flag } from "../Flag";
import { ServerMap } from "../ServerMap";



type Props = {
  t: (k: string) => string;
  servers: Server[];
  selectedId: string;
  setSelectedId: (id: string) => void;
  /** id -> ms of the last health check, null = no answer */
  lat: Record<string, number | null>;
  /** id -> когда мерили, чтобы отличать свежий замер от старого */
  latAt?: Record<string, number>;
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
  const [showImport, setShowImport] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [speed, setSpeed] = useState<{ mbytes_per_second: number; bytes: number } | null>(null);
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

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 12 }}>
          <div className="field">
            <label>{t("subUrl")}</label>
            <input
              className="input"
              value={p.subUrl}
              onChange={(e) => p.setSubUrl(e.target.value)}
              spellCheck={false}
            />
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

        {warnings.length > 0 && (
          <div className="notice">
            {warnings.map((w, i) => (
              <div key={i}>{w}</div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
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
            onClick={() => {
              if (p.subUrl.trim()) p.addSub(p.subUrl, p.subUa, "");
            }}
            disabled={!p.subUrl.trim()}
          >
            {t("addSub")}
          </button>
          <button className="btn" style={{ width: "auto", paddingInline: 14 }} onClick={doPing} disabled={pinging}>
            <BoltIcon size={14} />
            {pinging ? "…" : t("checkPing")}
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
        <ServerMap
          servers={servers}
          selectedId={selectedId}
          onPick={setSelectedId}
          t={t}
        />
      )}

      {servers.length > 0 && (
      <div className="card" style={{ padding: 8 }}>
        <div className="server-list">
          {servers.map((s) => (
            <button
              key={s.id}
              className="server"
              aria-current={s.id === selectedId}
              onClick={() => setSelectedId(s.id)}
              style={{ gridTemplateColumns: "26px minmax(0,1fr) 90px 70px auto" }}
            >
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
