import { useCallback, useEffect, useState } from "react";
import type { ConnState } from "../data";
import { api, inTauri } from "../api";
import { RefreshIcon } from "../icons";

type Props = {
  t: (k: string) => string;
  conn: ConnState;
  error: string;
  onExport: () => Promise<string>;
};

export function LogsScreen({ t, conn, error, onExport }: Props) {
  const [saved, setSaved] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!inTauri) return;
    setBusy(true);
    try {
      setText(await api.logsTail("engine", 200));
    } catch {
      setText("");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    if (!inTauri) return;
    const id = window.setInterval(refresh, 4000);
    return () => window.clearInterval(id);
  }, [refresh]);

  return (
    <>
      <div className="page-head">
        <h1>{t("logsTitle")}</h1>
        <p>{t("logsSub")}</p>
        <div style={{ flex: 1 }} />
        <button className="ghost-btn" onClick={refresh}>
          <RefreshIcon size={13} /> {busy ? "…" : t("refresh")}
        </button>
        <button
          className="ghost-btn"
          onClick={async () => {
            const path = await onExport();
            setSaved(path);
          }}
          title={t("exportLogHint")}
        >
          {t("exportLog")}
        </button>
      </div>

      {text ? (
        <div
          className="card logbox"
          style={{ fontFamily: "var(--mono)", fontSize: 11.5, lineHeight: 1.7, whiteSpace: "pre-wrap" }}
        >
          {text}
        </div>
      ) : (
        <div className="card empty-box">
          <img src="/mascot/log-empty.webp" alt="" draggable={false} />
          <div>
            <h3>{t("logsEmptyTitle")}</h3>
            <p className="muted">{t("logsEmpty")}</p>
          </div>
        </div>
      )}

      <div className="muted" style={{ marginTop: 10 }}>
        state: {conn}
        {error ? ` · ${error}` : ""}
        {saved ? <div>{t("savedTo")} {saved}</div> : null}
      </div>
    </>
  );
}
