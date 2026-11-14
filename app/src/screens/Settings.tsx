import { useState } from "react";
import type { Lang } from "../i18n";
import { api, inTauri } from "../api";

type Props = {
  t: (k: string) => string;
  lang: Lang;
  setLang: (l: Lang) => void;
  killSwitch: boolean;
  setKillSwitch: (v: boolean) => void;
  autostart: boolean;
  setAutostart: (v: boolean) => void;
};

export function SettingsScreen(p: Props) {
  const { t, lang, setLang, killSwitch, setKillSwitch, autostart, setAutostart } = p;
  const [tray, setTray] = useState(true);
  const [dns, setDns] = useState(true);
  const [ipv6, setIpv6] = useState(false);

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
          </div>
          <div className="seg">
            <button data-on>{t("themeDark")}</button>
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
          </div>
          <button className="switch" aria-checked={tray} onClick={() => setTray(!tray)} />
        </div>
        <div className="row">
          <div className="txt">
            <b>{t("killSwitch")}</b>
          </div>
          <button className="switch" aria-checked={killSwitch} onClick={() => setKillSwitch(!killSwitch)} />
        </div>
        <div className="row">
          <div className="txt">
            <b>{t("dns")}</b>
          </div>
          <button className="switch" aria-checked={dns} onClick={() => setDns(!dns)} />
        </div>
        <div className="row">
          <div className="txt">
            <b>{t("ipv6")}</b>
          </div>
          <button className="switch" aria-checked={ipv6} onClick={() => setIpv6(!ipv6)} />
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
        </dl>
      </div>
    </>
  );
}
