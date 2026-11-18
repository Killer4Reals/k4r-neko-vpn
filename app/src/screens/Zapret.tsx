import { useEffect, useState } from "react";
import { api, inTauri, type ZapretStatus } from "../api";
import { FightScene } from "../FightScene";

type Props = {
  t: (k: string) => string;
  initialDir: string | null;
  savedPreset: string;
  onPreset: (name: string) => void;
  /** поднимать вместе с приложением, без отдельной программы */
  auto: boolean;
  setAuto: (v: boolean) => void;
  /** прокси для Telegram внутри нашего туннеля */
  tgProxy: boolean;
  setTgProxy: (v: boolean) => void;
  tgPort: number;
};

type ZapSettings = {
  dir: string;
  dns: { doh_enabled: boolean; custom_servers: unknown };
  telegram: { enabled: boolean; mode: string | null; port: number | null; host: string | null };
};

export function ZapretScreen({
  t,
  initialDir,
  savedPreset,
  onPreset,
  auto,
  setAuto,
  tgProxy,
  setTgProxy,
  tgPort,
}: Props) {
  const [dir, setDir] = useState(initialDir ?? "");
  const [presets, setPresets] = useState<string[]>([]);
  const [preset, setPreset] = useState("");
  const [status, setStatus] = useState<ZapretStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState(0);
  const [zp, setZp] = useState<ZapSettings | null>(null);

  useEffect(() => {
    if (!inTauri) return;
    (async () => {
      const found = initialDir ?? (await api.zapretDetect());
      if (found) {
        setDir(found);
        const list = await api.zapretPresets(found);
        setPresets(list);
        // keep the owner's choice: only fall back when it is gone from the folder
        setPreset((current) => {
          const keep = savedPreset || current;
          if (keep && list.includes(keep)) return keep;
          return list[0] || "";
        });
      }
      try {
        setStatus(await api.zapretStatus());
      } catch {
        /* engine status is optional information */
      }
      try {
        setZp(await api.zapretSettings());
      } catch {
        /* нет папки Zapret — блок просто не показываем */
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
        // каждое включение — новый удар по РКН
        setHits((n) => n + 1);
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
      <FightScene active={status?.state === "running" || status?.state === "external"} hits={hits} />
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
            onChange={(e) => {
              setPreset(e.target.value);
              onPreset(e.target.value);
            }}
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
            <b>{t("zapretAuto")}</b>
            <span>{t("zapretAutoHint")}</span>
          </div>
          <button className="switch" aria-checked={auto} onClick={() => setAuto(!auto)}>
            <span />
          </button>
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

      {zp && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="zp-head">{t("zpCompare")}</div>
          <dl className="kv">
            <dt>Zapret · DNS</dt>
            <dd>
              {zp.dns.doh_enabled ? t("zpDohOn") : t("zpDohOff")}
              {Array.isArray(zp.dns.custom_servers) && zp.dns.custom_servers.length > 0
                ? ` · ${t("zpOwnServers")}: ${(zp.dns.custom_servers as string[]).join(", ")}`
                : ""}
            </dd>
            <dt>{t("zpOurDns")}</dt>
            <dd className="muted">{t("zpOurDnsHint")}</dd>
            <dt>Zapret · Telegram</dt>
            <dd>
              {zp.telegram.enabled
                ? `${zp.telegram.mode ?? "socks5"} · ${zp.telegram.host ?? "0.0.0.0"}:${zp.telegram.port ?? "—"}`
                : t("zpTgOff")}
            </dd>
            <dt>{t("zpOurTg")}</dt>
            <dd>
              <div className="tg-row">
                <button
                  className="switch"
                  aria-checked={tgProxy}
                  onClick={() => setTgProxy(!tgProxy)}
                  aria-label={t("zpOurTg")}
                />
                <span className="muted">
                  {tgProxy
                    ? `127.0.0.1:${tgPort} · ${t("zpOurTgOn")}`
                    : t("zpOurTgOff")}
                </span>
              </div>
              {tgProxy && <div className="muted tg-hint">{t("zpOurTgHint")}</div>}
            </dd>
          </dl>
        </div>
      )}

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
