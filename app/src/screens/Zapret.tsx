import { useEffect, useMemo, useState } from "react";
import { api, inTauri, type ZapretStatus } from "../api";
import { filterPresets, presetCatalog, PRESET_TAGS, type PresetFilter } from "../zapretCatalog";

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
  const [zp, setZp] = useState<ZapSettings | null>(null);
  // Каталог: тот же список файлов, но с тегами и фильтрами, без чужого сайта.
  const [catOpen, setCatOpen] = useState(false);
  const [tag, setTag] = useState<PresetFilter>(() => {
    const saved = localStorage.getItem("k4r.zapretTag");
    return saved === "games" || saved === "video" || saved === "discord" || saved === "quic" ? saved : "all";
  });
  const catalog = useMemo(() => presetCatalog(presets), [presets]);
  const shown = useMemo(() => filterPresets(catalog, tag), [catalog, tag]);

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
        <p>{t("zapretSub")}</p>
      </div>

      {/* Полоса состояния: вместо сцены боя — то, что реально важно:
          работает ли защита, какой пресет и что за процесс. */}
      <div className={`guard-strip${on ? " on" : ""}`}>
        <span className="guard-led" aria-hidden />
        <div className="guard-copy">
          <b>{stateLabel}</b>
          <span>
            {preset || t("zapretNone")}
            {status?.pid ? ` · PID ${status.pid}` : ""}
          </span>
        </div>
        <button
          className="btn"
          style={{ width: "auto", paddingInline: 16 }}
          disabled={busy || foreign}
          onClick={toggle}
        >
          {on ? t("zapretHalt") : t("zapretRun")}
        </button>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row">
          <div className="txt">
            <b>{t("tunnelGuard")}</b>
            <span>{t("zapretMaskHint")}</span>
          </div>
          <button
            role="switch" className="switch"
            aria-checked={on}
            aria-label={t("tunnelGuard")}
            disabled={busy || foreign}
            title={foreign ? t("zapretForeignHint") : undefined}
            onClick={toggle}
          />
        </div>

        <div className="row">
          <div className="txt">
            <b>{t("preset")}</b>
            <span className="mono">{preset || t("zapretNone")}</span>
          </div>
          <button
            className="btn"
            style={{ width: "auto", paddingInline: 14 }}
            onClick={() => setCatOpen((v) => !v)}
          >
            {catOpen ? t("presetClose") : t("presetOpen")}
          </button>
        </div>

        {catOpen && (
          <div className="preset-cat">
            <div className="preset-tags">
              {(["all", ...PRESET_TAGS] as PresetFilter[]).map((f) => (
                <button
                  key={f}
                  className="filter-chip"
                  data-on={tag === f}
                  onClick={() => {
                    setTag(f);
                    localStorage.setItem("k4r.zapretTag", f);
                  }}
                >
                  {t(f === "all" ? "presetAll" : `presetTag_${f}`)}
                </button>
              ))}
            </div>
            {shown.length === 0 ? (
              <div className="muted" style={{ padding: "10px 2px" }}>
                {t(presets.length === 0 ? "zapretNone" : "presetNoFilter")}
              </div>
            ) : (
              shown.map((pi) => (
                <div key={pi.file} className={`preset-row${pi.file === preset ? " on" : ""}`}>
                  <div className="preset-copy">
                    <b>{pi.title}</b>
                    <span>{pi.methods.length ? pi.methods.join(" + ") : t("presetPlain")}</span>
                  </div>
                  {pi.file === preset ? (
                    <span className="tag">{t("presetCurrent")}</span>
                  ) : (
                    <button
                      className="btn"
                      style={{ width: "auto", paddingInline: 12 }}
                      onClick={() => {
                        setPreset(pi.file);
                        onPreset(pi.file);
                      }}
                    >
                      {t("presetApply")}
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        <div className="row">
          <div className="txt">
            <b>{t("zapretAuto")}</b>
            <span>{t("zapretAutoHint")}</span>
          </div>
          <button role="switch" className="switch" aria-checked={auto} aria-label={t("zapretAuto")} onClick={() => setAuto(!auto)}>
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
                  role="switch" className="switch"
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
