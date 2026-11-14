import { useEffect, useState } from "react";
import type { Lang } from "../i18n";
import type { Theme } from "../App";
import { api, inTauri } from "../api";

type Props = {
  t: (k: string) => string;
  lang: Lang;
  setLang: (l: Lang) => void;
  killSwitch: boolean;
  setKillSwitch: (v: boolean) => void;
  autostart: boolean;
  setAutostart: (v: boolean) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  dnsMode: "tunnel" | "system";
  setDnsMode: (v: "tunnel" | "system") => void;
  blockIpv6: boolean;
  setBlockIpv6: (v: boolean) => void;
  closeToTray: boolean;
  setCloseToTray: (v: boolean) => void;
  notifyOn: boolean;
  setNotifyOn: (v: boolean) => void;
  hotkey: string;
  setHotkey: (v: string) => void;
  onExportLog: () => Promise<string>;
};

export function SettingsScreen(p: Props) {
  const { t, lang, setLang, killSwitch, setKillSwitch, autostart, setAutostart, theme, setTheme } = p;
  const [deviceId, setDeviceId] = useState("");
  const [hotkeyDraft, setHotkeyDraft] = useState(p.hotkey);
  const [exported, setExported] = useState("");

  useEffect(() => {
    if (!inTauri) return;
    api.installId().then(setDeviceId).catch(() => undefined);
  }, []);

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
            <span>{t("killSwitchSoon")}</span>
          </div>
          <button className="switch" aria-checked={killSwitch} onClick={() => setKillSwitch(!killSwitch)} />
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
        <div className="row">
          <div className="txt">
            <b>{t("ipv6")}</b>
            <span>{t("ipv6Hint")}</span>
          </div>
          <button className="switch" aria-checked={p.blockIpv6} onClick={() => p.setBlockIpv6(!p.blockIpv6)} />
        </div>
      </div>

      <div className="card">
        <dl className="kv">
          <dt>{t("about")}</dt>
          <dd>K4R Neko VPN</dd>
          <dt>{t("version")}</dt>
          <dd>0.1.0</dd>
          <dt>{t("core")}</dt>
          <dd>{t("coreValue")}</dd>
          <dt>{t("deviceId")}</dt>
          <dd>
            {deviceId || "—"}{" "}
            {deviceId ? (
              <button
                className="ghost-btn"
                onClick={() => navigator.clipboard?.writeText(deviceId).catch(() => undefined)}
              >
                {t("copy")}
              </button>
            ) : null}
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
