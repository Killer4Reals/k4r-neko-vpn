import { arcPath, turbineAngle, turbinePoint, turbineStats } from "./turbineMath";

/**
 * Турбина: дуга 270° с текущей скоростью, меткой пика и средней. Цифра
 * «сейчас» прыгает, дуга показывает место в собственной шкале — спокойно.
 */
export function Turbine(p: { data: number[]; t: (k: string) => string }) {
  const st = turbineStats(p.data);
  const ang = turbineAngle(st.now, st.cap);
  const peakAng = turbineAngle(st.peak, st.cap);
  const hub = turbinePoint(ang, 34);
  const peakPt = turbinePoint(peakAng, 40);
  return (
    <div className="turbine" role="img" aria-label={`${st.now.toFixed(1)} MB/s`}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <path className="turbine-track" d={arcPath(60, 60, 40, 135, 405)} />
        {st.now > 0 && <path className="turbine-fill" d={arcPath(60, 60, 40, 135, Math.max(136, ang))} />}
        {st.peak > 0 && (
          <line
            className="turbine-peak"
            x1={peakPt.x.toFixed(2)}
            y1={peakPt.y.toFixed(2)}
            x2={turbinePoint(peakAng, 34).x.toFixed(2)}
            y2={turbinePoint(peakAng, 34).y.toFixed(2)}
          />
        )}
        <line
          className="turbine-needle"
          x1="60"
          y1="60"
          x2={hub.x.toFixed(2)}
          y2={hub.y.toFixed(2)}
        />
        <circle className="turbine-hub" cx="60" cy="60" r="3.2" />
        <text className="turbine-now" x="60" y="88" textAnchor="middle">
          {st.now.toFixed(1)}
        </text>
        <text className="turbine-unit" x="60" y="100" textAnchor="middle">
          MB/s
        </text>
      </svg>
      <div className="turbine-legend">
        <span>
          {p.t("turbinePeak")} <b>{st.peak.toFixed(1)}</b>
        </span>
        <span>
          {p.t("turbineAvg")} <b>{st.avg.toFixed(1)}</b>
        </span>
      </div>
    </div>
  );
}
