import { useEffect, useState } from "react";
import { api, inTauri, type ZapretStatus } from "../api";

type Props = {
  t: (k: string) => string;
  initialDir: string | null;
};

export function ZapretScreen({ t, initialDir }: Props) {
  const [dir, setDir] = useState(initialDir ?? "");
  const [presets, setPresets] = useState<string[]>([]);
  const [preset, setPreset] = useState("");
  const [status, setStatus] = useState<ZapretStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!inTauri) return;
    (async () => {
      const found = initialDir ?? (await api.zapretDetect());
      if (found) {
        setDir(found);
        const list = await api.zapretPresets(found);
        setPresets(list);
        setPreset((p) => p || list[0] || "");
      }
      try {
        setStatus(await api.zapretStatus());
      } catch {
        /* engine status is optional information */
      }
    })();
  }, [initialDir]);

  // The switch reflects the real process, never a wish: an outside copy of
  // Zapret (someone else's winws2) is shown as running and left alone.
  const on = status?.state === "running" || status?.state === "external";
  const foreign = status?.state === "external";

  const toggle = async () => {
    setError("");
    if (!inTauri || foreign) return;
    setBusy(true);
    try {
      if (status?.state === "running") {
        setStatus(await api.zapretStop());
      } else {
        const st = await api.zapretStart(dir, preset);
        setStatus(st);
        if (st.state === "external") setError(st.message);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!inTauri) return;
    const id = window.setInterval(() => {
      api.zapretStatus().then(setStatus).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(id);
  }, []);

  const stateLabel =
    status?.state === "running"
      ? t("zapretRunning")
      : status?.state === "external"
        ? t("zapretExternal")
        : status?.state === "error"
          ? t("zapretStopped")
          : t("unknown");

  return (
    <>
      <div className="page-head">
        <h1>{t("zapretTitle")}</h1>
        <span className="tag beta">beta</span>
        <p>{t("zapretSub")}</p>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row">
          <div className="txt">
            <b>{t("tunnelGuard")}</b>
            <span>{t("zapretSub")}</span>
          </div>
          <button
            className="switch"
            aria-checked={on}
            disabled={busy || foreign}
            title={foreign ? t("zapretForeignHint") : undefined}
            onClick={toggle}
          />
        </div>

        <div className="row">
          <div className="txt">
            <b>{t("preset")}</b>
            <span>{preset || "—"}</span>
          </div>
          <select
            className="input"
            style={{ width: 320 }}
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
          >
            {presets.length === 0 && <option value="">{t("zapretNone")}</option>}
            {presets.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div className="row">
          <div className="txt">
            <b>{t("zapretPath")}</b>
            <span>{dir || t("zapretNotFound")}</span>
          </div>
          <span className="tag">
            {presets.length} {t("presetsCount")}
          </span>
        </div>
      </div>

      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="card">
        <dl className="kv">
          <dt>{t("health")}</dt>
          <dd style={{ color: status?.state === "running" ? "var(--green)" : "var(--txt-3)" }}>
            {stateLabel}
          </dd>
          <dt>{t("core")}</dt>
          <dd>winws2 · 21.1.7.261</dd>
          <dt>PID</dt>
          <dd>{status?.pid ? status.pid : "—"}</dd>
        </dl>
      </div>
    </>
  );
}
