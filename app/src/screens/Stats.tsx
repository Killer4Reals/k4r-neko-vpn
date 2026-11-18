import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { barHeight, human, totals, windowOf, type DayTraffic } from "../stats";

type Props = { t: (k: string) => string };

/**
 * Статистика трафика за 7 или 30 дней. Те же цифры, что на телефоне: только
 * то, что прошло через туннель, и ничего наружу.
 */
export function StatsScreen({ t }: Props) {
  const [days, setDays] = useState<DayTraffic[]>([]);
  const [span, setSpan] = useState(7);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => api.statsRead().then(setDays).catch(() => undefined);

  useEffect(() => {
    void load();
  }, []);

  const view = useMemo(() => windowOf(days, span), [days, span]);
  const sum = useMemo(() => totals(view), [view]);
  const peak = Math.max(1, ...view.map((d) => d.down + d.up));

  return (
    <>
      <div className="page-head">
        <h1>{t("statsTitle")}</h1>
        <p>{t("statsSub")}</p>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="seg" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {[7, 30].map((n) => (
            <button
              key={n}
              className={`btn${span === n ? " primary" : ""}`}
              style={{ width: "auto", paddingInline: 14 }}
              onClick={() => setSpan(n)}
            >
              {n} {t("statsDays")}
            </button>
          ))}
        </div>

        {sum.total === 0 ? (
          <div className="muted">{t("statsEmpty")}</div>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${view.length}, 1fr)`,
                alignItems: "end",
                gap: 4,
                height: 150,
                padding: "8px 0",
              }}
            >
              {view.map((d) => {
                const value = d.down + d.up;
                return (
                  <div
                    key={d.day}
                    title={`${d.day}: ${human(value)}`}
                    style={{
                      height: `${barHeight(value, peak)}%`,
                      minHeight: value > 0 ? 3 : 2,
                      background: value > 0 ? "var(--green, #39FF14)" : "rgba(136,136,136,0.25)",
                      borderRadius: 4,
                    }}
                  />
                );
              })}
            </div>
            <div className="muted" style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
              <span>{view[0]?.day.slice(5).replace("-", ".")}</span>
              <span>{t("statsToday")}</span>
            </div>

            <div style={{ marginTop: 14, display: "grid", gap: 6 }}>
              <div className="row" style={{ padding: "4px 0" }}>
                <span>{t("statsPeriod")}</span>
                <b>{human(sum.total)}</b>
              </div>
              <div className="row" style={{ padding: "4px 0" }}>
                <span>{t("statsAverage")}</span>
                <b>{human(sum.average)}</b>
              </div>
              <div className="row" style={{ padding: "4px 0" }}>
                <span>
                  {t("statsPeak")}
                  {sum.peakDay ? ` (${sum.peakDay})` : ""}
                </span>
                <b>{human(sum.peak)}</b>
              </div>
              <div className="row" style={{ padding: "4px 0" }}>
                <span>{t("statsToday")}</span>
                <b>{human(sum.today)}</b>
              </div>
            </div>
          </>
        )}

        <div style={{ marginTop: 16 }}>
          {confirm ? (
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.statsReset();
                  await load();
                  setConfirm(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("statsResetYes")}
            </button>
          ) : (
            <button className="btn" style={{ width: "auto", paddingInline: 14 }} onClick={() => setConfirm(true)}>
              {t("statsReset")}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
