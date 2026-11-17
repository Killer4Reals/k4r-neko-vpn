import { useEffect, useState } from "react";
import type { Lang } from "../i18n";
import type { Theme } from "../App";
import { api, inTauri, type KillSwitchStatus } from "../api";
import { DnsPick } from "../DnsPick";

type Props = {
  t: (k: string) => string;
  lang: Lang;
  setLang: (l: Lang) => void;
  killSwitch: boolean;
  setKillSwitch: (v: boolean) => void;
  /** состояние ОС-блокировки (WFP helper) */
  ksState: KillSwitchStatus;
  /** туннель подключён? от него зависит, работает ли сеть при блокировке */
  connected: boolean;
  autoSelect: number;
  setAutoSelect: (v: number) => void;
  autoSelectLoss: boolean;
  setAutoSelectLoss: (v: boolean) => void;
  autostart: boolean;
  setAutostart: (v: boolean) => void;
  connectOnStart: boolean;
  setConnectOnStart: (v: boolean) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  dnsMode: "tunnel" | "system";
  setDnsMode: (v: "tunnel" | "system") => void;
  dnsServer: string;
  setDnsServer: (v: string) => void;
  subRefreshHours: number;
  setSubRefreshHours: (v: number) => void;
  updateUrl: string;
  setUpdateUrl: (v: string) => void;
  blockIpv6: boolean;
  setBlockIpv6: (v: boolean) => void;
  closeToTray: boolean;
  setCloseToTray: (v: boolean) => void;
  minimizeToTray: boolean;
  setMinimizeToTray: (v: boolean) => void;
  notifyOn: boolean;
  setNotifyOn: (v: boolean) => void;
  hotkey: string;
  setHotkey: (v: string) => void;
  onExportLog: () => Promise<string>;
  onDeviceId: (id: string) => void;
};

export function SettingsScreen(p: Props) {
  const { t, lang, setLang, killSwitch, setKillSwitch, autostart, setAutostart, theme, setTheme } = p;
  const { connectOnStart, setConnectOnStart } = p;
  const [deviceId, setDeviceId] = useState("");
  useEffect(() => {
    if (!inTauri) return;
    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then(setVersion)
      .catch(() => undefined);
  }, []);
  // версию берём у самого приложения: захардкоженная врала бы при обновлении
  const [version, setVersion] = useState("");
  const [updateState, setUpdateState] = useState<"idle" | "busy" | "latest" | "found" | "error" | "blocked">("idle");
  const [updateNote, setUpdateNote] = useState("");
  const [updateLink, setUpdateLink] = useState("");
  const [deviceDraft, setDeviceDraft] = useState("");
  const [hotkeyDraft, setHotkeyDraft] = useState(p.hotkey);
  const [exported, setExported] = useState("");
  const [backup, setBackup] = useState("");
  const [restore, setRestore] = useState("");
  const [restoreNote, setRestoreNote] = useState("");
  const [core, setCore] = useState<{ version: string; updated: boolean }>({ version: "", updated: false });
  const [coreBusy, setCoreBusy] = useState(false);
  const [coreNote, setCoreNote] = useState("");
  const [leak, setLeak] = useState<{ resolver: string; egress: string } | null>(null);
  const [leakBusy, setLeakBusy] = useState(false);
  const [leakError, setLeakError] = useState("");
  const [stats, setStats] = useState<{ day: string; down: number; up: number }[]>([]);

  useEffect(() => {
    if (!inTauri) return;
    api.appVersion().then(setVersion).catch(() => undefined);
    api
      .coreInfo()
      .then((info) => setCore({ version: info.core_version, updated: info.core_updated }))
      .catch(() => undefined);
    api.statsRead().then(setStats).catch(() => undefined);
    api
      .installId()
      .then((id) => {
        setDeviceId(id);
        setDeviceDraft(id);
      })
      .catch(() => undefined);
  }, []);

  // Плашка состояния ОС-блокировки: зелёная — работает, жёлтая — перезапуск,
  // красная — защита снята, серая — выключена.
  const ksLabel =
    p.ksState.state === "on"
      ? "ksOnLabel"
      : p.ksState.state === "restarting"
        ? "ksRestartingLabel"
        : p.ksState.state === "lost"
          ? "ksLostLabel"
          : p.ksState.state === "unavailable"
            ? "ksUnavailableLabel"
            : "ksOffLabel";
  const ksText =
    p.ksState.state === "on"
      ? `${t("ksOnHint")} · ${t("ksFilters")}: ${p.ksState.filters}${p.ksState.tun ? " · TUN" : ""}`
      : p.ksState.state === "restarting"
        ? t("ksRestartingHint")
        : p.ksState.state === "lost"
          ? p.ksState.message || t("ksLostHint")
          : p.ksState.state === "unavailable"
            ? p.ksState.message || t("ksUnavailableHint")
            : t("ksOffHint");
  const ksColor =
    p.ksState.state === "on"
      ? "var(--green)"
      : p.ksState.state === "restarting"
        ? "#e8b33a"
        : p.ksState.state === "lost" || p.ksState.state === "unavailable"
          ? "var(--red, #ff5a5a)"
          : "var(--txt-3)";

  return (
    <>
      <div className="page-head">
        <h1>{t("settingsTitle")}</h1>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row">
          <div className="txt">
            <b>{t("language")}</b>
          </div>
          <div className="seg">
            <button data-on={lang === "ru"} onClick={() => setLang("ru")}>
              Русский
            </button>
            <button data-on={lang === "en"} onClick={() => setLang("en")}>
              English
            </button>
          </div>
        </div>
        <div className="row">
          <div className="txt">
            <b>{t("theme")}</b>
            <span>{t("themeHint")}</span>
          </div>
          <div className="seg">
            <button data-on={theme === "dark"} onClick={() => setTheme("dark")}>
              {t("themeDark")}
            </button>
            <button data-on={theme === "light"} onClick={() => setTheme("light")}>
              {t("themeLight")}
            </button>
            <button data-on={theme === "mascot"} onClick={() => setTheme("mascot")}>
              {t("themeMascot")}
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row">
          <div className="txt">
            <b>{t("connectOnStart")}</b>
            <span>{t("connectOnStartHint")}</span>
          </div>
          <button
            className="switch"
            aria-checked={connectOnStart}
            onClick={() => setConnectOnStart(!connectOnStart)}
          >
            <span />
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row">
          <div className="txt">
            <b>{t("autostart")}</b>
          </div>
          <button
            className="switch"
            aria-checked={autostart}
            onClick={async () => {
              const next = !autostart;
              setAutostart(next);
              if (inTauri) {
                try {
                  setAutostart(await api.setStartWithWindows(next));
                } catch {
                  setAutostart(!next);
                }
              }
            }}
          />
        </div>
        <div className="row">
          <div className="txt">
            <b>{t("tray")}</b>
            <span>{t("trayHint")}</span>
          </div>
          <button
            className="switch"
            aria-checked={p.closeToTray}
            onClick={() => p.setCloseToTray(!p.closeToTray)}
          />
        </div>
        <div className="row">
          <div className="txt">
            <b>{t("notify")}</b>
            <span>{t("notifyHint")}</span>
          </div>
          <button className="switch" aria-checked={p.notifyOn} onClick={() => p.setNotifyOn(!p.notifyOn)} />
        </div>
        <div className="row">
          <div className="txt">
            <b>{t("hotkey")}</b>
            <span>{t("hotkeyHint")}</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              className="input"
              style={{ width: 150 }}
              value={hotkeyDraft}
              spellCheck={false}
              onChange={(e) => setHotkeyDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") p.setHotkey(hotkeyDraft.trim());
              }}
            />
            <button
              className="btn"
              style={{ width: "auto", paddingInline: 12 }}
              onClick={() => p.setHotkey(hotkeyDraft.trim())}
            >
              {t("apply")}
            </button>
          </div>
        </div>
        <div className="row">
          <div className="txt">
            <b>{t("killSwitch")}</b>
            <span>{t("killSwitchHint")}</span>
          </div>
          <button className="switch" aria-checked={killSwitch} onClick={() => setKillSwitch(!killSwitch)} />
        </div>
        <div className="row" style={{ display: "block" }}>
          <div className="txt" style={{ maxWidth: 560 }}>
            <b>{t(ksLabel)}</b>
            <span style={{ color: ksColor }}>{ksText}</span>
          </div>
        </div>
        <div className="row">
          <div className="txt">
            <b>{t("autoSelect")}</b>
            <span>{t("autoSelectHint")}</span>
          </div>
          <div className="seg">
            {[0, 5, 15, 30, 60].map((m) => (
              <button key={m} data-on={p.autoSelect === m} onClick={() => p.setAutoSelect(m)}>
                {m === 0 ? t("autoSelectOff") : `${m}`}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <div className="txt">
            <b>{t("autoSelectLoss")}</b>
            <span>{t("autoSelectLossHint")}</span>
          </div>
          <button
            className="switch"
            aria-checked={p.autoSelectLoss}
            onClick={() => p.setAutoSelectLoss(!p.autoSelectLoss)}
          />
        </div>
        <div className="row">
          <div className="txt">
            <b>{t("dns")}</b>
            <span>{t("dnsHint")}</span>
          </div>
          <div className="seg">
            <button data-on={p.dnsMode === "tunnel"} onClick={() => p.setDnsMode("tunnel")}>
              {t("dnsTunnel")}
            </button>
            <button data-on={p.dnsMode === "system"} onClick={() => p.setDnsMode("system")}>
              {t("dnsSystem")}
            </button>
          </div>
        </div>
        {p.dnsMode === "tunnel" && (
          <div className="row row-top">
            <div className="txt">
              <b>{t("dnsServer")}</b>
              <span>{t("dnsServerHint")}</span>
            </div>
          </div>
        )}
        {p.dnsMode === "tunnel" && (
          <DnsPick lang={p.lang} value={p.dnsServer} onChange={p.setDnsServer} t={t} />
        )}
        <div className="row">
          <div className="txt">
            <b>{t("subRefresh")}</b>
            <span>{t("subRefreshHint")}</span>
          </div>
          <select
            className="input select"
            style={{ width: 148 }}
            value={p.subRefreshHours}
            onChange={(e) => p.setSubRefreshHours(Number(e.target.value))}
            aria-label={t("subRefresh")}
          >
            <option value={0}>{t("subRefreshOff")}</option>
            {[1, 3, 6, 9, 12, 24, 48].map((h) => (
              <option key={h} value={h}>
                {h} ч
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <div className="txt">
            <b>{t("minimizeToTray")}</b>
            <span>{t("minimizeToTrayHint")}</span>
          </div>
          <button
            className="switch"
            aria-checked={p.minimizeToTray}
            onClick={() => p.setMinimizeToTray(!p.minimizeToTray)}
          />
        </div>
        <div className="row">
          <div className="txt">
            <b>{t("ipv6")}</b>
            <span>{t("ipv6Hint")}</span>
          </div>
          <button className="switch" aria-checked={p.blockIpv6} onClick={() => p.setBlockIpv6(!p.blockIpv6)} />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row">
          <div className="txt">
            <b>{t("updates")}</b>
            <span>{t("updatesHint")}</span>
          </div>
          <button
            className="btn primary"
            style={{ width: "auto", paddingInline: 16 }}
            disabled={updateState === "busy"}
            onClick={async () => {
              // При активной блокировке и выключенном VPN сеть закрыта: это
              // by design, апдейтер не должен обходить защиту.
              if (p.ksState.state === "on" && !p.connected) {
                setUpdateState("blocked");
                setUpdateNote(t("ksBlockedNet"));
                return;
              }
              setUpdateState("busy");
              setUpdateNote("");
              try {
                const res = await api.updateCheck(p.updateUrl, version);
                if (res) {
                  setUpdateState("found");
                  setUpdateNote(`${t("updateFound")} ${res.version}${res.notes ? ` — ${res.notes}` : ""}`);
                  setUpdateLink(res.url);
                } else {
                  setUpdateState("latest");
                  setUpdateNote(t("updateLatest"));
                }
              } catch (e) {
                setUpdateState("error");
                setUpdateNote(String(e));
              }
            }}
          >
            {updateState === "busy" ? "…" : t("checkUpdates")}
          </button>
        </div>
        <div className="row" style={{ display: "block" }}>
          <div className="txt" style={{ maxWidth: 520 }}>
            <b>{t("updateUrl")}</b>
            <span>{t("updateUrlHint")}</span>
          </div>
          <input
            className="input"
            style={{ marginTop: 8, maxWidth: 520 }}
            value={p.updateUrl}
            spellCheck={false}
            placeholder="https://example.com/k4r/version.json"
            onChange={(e) => p.setUpdateUrl(e.target.value)}
            aria-label={t("updateUrl")}
          />
        </div>
        {updateNote && (
          <div className="muted" style={{ marginTop: 10 }}>
            {updateNote}{" "}
            {updateState === "found" && updateLink ? (
              <>
                <button
                  className="ghost-btn"
                  onClick={async () => {
                    try {
                      setUpdateNote(`${t("downloading")}…`);
                      const path = await api.updateDownload(updateLink);
                      setUpdateNote(`${t("downloadDone")} ${path}`);
                    } catch (e) {
                      setUpdateNote(String(e));
                    }
                  }}
                >
                  {t("downloadInstall")}
                </button>
                <button className="ghost-btn" onClick={() => api.openUrl(updateLink).catch(() => undefined)}>
                  {t("openPage")}
                </button>
              </>
            ) : null}
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row">
          <div className="txt">
            <b>{t("backupTitle")}</b>
            <span>{t("backupHint")}</span>
          </div>
          <button
            className="btn primary"
            style={{ width: "auto", paddingInline: 16 }}
            onClick={async () => {
              try {
                setBackup(await api.stateExport());
              } catch (e) {
                setBackup(String(e));
              }
            }}
          >
            {t("backupSave")}
          </button>
        </div>
        {backup && <div className="muted" style={{ marginTop: 6 }}>{t("savedTo")} {backup}</div>}
        <div className="row" style={{ display: "block", marginTop: 12 }}>
          <div className="txt" style={{ maxWidth: 520 }}>
            <b>{t("restoreTitle")}</b>
            <span>{t("restoreHint")}</span>
          </div>
          <textarea
            className="input area"
            rows={3}
            value={restore}
            spellCheck={false}
            placeholder='{"profiles": …}'
            onChange={(e) => setRestore(e.target.value)}
            aria-label={t("restoreTitle")}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
            <button
              className="btn"
              style={{ width: "auto", paddingInline: 14 }}
              disabled={!restore.trim()}
              onClick={async () => {
                try {
                  await api.stateImport(restore);
                  setRestoreNote(t("restoreDone"));
                  setRestore("");
                } catch (e) {
                  setRestoreNote(String(e));
                }
              }}
            >
              {t("restoreApply")}
            </button>
            {restoreNote && <span className="muted">{restoreNote}</span>}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row">
          <div className="txt">
            <b>{t("statsTitle")}</b>
            <span>{t("statsHint")}</span>
          </div>
        </div>
        {stats.length === 0 ? (
          <div className="muted" style={{ marginTop: 8 }}>{t("statsEmpty")}</div>
        ) : (
          <div className="day-bars">
            {(() => {
              const top = Math.max(...stats.map((d) => d.down + d.up), 1);
              return stats.slice(0, 7).map((d) => {
                const total = d.down + d.up;
                const width = Math.max(3, Math.round((total / top) * 100));
                return (
                  <div className="day-row" key={d.day}>
                    <span className="day-k">{d.day.slice(5)}</span>
                    <span className="day-bar">
                      <i style={{ width: `${width}%` }} />
                    </span>
                    <span className="day-v">{(total / 1024 / 1024 / 1024).toFixed(2)} ГБ</span>
                  </div>
                );
              });
            })()}
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row">
          <div className="txt">
            <b>{t("leakTitle")}</b>
            <span>{t("leakHint")}</span>
          </div>
          <button
            className="btn"
            style={{ width: "auto", paddingInline: 14 }}
            disabled={leakBusy}
            onClick={async () => {
              setLeakBusy(true);
              setLeakError("");
              try {
                setLeak(await api.dnsLeak());
              } catch (e) {
                setLeak(null);
                setLeakError(String(e));
              } finally {
                setLeakBusy(false);
              }
            }}
          >
            {leakBusy ? "…" : t("leakCheck")}
          </button>
        </div>
        {leak && (
          <div className="leak-out">
            <div>
              <span className="muted">{t("leakResolver")}</span> <b className="mono">{leak.resolver || "—"}</b>
            </div>
            <div>
              <span className="muted">{t("leakEgress")}</span> <b className="mono">{leak.egress || "—"}</b>
            </div>
            <div className="muted" style={{ marginTop: 6 }}>{t("leakHow")}</div>
          </div>
        )}
        {leakError && <div className="muted warn-txt">{leakError}</div>}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row">
          <div className="txt">
            <b>{t("coreTitle")}</b>
            <span>
              {core.version ? t("coreCurrent").replace("{v}", core.version) : t("coreUnknown")}
              {core.updated ? ` · ${t("coreCustom")}` : ` · ${t("coreBundled")}`}
            </span>
          </div>
          <button
            className="btn"
            style={{ width: "auto", paddingInline: 14 }}
            disabled={coreBusy}
            onClick={async () => {
              setCoreBusy(true);
              setCoreNote("");
              try {
                const latest = await api.coreLatest();
                if (core.version && latest === core.version && !core.updated) {
                  setCoreNote(t("coreIsLatest").replace("{v}", latest));
                } else {
                  const got = await api.coreUpdate(latest);
                  setCore({ version: got, updated: true });
                  setCoreNote(t("coreUpdated").replace("{v}", got));
                }
              } catch (e) {
                setCoreNote(String(e));
              } finally {
                setCoreBusy(false);
              }
            }}
          >
            {coreBusy ? "…" : t("coreCheck")}
          </button>
        </div>
        {core.updated && (
          <div className="row" style={{ marginTop: 6 }}>
            <button
              className="ghost-btn"
              disabled={coreBusy}
              onClick={async () => {
                setCoreBusy(true);
                setCoreNote("");
                try {
                  const back = await api.coreReset();
                  setCore({ version: back, updated: false });
                  setCoreNote(t("coreResetDone").replace("{v}", back));
                } catch (e) {
                  setCoreNote(String(e));
                } finally {
                  setCoreBusy(false);
                }
              }}
            >
              {t("coreReset")}
            </button>
          </div>
        )}
        {coreNote && <div className="muted" style={{ marginTop: 6 }}>{coreNote}</div>}
      </div>

      <div className="card">
        <dl className="kv">
          <dt>{t("about")}</dt>
          <dd>K4R Neko VPN</dd>
          <dt>{t("version")}</dt>
          <dd>{version}</dd>
          <dt>{t("core")}</dt>
          <dd>{core.version ? `sing-box ${core.version}` : "sing-box"}</dd>
          <dt>{t("deviceId")}</dt>
          <dd>
            <div className="id-row">
              <input
                className="input"
                value={deviceDraft}
                spellCheck={false}
                onChange={(e) => setDeviceDraft(e.target.value)}
                onBlur={() => {
                  const clean = deviceDraft.trim().toUpperCase();
                  if (clean && clean !== deviceId) {
                    setDeviceId(clean);
                    p.onDeviceId(clean);
                  }
                }}
                aria-label={t("deviceId")}
              />
              <button
                className="ghost-btn"
                onClick={() => navigator.clipboard?.writeText(deviceDraft || deviceId).catch(() => undefined)}
              >
                {t("copy")}
              </button>
            </div>
            <div className="muted" style={{ marginTop: 6 }}>{t("deviceIdHint")}</div>
          </dd>
          <dt>{t("support")}</dt>
          <dd>
            <button
              className="ghost-btn"
              onClick={async () => setExported(await p.onExportLog())}
            >
              {t("exportLog")}
            </button>
            {exported ? <div className="muted" style={{ marginTop: 6 }}>{t("savedTo")} {exported}</div> : null}
          </dd>
        </dl>
      </div>
    </>
  );
}
