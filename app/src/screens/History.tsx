import { useMemo } from "react";
import { availability, clock, groupByDay, labelKey, plural, type HistoryEvent } from "../history";

type Props = {
  t: (k: string) => string;
  events: HistoryEvent[];
  /** Имя узла по id: в истории видно «Франкфурт», а не «de-1». */
  nameOfId: (id: string) => string;
  lang: "ru" | "en";
  onClear: () => void;
};

const DAY_LABEL: Record<string, string> = {
  today: "histToday",
  yesterday: "histYesterday",
};

const KIND_TONE: Record<HistoryEvent["kind"], string> = {
  connect: "ok",
  disconnect: "mute",
  switch: "accent",
  fail: "bad",
  nodeDown: "bad",
  nodeUp: "ok",
};

/**
 * История: что происходило с туннелем и узлами.
 *
 * Раньше падение было видно только в момент падения. Здесь строка на каждое
 * событие и честная доступность узлов: «этот за неделю падал 6 раз» — повод
 * его больше не выбирать.
 */
export function HistoryScreen({ t, events, nameOfId, onClear, lang }: Props) {
  const now = Date.now();
  const groups = useMemo(() => groupByDay(events, now), [events, now]);
  const health = useMemo(() => availability(events, now).slice(0, 6), [events, now]);

  const downWord = (n: number) => {
    const form = plural(n, lang);
    return form === "one" ? "histDownOne" : form === "few" ? "histDownFew" : "histDownMany";
  };

  const dayLabel = (key: string, at: number) => {
    if (DAY_LABEL[key]) return t(DAY_LABEL[key]);
    const d = new Date(at);
    return d.toLocaleDateString(undefined, { day: "numeric", month: "long" });
  };

  return (
    <>
      <div className="page-head">
        <h1>{t("histTitle")}</h1>
        <p>{t("histSub")}</p>
      </div>

      {health.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-title">{t("histAvailability")}</div>
          {health.map((row) => (
            <div key={row.id} className="hist-uptime">
              <div className="hist-uptime-name">{nameOfId(row.id)}</div>
              <div className="hist-uptime-bar">
                <span
                  className={row.pct >= 98 ? "ok" : row.pct >= 90 ? "warn" : "bad"}
                  style={{ width: `${Math.max(3, row.pct)}%` }}
                />
              </div>
              <div className="hist-uptime-pct">
                {row.pct}% · {row.downs} {t(downWord(row.downs))}
              </div>
            </div>
          ))}
          <div className="muted" style={{ marginTop: 8 }}>
            {t("histAvailabilityHint")}
          </div>
        </div>
      )}

      {events.length === 0 ? (
        <div className="card">
          <div className="muted">{t("histEmpty")}</div>
        </div>
      ) : (
        groups.map((g) => (
          <div key={`${g.key}-${g.at}`} className="card" style={{ marginBottom: 12 }}>
            <div className="card-title">{dayLabel(g.key, g.at || g.items[0].at)}</div>
            <div className="hist-list">
              {g.items.map((ev, i) => (
                <div key={`${ev.at}-${i}`} className="hist-row">
                  <span className="hist-time">{clock(ev.at)}</span>
                  <span className={`hist-dot ${KIND_TONE[ev.kind]}`} />
                  <span className="hist-text">
                    {t(labelKey(ev.kind))}
                    {ev.kind === "switch" && ev.a && ev.b
                      ? `: ${nameOfId(ev.a)} → ${nameOfId(ev.b)}`
                      : ev.kind === "connect" || ev.kind === "nodeDown" || ev.kind === "nodeUp"
                        ? ev.a
                          ? `: ${nameOfId(ev.a)}`
                          : ""
                        : ev.b
                          ? `: ${ev.b}`
                          : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {events.length > 0 && (
        <button className="btn" style={{ width: "auto", paddingInline: 16 }} onClick={onClear}>
          {t("histClear")}
        </button>
      )}
    </>
  );
}
