import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { axisTicks, barHeight, human, niceMax, totals, windowOf, type DayTraffic } from "../stats";
import { Rings } from "../Rings";
import { ringPct } from "../ringMath";

type Props = { t: (k: string) => string; head?: boolean };

/**
 * Статистика трафика за 7 или 30 дней. Те же цифры, что на телефоне: только
 * то, что прошло через туннель, и ничего наружу.
 */
export function StatsScreen({ t, head = true }: Props) {
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
  const hasData = sum.total > 0;
  // Кольца: доли принятого и отправленного считаем от общего, активные дни —
  // от выбранного окна. Ноль в знаменателе даёт пустое кольцо, а не NaN.
  const activeDays = view.filter((d) => d.down + d.up > 0).length;
  const ringItems = [
    { key: "down", label: t("ringDown"), pct: ringPct(sum.down, sum.total), text: human(sum.down) },
    { key: "up", label: t("ringUp"), pct: ringPct(sum.up, sum.total), text: human(sum.up) },
    { key: "days", label: t("ringDays"), pct: ringPct(activeDays, span), text: activeDays + "/" + span },
  ];

  return (
    <>
      {head && (
        <div className="page-head">
          <h1>{t("statsTitle")}</h1>
          <p>{t("statsSub")}</p>
        </div>
      )}

      <Rings items={ringItems} />

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
          // Пустой экран — тоже экран: маскот и текст вместо голой строки
          <div className="empty-box">
            <img src="/mascot/log-empty.webp" alt="" draggable={false} />
            <div>
              <h3>{t("statsEmptyTitle")}</h3>
              <p className="muted">{t("statsEmpty")}</p>
            </div>
          </div>
        ) : (
          <>
            {(() => {
              const top = niceMax(peak);
              const ticks = axisTicks(peak);
              const columns = { gridTemplateColumns: `repeat(${view.length}, minmax(0, 1fr))` };
              return (
                <div className="chart">
                  <div className="chart-axis" aria-hidden="true">
                    {ticks.map((v, i) => (
                      <span key={i}>{human(v)}</span>
                    ))}
                  </div>
                  <div className="chart-main">
                    <div className="chart-plot">
                      <div className="chart-grid" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </div>
                      <div className="chart-bars" role="list" aria-label={t("statsTitle")} style={columns}>
                        {view.map((d) => {
                          const value = d.down + d.up;
                          return (
                            <div
                              key={d.day}
                              className="chart-col"
                              role="listitem"
                              title={`${d.day}: ${human(value)}`}
                              aria-label={`${d.day}: ${human(value)}`}
                            >
                              <div
                                className="chart-bar"
                                data-empty={value > 0 ? "false" : "true"}
                                style={{
                                  height: `${barHeight(value, top)}%`,
                                  minHeight: value > 0 ? 3 : 2,
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="chart-days" style={columns} aria-hidden="true">
                      {view.map((d, i) => {
                        const showDay = span === 7 || i === 0 || i === view.length - 1 || i % 5 === 0;
                        return <span key={d.day}>{showDay ? d.day.slice(5).replace("-", ".") : ""}</span>;
                      })}
                    </div>
                  </div>
                </div>
              );
            })()}

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
            <button
              className="ghost-btn"
              disabled={!hasData}
              onClick={() => setConfirm(true)}
            >
              {t("statsReset")}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
