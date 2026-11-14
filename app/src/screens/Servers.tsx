import { useState } from "react";
import type { Server } from "../data";
import { BoltIcon, RefreshIcon } from "../icons";

type Props = {
  t: (k: string) => string;
  servers: Server[];
  selectedId: string;
  setSelectedId: (id: string) => void;
  subUrl: string;
  subUa: string;
  setSubUrl: (v: string) => void;
  setSubUa: (v: string) => void;
  onLoad: () => void;
  onImport: (text: string) => Promise<void>;
  onPing: () => Promise<void>;
  warnings: string[];
  busy: boolean;
  realCount: number;
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
          <button className="btn" style={{ width: "auto", paddingInline: 14 }} onClick={doPing} disabled={pinging}>
            <BoltIcon size={14} />
            {pinging ? "…" : t("checkPing")}
          </button>
          <span className="muted">{realCount > 0 ? `${realCount}` : "demo"}</span>
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
      </div>
    </>
  );
}
