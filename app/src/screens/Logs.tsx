import { useCallback, useEffect, useState } from "react";
import type { ConnState } from "../data";
import { api, inTauri } from "../api";
import { RefreshIcon } from "../icons";

type Props = { t: (k: string) => string; conn: ConnState; error: string };

export function LogsScreen({ t, conn, error }: Props) {
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
      </div>

      <div
        className="card logbox"
        style={{ fontFamily: "var(--mono)", fontSize: 11.5, lineHeight: 1.7, whiteSpace: "pre-wrap" }}
      >
        {text ? text : <span className="muted">{t("logsEmpty")}</span>}
      </div>

      <div className="muted" style={{ marginTop: 10 }}>
        state: {conn}
        {error ? ` · ${error}` : ""}
      </div>
    </>
  );
}
