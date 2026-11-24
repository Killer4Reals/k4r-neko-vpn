import { useEffect, useState } from "react";
import type { Lang } from "../i18n";
import { play, setSoundOn, setVolume, soundOn, volume } from "../sound";
import { globeStyle, setGlobeStyle, type GlobeStyle } from "../globeStyle";
import { api, inTauri, type KillSwitchStatus, type KsCheck } from "../api";
import { DnsPick } from "../DnsPick";
import { reportText, summarize, type Check } from "../selfcheck";

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
  autoHistory: string[];
  gameMode: boolean;
  setGameMode: (v: boolean) => void;
  gamePorts: string;
  setGamePorts: (v: string) => void;
  orch: import("../api").OrchRow[];
  /** id профиля → человеческое имя, чтобы в статистике не было «srv-7f3a» */
  serverNames: Record<string, string>;
  onOrchReset: () => void;
  autoSelectLoss: boolean;
  autoSwitchSlow: boolean;
  setAutoSwitchSlow: (v: boolean) => void;
  setAutoSelectLoss: (v: boolean) => void;
  autostart: boolean;
  setAutostart: (v: boolean) => void;
  connectOnStart: boolean;
  setConnectOnStart: (v: boolean) => void;
  dnsMode: "tunnel" | "system";
  /** данные для «проверки одной кнопкой»: считает их App */
  selfCheck: () => Check[];
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
  /** отчёт «проверки одной кнопкой» в файл: его удобно приложить к вопросу */
  onSaveReport: (report: string) => void;
  onDeviceId: (id: string) => void;
};

export function SettingsScreen(p: Props) {
  const [checks, setChecks] = useState<Check[]>([]);
  const [accent, setAccent] = useState<string>(
    () => (typeof localStorage !== "undefined" && localStorage.getItem("k4r.accent")) || "neon",
  );
  const [copied, setCopied] = useState("");
  const { t, lang, setLang, killSwitch, setKillSwitch, autostart, setAutostart } = p;
  const { onSaveReport } = p;
  const { connectOnStart, setConnectOnStart } = p;
  // Самодиагностика kill-switch: 7 проверок, результат — табличкой.
  const [ksChecks, setKsChecks] = useState<KsCheck[] | null>(null);
  const [ksBusy, setKsBusy] = useState(false);
  const [ksNote, setKsNote] = useState("");
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
  // Результат проверки утечек: IPv6, адрес выхода, отвечающий резолвер.
  const [leak, setLeak] = useState<import("../api").LeakReport | null>(null);
  const [leakBusy, setLeakBusy] = useState(false);
  const [leakError, setLeakError] = useState("");
  const [sound, setSound] = useState(() => soundOn());
  const [globe, setGlobe] = useState<GlobeStyle>(() => globeStyle());
  const [hwid, setHwid] = useState("");
  const [hwidBusy, setHwidBusy] = useState(false);
  const [hwidCopied, setHwidCopied] = useState(false);
  useEffect(() => {
    if (!inTauri) return;
    api.installId().then(setHwid).catch(() => {});
  }, []);
  const [vol, setVol] = useState(() => Math.round(volume() * 100));
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

      {/* Акцент: тема одна, но цвет действия человек выбирает сам */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row">
          <div className="txt">
            <b>{t("accentTitle")}</b>
            <span>{t("accentHint")}</span>
          </div>
        </div>
        <div className="accent-row">
          {[
            { id: "neon", color: "#39ff14", hint: "Неон" },
            { id: "violet", color: "#b46bff", hint: "Фиолет" },
            { id: "rose", color: "#ff4fd8", hint: "Розовый" },
            { id: "ice", color: "#4dd9ff", hint: "Лёд" },
          ].map((a) => (
            <button
              key={a.id}
              className="accent-dot"
              data-on={(accent || "neon") === a.id}
              style={{ background: a.color }}
              title={a.hint}
              aria-label={a.hint}
              onClick={() => {
                setAccent(a.id);
                localStorage.setItem("k4r.accent", a.id);
                document.documentElement.dataset.accent = a.id;
              }}
            />
          ))}
        </div>
      </div>

      {/* Проверка одной кнопкой: семь пунктов, каждый — то, что реально можно
          проверить по состоянию. Отчёт копируется, чтобы не описывать словами */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row">
          <div className="txt">
            <b>{t("chkTitle")}</b>
            <span>{t("chkHint")}</span>
          </div>
          <button
            className="btn primary"
            style={{ width: "auto", paddingInline: 16 }}
            onClick={() => {
              const list = p.selfCheck();
              setChecks(list);
              setCopied("");
            }}
          >
            {t("chkRun")}
          </button>
        </div>
        {checks.length > 0 && (
          <div className="chk-list">
            {checks.map((c) => (
              <div key={c.id} className={`chk-row ${c.level}`}>
                <span className="chk-mark" aria-hidden>
                  {c.level === "ok" ? "✓" : c.level === "bad" ? "✕" : c.level === "warn" ? "!" : "?"}
                </span>
                <span className="chk-title">
                  {t(c.titleKey)}
                  {c.detail ? <em> · {c.detail}</em> : null}
                </span>
                {c.level !== "ok" && c.fixKey && <span className="chk-fix">{t(c.fixKey)}</span>}
              </div>
            ))}
            <div className={`chk-verdict ${summarize(checks).verdict}`}>
              {t(
                summarize(checks).bad > 0
                  ? "chkVerdictBad"
                  : summarize(checks).warn > 0
                    ? "chkVerdictWarn"
                    : "chkVerdictOk",
              )}
              <button
                className="ghost-btn"
                style={{ marginLeft: 10 }}
                onClick={() => {
                  const txt = reportText(checks, t, t("chkTitle"));
                  void navigator.clipboard?.writeText(txt).then(() => setCopied("1"));
                }}
              >
                {copied ? t("chkCopied") : t("chkCopy")}
              </button>
              <button
                className="ghost-btn"
                style={{ marginLeft: 8 }}
                onClick={() => onSaveReport(reportText(checks, t, t("chkTitle")))}
              >
                {t("chkSave")}
              </button>
            </div>
          </div>
        )}
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
        <div className="row" style={{ display: "block" }}>
          <div className="txt" style={{ maxWidth: 560 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button
                className="btn"
                style={{ width: "auto", paddingInline: 14 }}
                disabled={ksBusy}
                onClick={async () => {
                  setKsBusy(true);
                  setKsNote("");
                  try {
                    const res = await api.killSwitchSelfcheck();
                    setKsChecks(res);
                    const green = res.filter((c) => c.ok === true).length;
                    setKsNote(`${t("ksCheckSummary")} ${green} / ${res.length}`);
                  } catch (e) {
                    setKsNote(String(e));
                  } finally {
                    setKsBusy(false);
                  }
                }}
              >
                {ksBusy ? t("ksChecking") : t("ksCheck")}
              </button>
              {ksChecks && (
                <button
                  className="btn"
                  style={{ width: "auto", paddingInline: 14 }}
                  onClick={async () => {
                    // Отчёт — простым текстом: его можно вставить в переписку.
                    const lines = ksChecks.map(
                      (c) =>
                        `${c.ok === true ? "OK  " : c.ok === false ? "FAIL" : "SKIP"} ${c.id}. ${c.title}: ${c.detail}`,
                    );
                    const text = [
                      `K4R Neko VPN ${version} — kill-switch self-check`,
                      ksNote,
                      "",
                      ...lines,
                    ].join(String.fromCharCode(10));
                    try {
                      await navigator.clipboard.writeText(text);
                      setKsNote(t("ksCheckCopied"));
                    } catch {
                      setKsNote(text);
                    }
                  }}
                >
                  {t("ksCheckCopy")}
                </button>
              )}
            </div>
            {ksNote && <span style={{ color: "var(--txt-3)" }}>{ksNote}</span>}
            {ksChecks && (
              <div style={{ marginTop: 6 }}>
                {ksChecks.map((c) => (
                  <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <span
                      style={{
                        color:
                          c.ok === true
                            ? "var(--green)"
                            : c.ok === false
                              ? "var(--red, #ff5a5a)"
                              : "var(--txt-3)",
                        minWidth: 52,
                      }}
                    >
                      {c.ok === true ? "OK" : c.ok === false ? "FAIL" : "SKIP"}
                    </span>
                    <span>
                      <b>{c.title}</b>
                      <span style={{ color: "var(--txt-3)" }}> — {c.detail}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
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
        {p.autoHistory.length > 0 && (
          <div className="row" style={{ display: "block" }}>
            <div className="txt" style={{ maxWidth: 560 }}>
              <b>{t("autoSelectHistory")}</b>
              {p.autoHistory.slice(-5).reverse().map((line, i) => (
                <span key={i} style={{ color: "var(--txt-3)", fontSize: 12 }}>
                  {line}
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="row">
          <div className="txt">
            <b>{t("hwidTitle")}</b>
            <span>{t("hwidHint")}</span>
            <code
              style={{
                fontSize: 12,
                color: "var(--txt-3)",
                fontFamily: "var(--mono, monospace)",
                cursor: hwid ? "pointer" : "default",
              }}
              title={t("hwidCopy")}
              onClick={() => {
                if (!hwid) return;
                // Диктуют в кабинет провайдера: копируем, а не заставляем выделять.
                void navigator.clipboard?.writeText(hwid).catch(() => {});
                setHwidCopied(true);
                window.setTimeout(() => setHwidCopied(false), 1600);
                play("click");
              }}
            >
              {hwidCopied ? t("hwidCopied") : hwid || "—"}
            </code>
          </div>
          <button
            className="btn"
            style={{ width: "auto", paddingInline: 14 }}
            disabled={!hwid || hwidBusy}
            onClick={async () => {
              if (!inTauri) return;
              setHwidBusy(true);
              try {
                const next = await api.installIdReset();
                setHwid(next);
                play("click");
              } finally {
                setHwidBusy(false);
              }
            }}
          >
            {t("hwidReset")}
          </button>
        </div>
        <div className="row">
          <div className="txt">
            <b>{t("globeStyleTitle")}</b>
            <span>{t("globeStyleHint")}</span>
          </div>
          <div className="seg" style={{ display: "flex", gap: 8 }}>
            {(["neon", "planet"] as GlobeStyle[]).map((g) => (
              <button
                key={g}
                className={`btn${globe === g ? " primary" : ""}`}
                style={{ width: "auto", paddingInline: 14 }}
                onClick={() => {
                  setGlobe(g);
                  setGlobeStyle(g);
                  play("click");
                }}
              >
                {t(g === "neon" ? "globeNeon" : "globePlanet")}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <div className="txt">
            <b>{t("soundTitle")}</b>
            <span>{t("soundHint")}</span>
          </div>
          <button
            className="switch"
            aria-checked={sound}
            onClick={() => {
              const next = !sound;
              setSound(next);
              setSoundOn(next);
              if (next) play("click");
            }}
          />
        </div>
        {sound && (
          <div className="row" style={{ display: "block" }}>
            <div className="txt" style={{ maxWidth: 420 }}>
              <b>{t("soundVolume")}</b>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={vol}
              style={{ marginTop: 8, maxWidth: 320 }}
              onChange={(e) => {
                const value = Number(e.target.value);
                setVol(value);
                setVolume(value / 100);
              }}
              onMouseUp={() => play("click")}
              aria-label={t("soundVolume")}
            />
          </div>
        )}
        <div className="row">
          <div className="txt">
            <b>{t("gameTitle")}</b>
            <span>{t("gameHint")}</span>
          </div>
          <button
            className="switch"
            aria-checked={p.gameMode}
            onClick={() => p.setGameMode(!p.gameMode)}
          />
        </div>
        {p.gameMode && (
          <div className="row" style={{ display: "block" }}>
            <div className="txt" style={{ maxWidth: 520 }}>
              <b>{t("gamePorts")}</b>
            </div>
            <input
              className="input"
              style={{ marginTop: 8, maxWidth: 520 }}
              value={p.gamePorts}
              spellCheck={false}
              placeholder="27015-27050, 3478-3481, 50000-50100"
              onChange={(e) => p.setGamePorts(e.target.value)}
              aria-label={t("gamePorts")}
            />
          </div>
        )}
        <div className="row" style={{ display: "block" }}>
          <div className="txt" style={{ maxWidth: 560 }}>
            <b>{t("orchTitle")}</b>
            <span>{t("orchHint")}</span>
            {p.orch.length === 0 ? (
              <span style={{ color: "var(--txt-3)", fontSize: 12 }}>{t("orchEmpty")}</span>
            ) : (
              p.orch.slice(0, 6).map((row) => {
                const rawId = row.key.split("|")[0];
                const name = p.serverNames[rawId] || rawId;
                const transport = row.key.split("|").slice(1).filter(Boolean).join("/") || "tcp";
                const good = Math.round(row.score * 100);
                return (
                  <span key={row.key} style={{ color: "var(--txt-3)", fontSize: 12 }}>
                    {name} · {transport} — {good}% ({row.ok}/{row.ok + row.fail}), {row.latency_ms} мс
                    {row.quarantined ? ` · ${t("orchQuarantine")}` : ""}
                  </span>
                );
              })
            )}
            <button className="ghost-btn" style={{ marginTop: 8 }} onClick={p.onOrchReset}>
              {t("orchReset")}
            </button>
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
            <b>{t("autoSwitchSlow")}</b>
            <span>{t("autoSwitchSlowHint")}</span>
          </div>
          <button
            className="switch"
            aria-checked={p.autoSwitchSlow}
            onClick={() => p.setAutoSwitchSlow(!p.autoSwitchSlow)}
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
        <div className="row" style={{ display: "block" }}>
          <div className="txt" style={{ maxWidth: 560 }}>
            <b>{t("leakTitle")}</b>
            <span>{t("leakHint")}</span>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button
                className="btn"
                style={{ width: "auto", paddingInline: 14 }}
                disabled={leakBusy}
                onClick={async () => {
                  setLeakBusy(true);
                  try {
                    setLeak(await api.leakCheck());
                  } catch (e) {
                    setLeak({
                      ipv6_blocked: false,
                      ipv6_detail: String(e),
                      exit_ip: "",
                      exit_colo: "",
                      exit_detail: "",
                      dns_resolver: "",
                      dns_detail: "",
                    });
                  } finally {
                    setLeakBusy(false);
                  }
                }}
              >
                {leakBusy ? t("leakBusy") : t("leakRun")}
              </button>
            </div>
            {leak && (
              <div style={{ marginTop: 10, display: "grid", gap: 6, fontSize: 12 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{ color: leak.ipv6_blocked ? "var(--green)" : "var(--red, #ff5a5a)", minWidth: 52 }}>
                    {leak.ipv6_blocked ? "OK" : "!"}
                  </span>
                  <span>
                    {leak.ipv6_blocked ? t("leakV6Ok") : t("leakV6Bad")} — {leak.ipv6_detail}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{ color: "var(--txt-3)", minWidth: 52 }}>IP</span>
                  <span>
                    {t("leakExit")}: <b>{leak.exit_ip || "—"}</b>
                    {leak.exit_colo ? ` (${leak.exit_colo})` : ""} — {leak.exit_detail}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{ color: "var(--txt-3)", minWidth: 52 }}>DNS</span>
                  <span>
                    {t("leakDns")}: <b>{leak.dns_resolver || "—"}</b> — {leak.dns_detail}
                    {leak.dns_resolver ? ` · ${t("leakDnsWarn")}` : ""}
                  </span>
                </div>
              </div>
            )}
          </div>
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
                setLeak(await api.leakCheck());
              } catch (e) {
                setLeak(null);
                setLeakError(String(e));
              } finally {
                setLeakBusy(false);
              }
            }}
          >
            {leakBusy ? t("leakBusy") : t("leakRun")}
          </button>
        </div>
        {leak && (
          <div className="leak-out">
            <div>
              <span className="muted">IPv6</span>{" "}
              <b style={{ color: leak.ipv6_blocked ? "var(--green)" : "var(--red, #ff5a5a)" }}>
                {leak.ipv6_blocked ? t("leakV6Ok") : t("leakV6Bad")}
              </b>{" "}
              <span className="muted">— {leak.ipv6_detail}</span>
            </div>
            <div>
              <span className="muted">{t("leakExit")}:</span>{" "}
              <b className="mono">{leak.exit_ip || "—"}</b>
              {leak.exit_colo ? <span className="muted"> ({leak.exit_colo})</span> : null}
            </div>
            <div>
              <span className="muted">{t("leakDns")}:</span>{" "}
              <b className="mono">{leak.dns_resolver || "—"}</b>
              <span className="muted"> — {t("leakDnsWarn")}</span>
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
