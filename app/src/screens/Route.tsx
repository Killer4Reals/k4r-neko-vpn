import { useState } from "react";
import type { RouteRule } from "../api";

type Props = {
  t: (k: string) => string;
  rules: RouteRule[];
  setRules: (r: RouteRule[]) => void;
  ruDirect: boolean;
  setRuDirect: (v: boolean) => void;
  blockAds: boolean;
  setBlockAds: (v: boolean) => void;
  connected: boolean;
  onReconnect: () => void;
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
  rules,
  setRules,
  ruDirect,
  setRuDirect,
  blockAds,
  setBlockAds,
  connected,
  onReconnect,
}: Props) {
  const [kind, setKind] = useState<RouteRule["kind"]>("suffix");
  const [action, setAction] = useState<RouteRule["action"]>("direct");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

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
      <div className="page-head">
        <h1>{t("routeTitle")}</h1>
        <p>{t("routeSub")}</p>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row">
          <div className="txt">
            <b>{t("routeRu")}</b>
            <span>{t("routeRuHint")}</span>
          </div>
          <button className="switch" aria-checked={ruDirect} onClick={() => setRuDirect(!ruDirect)}>
            <span />
          </button>
        </div>
        <div className="row">
          <div className="txt">
            <b>{t("routeAds")}</b>
            <span>{t("routeAdsHint")}</span>
          </div>
          <button className="switch" aria-checked={blockAds} onClick={() => setBlockAds(!blockAds)}>
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
          <p className="muted" style={{ marginTop: 14 }}>{t("routeEmpty")}</p>
        ) : (
          <div className="rule-list">
            {rules.map((r, i) => (
              <div key={`${r.kind}:${r.value}`} className="rule-row">
                <button
                  className="switch"
                  aria-checked={r.enabled}
                  aria-label={t("routeEnable")}
                  onClick={() => patch(i, { enabled: !r.enabled })}
                >
                  <span />
                </button>
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
