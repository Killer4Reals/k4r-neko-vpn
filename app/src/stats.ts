/**
 * Статистика трафика: окно дней, суммы, столбики. Логика чистая — без Tauri,
 * чтобы её можно было проверить тестами.
 */

export type DayTraffic = { day: string; down: number; up: number };

export type Totals = {
  total: number;
  down: number;
  up: number;
  average: number;
  peak: number;
  peakDay: string;
  today: number;
};

/** Дата в виде 2026-11-18 по местному времени. */
export function dayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Ровно N календарных дней, включая сегодняшний. Пустой день — тоже день:
 * столбик должен стоять на своём месте, иначе график врёт.
 */
export function windowOf(days: DayTraffic[], count: number, today: string = dayKey()): DayTraffic[] {
  const known = new Map(days.map((d) => [d.day, d]));
  const out: DayTraffic[] = [];
  const base = new Date(`${today}T00:00:00`);
  for (let back = count - 1; back >= 0; back--) {
    const at = new Date(base);
    at.setDate(base.getDate() - back);
    const key = dayKey(at);
    const found = known.get(key);
    out.push({ day: key, down: found?.down ?? 0, up: found?.up ?? 0 });
  }
  return out;
}

export function totals(days: DayTraffic[]): Totals {
  const down = days.reduce((s, d) => s + d.down, 0);
  const up = days.reduce((s, d) => s + d.up, 0);
  const total = down + up;
  const peakDay = days.reduce<DayTraffic | null>(
    (best, d) => (best === null || d.down + d.up > best.down + best.up ? d : best),
    null,
  );
  return {
    total,
    down,
    up,
    average: days.length > 0 ? Math.round(total / days.length) : 0,
    peak: peakDay ? peakDay.down + peakDay.up : 0,
    peakDay: peakDay && peakDay.down + peakDay.up > 0 ? peakDay.day.slice(5).replace("-", ".") : "",
    today: days.length > 0 ? days[days.length - 1].down + days[days.length - 1].up : 0,
  };
}

/** Байты в человеческий вид. */
export function human(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 Б";
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** Высота столбика в процентах от максимума (минимум 2% для ненулевых дней). */
export function barHeight(value: number, peak: number): number {
  if (peak <= 0 || value <= 0) return 0;
  return Math.max(2, Math.round((value / peak) * 100));
}
