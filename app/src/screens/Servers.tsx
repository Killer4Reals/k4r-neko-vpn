import type { Server } from "../data";
import { RefreshIcon } from "../icons";

type Props = {
  t: (k: string) => string;
  servers: Server[];
  selectedId: string;
  setSelectedId: (id: string) => void;
};

export function ServersScreen({ t, servers, selectedId, setSelectedId }: Props) {
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
            <input className="input" defaultValue="https://example.invalid/subscription" spellCheck={false} />
          </div>
          <div className="field">
            <label>{t("subHeaders")}</label>
            <input className="input" defaultValue="User-Agent: Happ/4.7.2" spellCheck={false} />
          </div>
        </div>
        <p className="muted" style={{ margin: "10px 0 0" }}>{t("subHeadersHint")}</p>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn" style={{ width: "auto", paddingInline: 14 }}>
            <RefreshIcon size={14} />
            {t("refresh")}
          </button>
          <button className="btn" style={{ width: "auto", paddingInline: 14 }}>{t("importLink")}</button>
          <button className="btn" style={{ width: "auto", paddingInline: 14 }}>{t("importFile")}</button>
        </div>
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
                {s.lat}
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
