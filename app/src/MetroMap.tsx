import { exitTone, type MetroCounts } from "./metroMath";

type Props = {
  t: (k: string) => string;
  counts: MetroCounts;
  exit: string;
  connected: boolean;
  guard: boolean;
};

/**
 * Маршрут как схема метро: одна станция «ты», три ветки — туннель, напрямую
 * и блок — и станция выхода. Схема показывает устройство маршрута до чтения
 * правил, а не заменяет их.
 */
export function MetroMap(p: Props) {
  const tone = exitTone(p.connected, p.exit);
  const lanes = [
    { id: "proxy", y: 44, label: p.t("routeMetroProxy"), n: p.counts.proxy, live: p.connected },
    { id: "direct", y: 96, label: p.t("routeMetroDirect"), n: p.counts.direct, live: false },
    { id: "block", y: 148, label: p.t("routeMetroBlock"), n: p.counts.block, live: false },
  ];
  return (
    <div className="metro" role="img" aria-label={p.t("routeMetroHint")}>
      <svg viewBox="0 0 640 190" preserveAspectRatio="xMidYMid meet">
        {/* Ствол от «ты» к развилке и три ветки с мягкими изломами. */}
        <path className="metro-trunk" d="M 44 96 H 128" />
        <path className="metro-trunk" d="M 128 44 V 148" />
        {lanes.map((l) => (
          <g key={l.id} data-tone={l.id}>
            <path
              className="metro-lane"
              d={`M 128 ${l.y} H 470`}
              data-live={l.live ? "true" : "false"}
            />
            <circle className="metro-node" cx="128" cy={l.y} r="5" />
            <circle className="metro-node" cx="300" cy={l.y} r="7" />
            <circle className="metro-node" cx="470" cy={l.y} r="5" />
            {/* Ноль на схеме читается как «сломано», а не «правил нет»:
                пока счётчик пуст, цифру не рисуем. */}
            {l.n > 0 && (
              <text className="metro-count" x="300" y={l.y - 14} textAnchor="middle">
                {l.n}
              </text>
            )}
            <text className="metro-label" x="470" y={l.y + 24} textAnchor="middle">
              {l.label}
            </text>
          </g>
        ))}
        <circle className="metro-you" cx="44" cy="96" r="9" />
        <text className="metro-you-label" x="44" y="126" textAnchor="middle">
          {p.t("routeMetroYou")}
        </text>
        {/* Выход: последняя станция справа, красится по состоянию связи. */}
        <g data-tone={tone}>
          <path className="metro-exit" d="M 470 44 H 560" />
          <circle className="metro-exit-node" cx="560" cy="44" r="9" />
          <text className="metro-exit-label" x="560" y="24" textAnchor="middle">
            {p.exit}
          </text>
        </g>
        {p.guard && (
          <g>
            <path className="metro-guard" d="M 470 148 H 560" />
            <text className="metro-guard-label" x="560" y="172" textAnchor="middle">
              {p.t("routeMetroGuard")}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
