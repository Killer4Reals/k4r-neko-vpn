/** Доля 0..1 с защитой от нуля и отрицательных значений. */
export function ringPct(part: number, total: number): number {
  if (!(total > 0)) return 0;
  const v = part / total;
  return Math.max(0, Math.min(1, v));
}

/** Смещение штриха: доля заполненной окружности для stroke-dashoffset. */
export function ringDash(pct: number, circumference: number): number {
  const p = Math.max(0, Math.min(1, pct));
  return circumference * (1 - p);
}

/** Окружность кольца при заданном радиусе. */
export function ringLength(r: number): number {
  return 2 * Math.PI * r;
}
