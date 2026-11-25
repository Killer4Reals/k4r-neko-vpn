import { useState } from "react";
import { api } from "../api";
import type { RouteRule, ZapretScan } from "../api";
import { mergeRules } from "../rulesMerge";
import { MetroMap } from "../MetroMap";
import { exitLabel, metroCounts } from "../metroMath";

type Props = {
  t: (k: string) => string;
  head?: boolean;
  rules: RouteRule[];
  setRules: (r: RouteRule[]) => void;
  ruDirect: boolean;
  setRuDirect: (v: boolean) => void;
  blockAds: boolean;
  setBlockAds: (v: boolean) => void;
  connected: boolean;
  onReconnect: () => void;
  /** Куда ведёт туннель: город выбранного узла. */
  city?: string;
  country?: string;
  /** Защита туннеля включена — на схеме это отдельная ветка. */
  guard?: boolean;
};

const KINDS: RouteRule["kind"][] = ["suffix", "domain", "keyword", "ip"];
const ACTIONS: RouteRule["action"][] = ["proxy", "direct", "block"];

const kindLabel: Record<RouteRule["kind"], string> = {
  suffix: "kindSuffix",
  domain: "kindDomain",
  keyword: "kindKeyword",
  ip: "kindIp",
};

const actionLabel: Record<RouteRule["action"], string> = {
  proxy: "actProxy",
  direct: "actDirect",
  block: "actBlock",
};

/**
 * Маршрутизация: что идёт в туннель, что напрямую, что в блок.
 *
 * Свои правила важнее разделения по программам — так человеку понятнее:
 * если он сказал «этот домен напрямую», приложение не спорит.
 */
export function RouteScreen({
  t,
  head = true,
  rules,
  setRules,
  ruDirect,
  setRuDirect,
  blockAds,
  setBlockAds,
  connected,
  onReconnect,
  city = "",
  country = "",
  guard = false,
}: Props) {
  const counts = metroCounts(rules);
  const [kind, setKind] = useState<RouteRule["kind"]>("suffix");
  const [action, setAction] = useState<RouteRule["action"]>("direct");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  // Импорт списков zapret: только чтение чужой папки.
  const [zpDir, setZpDir] = useState(() => localStorage.getItem("k4r-zapret-dir") || "");
  const [zpScan, setZpScan] = useState<ZapretScan | null>(null);
  const [zpIps, setZpIps] = useState(false);
  const [zpBusy, setZpBusy] = useState(false);
  const [zpNote, setZpNote] = useState("");

  const add = () => {
    const v = value.trim();
    if (!v) {
      setError(t("routeNeedValue"));
      return;
    }
    // «https://ozon.ru/» и «ozon.ru» — один домен, а не два разных правила
    const clean = v.replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
    if (kind === "ip" && !/^[0-9a-f:.]+(\/\d{1,3})?$/.test(clean)) {
      setError(t("routeBadIp"));
      return;
    }
    if (rules.some((r) => r.kind === kind && r.value.toLowerCase() === clean)) {
      setError(t("routeDup"));
      return;
    }
    setError("");
    setRules([...rules, { kind, value: clean, action, enabled: true }]);
    setValue("");
  };

  const patch = (i: number, next: Partial<RouteRule>) =>
    setRules(rules.map((r, idx) => (idx === i ? { ...r, ...next } : r)));

  const remove = (i: number) => setRules(rules.filter((_, idx) => idx !== i));

  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= rules.length) return;
    const next = [...rules];
    [next[i], next[j]] = [next[j], next[i]];
    setRules(next);
  };

  return (
    <>
      {head && (
        <div className="page-head">
          <h1>{t("routeTitle")}</h1>
          <p>{t("routeSub")}</p>
        </div>
      )}

      <MetroMap
        t={t}
        counts={counts}
        exit={exitLabel(city, country)}
        connected={connected}
        guard={guard}
      />

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row" style={{ display: "block" }}>
          <div className="txt" style={{ maxWidth: 560 }}>
            <b>{t("zpImportTitle")}</b>
            <span>{t("zpImportHint")}</span>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <input
              className="input"
              style={{ flex: 1, minWidth: 280 }}
              value={zpDir}
              spellCheck={false}
              placeholder="C:\Users\you\Desktop\zapret-discord-youtube-main"
              onChange={(e) => setZpDir(e.target.value)}
              aria-label={t("zpImportTitle")}
            />
            <button
              className="btn"
              style={{ width: "auto", paddingInline: 14 }}
              disabled={zpBusy}
              onClick={async () => {
                const dir = zpDir.trim();
                if (!dir) {
                  setZpNote(t("zpImportNeedDir"));
                  return;
                }
                localStorage.setItem("k4r-zapret-dir", dir);
                setZpBusy(true);
                try {
                  const res = await api.zapretScan(dir);
                  setZpScan(res);
                  setZpNote(
                    res.exists
                      ? `домены: ${res.domains + res.google}, исключения: ${res.excluded}, адреса: ${res.ips}`
                      : t("zpImportMissing"),
                  );
                } catch (e) {
                  setZpNote(String(e));
                } finally {
                  setZpBusy(false);
                }
              }}
            >
              {t("zpImportScan")}
            </button>
            <button
              className="btn primary"
              style={{ width: "auto", paddingInline: 14 }}
              disabled={zpBusy || !zpScan?.exists}
              onClick={async () => {
                setZpBusy(true);
                try {
                  const res = await api.zapretImport(zpDir.trim(), zpIps);
                  const merged = mergeRules(rules, res.rules);
                  setRules(merged.rules);
                  setZpNote(`${t("zpImportDone")}: ${merged.added}`);
                } catch (e) {
                  setZpNote(String(e));
                } finally {
                  setZpBusy(false);
                }
              }}
            >
              {t("zpImportDo")}
            </button>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, fontSize: 12 }}>
            <input type="checkbox" checked={zpIps} onChange={(e) => setZpIps(e.target.checked)} />
            {t("zpImportIps")}
          </label>
          {zpNote && (
            <div className="muted" style={{ marginTop: 8 }}>
              {zpNote}
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row">
          <div className="txt">
            <b>{t("routeRu")}</b>
            <span>{t("routeRuHint")}</span>
          </div>
          <button
            role="switch" className="switch"
            aria-checked={ruDirect}
            aria-label={t("routeRu")}
            onClick={() => setRuDirect(!ruDirect)}
          >
            <span />
          </button>
        </div>
        <div className="row">
          <div className="txt">
            <b>{t("routeAds")}</b>
            <span>{t("routeAdsHint")}</span>
          </div>
          <button
            role="switch" className="switch"
            aria-checked={blockAds}
            aria-label={t("routeAds")}
            onClick={() => setBlockAds(!blockAds)}
          >
            <span />
          </button>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ borderBottom: 0, paddingBottom: 0 }}>
          <div className="txt">
            <b>{t("routeCustom")}</b>
            <span>{t("routeCustomHint")}</span>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "180px 1fr 170px auto", gap: 10 }}>
          <div className="field">
            <label>{t("routeKind")}</label>
            <select value={kind} onChange={(e) => setKind(e.target.value as RouteRule["kind"])}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(kindLabel[k])}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>{t("routeValue")}</label>
            <input
              value={value}
              placeholder={kind === "ip" ? "5.255.255.0/24" : "ozon.ru"}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
              }}
            />
          </div>
          <div className="field">
            <label>{t("routeAction")}</label>
            <select value={action} onChange={(e) => setAction(e.target.value as RouteRule["action"])}>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {t(actionLabel[a])}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <button className="btn" style={{ width: "auto", paddingInline: 16 }} onClick={add}>
              {t("routeAdd")}
            </button>
          </div>
        </div>
        {error && <p className="warn-txt">{error}</p>}

        {rules.length === 0 ? (
          <div className="empty-box" style={{ marginTop: 14 }}>
            <img src="/mascot/empty.webp" alt="" draggable={false} />
            <div>
              <h3>{t("routeEmptyTitle")}</h3>
              <p className="muted">{t("routeEmpty")}</p>
            </div>
          </div>
        ) : (
          <div className="rule-list">
            {rules.map((r, i) => (
              <div
                key={`${r.kind}:${r.value}`}
                className="rule-row"
                style={{ animationDelay: `${Math.min(i, 14) * 26}ms` }}
              >
                <button
                  role="switch" className="switch"
                  aria-checked={r.enabled}
                  aria-label={t("routeEnable")}
                  onClick={() => patch(i, { enabled: !r.enabled })}
                >
                  <span />
                </button>
                <span
                  className="rule-light"
                  data-act={r.action}
                  data-on={r.enabled}
                  title={t(actionLabel[r.action])}
                />
                <span className="rule-kind">{t(kindLabel[r.kind])}</span>
                <span className="rule-value" title={r.value}>{r.value}</span>
                <select
                  className="rule-act"
                  value={r.action}
                  aria-label={t("routeAction")}
                  onChange={(e) => patch(i, { action: e.target.value as RouteRule["action"] })}
                >
                  {ACTIONS.map((a) => (
                    <option key={a} value={a}>
                      {t(actionLabel[a])}
                    </option>
                  ))}
                </select>
                <button
                  className="chip ghost"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label={t("routeUp")}
                  title={t("routeUp")}
                >
                  ↑
                </button>
                <button
                  className="chip ghost"
                  onClick={() => move(i, 1)}
                  disabled={i === rules.length - 1}
                  aria-label={t("routeDown")}
                  title={t("routeDown")}
                >
                  ↓
                </button>
                <button className="chip ghost" onClick={() => remove(i)} aria-label={t("routeDelete")}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {connected && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="row" style={{ borderBottom: 0 }}>
            <div className="txt">
              <b>{t("routeApply")}</b>
              <span>{t("routeApplyHint")}</span>
            </div>
            <button className="btn" style={{ width: "auto", paddingInline: 16 }} onClick={onReconnect}>
              {t("reconnect")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
