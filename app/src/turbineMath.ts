export type Turbine = { now: number; avg: number; peak: number; cap: number };

/** Сводка по последним замерам, МБ/с. Пик и средняя — по окну, а не за всё время. */
export function turbineStats(trail: number[]): Turbine {
  const vals = trail.filter((v) => Number.isFinite(v) && v >= 0);
  const peak = vals.length ? Math.max(...vals) : 0;
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  const now = vals.length ? vals[vals.length - 1] : 0;
  // Шкала не дёргается от каждого всплеска: округляем вверх до десятков.
  const cap = Math.max(10, Math.ceil(peak / 10) * 10);
  return { now, avg, peak, cap };
}

/** 270° шкалы: слева-снизу (135°) до справа-снизу (405°). */
export function turbineAngle(now: number, cap: number): number {
  const t = cap > 0 ? Math.max(0, Math.min(1, now / cap)) : 0;
  return 135 + t * 270;
}

/** Точка на окружности; 0° — вправо, углы растут по часовой. */
export function turbinePoint(angle: number, r: number, cx = 60, cy = 60): { x: number; y: number } {
  const rad = (angle * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** Дуга для SVG: от start до end по часовой стрелке. */
export function arcPath(cx: number, cy: number, r: number, start: number, end: number): string {
  const a = turbinePoint(start, r, cx, cy);
  const b = turbinePoint(end, r, cx, cy);
  const large = end - start > 180 ? 1 : 0;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}
