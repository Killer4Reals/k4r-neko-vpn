import { useMemo, useState } from "react";
import type { AppEntry } from "../data";
import { SearchIcon } from "../icons";

type Props = {
  t: (k: string) => string;
  list: AppEntry[];
  toggleApp: (id: string) => void;
};

export function SplitScreen({ t, list, toggleApp }: Props) {
  const [q, setQ] = useState("");
  const filtered = useMemo(
    () => list.filter((a) => a.name.toLowerCase().includes(q.toLowerCase()) || a.exe.toLowerCase().includes(q.toLowerCase())),
    [list, q],
  );
  const via = filtered.filter((a) => a.via);
  const direct = filtered.filter((a) => !a.via);

  return (
    <>
      <div className="page-head">
        <h1>{t("splitTitle")}</h1>
        <p>{t("splitSub")}</p>
      </div>

      <div className="field" style={{ marginBottom: 14, maxWidth: 320 }}>
        <div style={{ position: "relative" }}>
          <span style={{ position: "absolute", left: 11, top: 10, color: "var(--txt-3)" }}>
            <SearchIcon size={16} />
          </span>
          <input
            className="input"
            style={{ paddingLeft: 34, width: "100%" }}
            placeholder={t("searchApp")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {filtered.length === 0 && !q && (
        <div className="card empty-box" style={{ marginBottom: 14 }}>
          <img src="/mascot/laptop.webp" alt="" draggable={false} />
          <div>
            <h3>{t("noAppsTitle")}</h3>
            <p className="muted">{t("noAppsText")}</p>
          </div>
        </div>
      )}

      {filtered.length === 0 && q && (
        <p className="muted" style={{ marginBottom: 14 }}>{t("noMatches")}</p>
      )}

      <div className="split">
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="tag" style={{ color: "#d9ffd0", borderColor: "var(--green-line)", background: "var(--green-soft)" }}>
              {t("viaVpn")}
            </span>
            <span className="muted">{via.length}</span>
          </div>
          <div className="app-list">
            {via.map((a) => (
              <div className="app-item" key={a.id}>
                <span className="ico">{a.name.slice(0, 2).toUpperCase()}</span>
                <span className="grow">
                  <div className="nm">{a.name}</div>
                  <div className="exe">{a.exe}</div>
                </span>
                <button className="switch" aria-checked="true" onClick={() => toggleApp(a.id)} />
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="tag">{t("direct")}</span>
            <span className="muted">{direct.length}</span>
          </div>
          <div className="app-list">
            {direct.map((a) => (
              <div className="app-item" key={a.id}>
                <span className="ico">{a.name.slice(0, 2).toUpperCase()}</span>
                <span className="grow">
                  <div className="nm">{a.name}</div>
                  <div className="exe">{a.exe}</div>
                </span>
                <button className="switch" aria-checked="false" onClick={() => toggleApp(a.id)} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="muted" style={{ marginTop: 14 }}>{t("splitHint")}</p>
    </>
  );
}
