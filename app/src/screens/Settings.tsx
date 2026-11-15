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
  const [deviceId, setDeviceId] = useState("");
  const [version, setVersion] = useState("0.3.0");
  const [updateState, setUpdateState] = useState<"idle" | "busy" | "latest" | "found" | "error">("idle");
  const [updateNote, setUpdateNote] = useState("");
  const [updateLink, setUpdateLink] = useState("");
  const [deviceDraft, setDeviceDraft] = useState("");
  const [hotkeyDraft, setHotkeyDraft] = useState(p.hotkey);
  const [exported, setExported] = useState("");

  useEffect(() => {
    if (!inTauri) return;
    api.appVersion().then(setVersion).catch(() => undefined);
    api
      .installId()
      .then((id) => {
        setDeviceId(id);
        setDeviceDraft(id);
      })
      .catch(() => undefined);
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
            <span>{t("killSwitchHint")}</span>
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
        {p.dnsMode === "tunnel" && (
          <div className="row">
            <div className="txt">
              <b>{t("dnsServer")}</b>
              <span>{t("dnsServerHint")}</span>
            </div>
          </div>
        )}
        {p.dnsMode === "tunnel" && (
          <div className="dns-row">
            <input
              className="input"
              value={p.dnsServer}
              spellCheck={false}
              placeholder="1.1.1.1"
              onChange={(e) => p.setDnsServer(e.target.value)}
              aria-label={t("dnsServer")}
            />
            <div className="dns-chips">
              {[
                ["Cloudflare", "1.1.1.1"],
                ["Google", "8.8.8.8"],
                ["Quad9", "https://dns.quad9.net/dns-query"],
                ["DoH Google", "https://dns.google/dns-query"],
              ].map(([label, value]) => (
                <button
                  key={value}
                  className="chip"
                  data-on={p.dnsServer === value}
                  onClick={() => p.setDnsServer(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
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
              <button className="ghost-btn" onClick={() => api.openUrl(updateLink).catch(() => undefined)}>
                {t("download")}
              </button>
            ) : null}
          </div>
        )}
      </div>

      <div className="card">
        <dl className="kv">
          <dt>{t("about")}</dt>
          <dd>K4R Neko VPN</dd>
          <dt>{t("version")}</dt>
          <dd>{version}</dd>
          <dt>{t("core")}</dt>
          <dd>{t("coreValue")}</dd>
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
