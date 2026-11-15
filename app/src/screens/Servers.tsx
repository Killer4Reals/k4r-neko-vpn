import { useEffect, useState } from "react";
import type { Server } from "../data";
import type { SubSource } from "../api";
import { BoltIcon, RefreshIcon } from "../icons";

type Props = {
  t: (k: string) => string;
  servers: Server[];
  selectedId: string;
  setSelectedId: (id: string) => void;
  /** id -> ms of the last health check, null = no answer */
  lat: Record<string, number | null>;
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
};

const shortUrl = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u.slice(0, 32);
  }
};

export function ServersScreen(p: Props) {
  const { t, servers, selectedId, setSelectedId, warnings, busy, realCount } = p;
  const [link, setLink] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [pinging, setPinging] = useState(false);

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
                </span>
                <button className="ghost-btn danger" onClick={() => p.removeSub(s.url)} aria-label={t("remove")}>
                  ×
                </button>
              </div>
            ))}
          </div>
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

      {servers.length === 0 && (
        <div className="card empty-box">
          <img src="/mascot/empty.webp" alt="" draggable={false} />
          <div>
            <h3>{t("noServersTitle")}</h3>
            <p className="muted">{t("noServersText")}</p>
          </div>
        </div>
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
              style={{ gridTemplateColumns: "26px minmax(0,1fr) 90px 70px" }}
            >
              <span className="flag-code" data-on={s.id === selectedId} style={{ width: 26, height: 19, fontSize: 10 }}>
                {s.cc}
              </span>
              <span>
                <div className="name">{s.city}</div>
                <div className="sub">{s.country}</div>
              </span>
              <span className="sub" style={{ fontFamily: "var(--mono)" }}>{s.tag}</span>
              <span className="lat" style={{ justifyContent: "flex-end" }}>
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
      </div>
      )}
    </>
  );
}
