// Выбор DNS как в Zapret: по категориям, с поиском и тремя способами
// подключения у каждого. Нажал плашку — адрес ушёл в настройки, туннель
// подхватит его при следующем запуске.

import { useMemo, useState } from "react";
import { dnsGroups, entryOf, proofLabel, proofOf, type DnsProof } from "./dns";
import type { Lang } from "./i18n";

type Props = {
  lang: Lang;
  value: string;
  onChange: (value: string) => void;
  t: (k: string) => string;
};

const proofs: DnsProof[] = ["doh", "dot", "plain"];

export function DnsPick({ lang, value, onChange, t }: Props) {
  const [query, setQuery] = useState("");
  const active = entryOf(value);
  const proof = proofOf(value);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return dnsGroups;
    return dnsGroups
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (i) =>
            i.owner.toLowerCase().includes(q) ||
            i.note[lang].toLowerCase().includes(q) ||
            i.plain.includes(q) ||
            i.doh.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [query, lang]);

  const found = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="dns-box">
      <div className="dns-head">
        <input
          className="input"
          value={query}
          spellCheck={false}
          placeholder={t("dnsSearch")}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t("dnsSearch")}
        />
        <span className="sub">{query ? t("dnsFound") + " " + found : t("dnsTotal") + " " + dnsGroups.reduce((n, g) => n + g.items.length, 0)}</span>
      </div>

      <div className="dns-legend">
        <span><b>DoH</b> {t("dnsLegendDoh")}</span>
        <span><b>DoT</b> {t("dnsLegendDot")}</span>
        <span><b>IP</b> {t("dnsLegendIp")}</span>
      </div>

      <div className="dns-now">
        <span className="sub">{t("dnsNow")}</span>
        <code>{value.trim() || "—"}</code>
        <span className="chip dns-chip" data-on="true">{proof === "own" ? t("dnsOwnChip") : proofLabel(proof)}</span>
      </div>

      {groups.map((g) => (
        <section key={g.id} className="dns-group">
          <header>
            <h4>{g.title[lang]}</h4>
            <p className="sub">{g.hint[lang]}</p>
          </header>
          <div className="dns-list">
            {g.items.map((item) => {
              const on = active === item.id;
              return (
                <div className="dns-item" key={item.id} data-on={on}>
                  <div className="dns-name">
                    <b>
                      {item.owner}
                      {item.star && <span className="dns-star" title={t("dnsBest")}>★</span>}
                    </b>
                    <span className="sub">{item.note[lang]}</span>
                  </div>
                  <div className="dns-proofs">
                    {proofs.map((p) => {
                      const val = p === "doh" ? item.doh : p === "dot" ? item.dot : item.plain;
                      const chosen = value.trim().toLowerCase() === val.toLowerCase();
                      return (
                        <button
                          key={p}
                          className="chip dns-chip"
                          data-on={chosen}
                          data-proto={p}
                          onClick={() => onChange(val)}
                          title={val}
                        >
                          {proofLabel(p)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {query && found === 0 && <div className="muted dns-none">{t("dnsEmpty")}</div>}

      <section className="dns-group">
        <header>
          <h4>{t("dnsOwn")}</h4>
          <p className="sub">{t("dnsOwnHint")}</p>
        </header>
        <input
          className={"input" + (proof === "own" ? " input-on" : "")}
          value={value}
          spellCheck={false}
          placeholder="https://dns.example/dns-query"
          onChange={(e) => onChange(e.target.value)}
          aria-label={t("dnsOwn")}
        />
      </section>
    </div>
  );
}
