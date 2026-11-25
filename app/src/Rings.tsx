import { ringDash, ringLength } from "./ringMath";

export type RingItem = { key: string; label: string; pct: number; text: string };

/**
 * Кольца: доля видна без чтения цифры, а цифра в центре — точная. Три
 * кольца в ряд читаются быстрее, чем три строки текста.
 */
export function Rings(p: { items: RingItem[] }) {
  const R = 26;
  const C = ringLength(R);
  return (
    <div className="rings">
      {p.items.map((it) => {
        const pct = Math.max(0, Math.min(1, it.pct));
        return (
          <div className="ring" key={it.key}>
            <svg viewBox="0 0 64 64" aria-hidden="true">
              <circle className="ring-track" cx="32" cy="32" r={R} />
              <circle
                className="ring-fill"
                cx="32"
                cy="32"
                r={R}
                strokeDasharray={C.toFixed(2)}
                strokeDashoffset={ringDash(pct, C).toFixed(2)}
                transform="rotate(-90 32 32)"
              />
            </svg>
            <div className="ring-text">
              <b>{it.text}</b>
              <span>{it.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
