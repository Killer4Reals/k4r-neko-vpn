/**
 * Автовыбор сервера. Здесь только решение «переключаться или нет» — без сети,
 * таймеров и движка, чтобы это можно было проверить тестами.
 *
 * Правила намеренно консервативные: каждый переключатель — это разрыв
 * соединения, поэтому «чуть лучше» не считается поводом.
 */

/** Замер отклика одного сервера. `ms = null` — не ответил. */
export type Measure = { id: string; ms: number | null };

/**
 * Насколько новый сервер должен быть быстрее текущего, чтобы его стоило
 * ставить. 25% — середина диапазона 20–30%: меньше — дёргаемся из-за шума
 * измерений, больше — терпим заметно худший сервер.
 */
export const SWITCH_MARGIN = 0.25;

/** Порог «канал занят»: 2 МБ/с за последний замер — это активная закачка. */
export const BUSY_BYTES_PER_SEC = 2 * 1024 * 1024;

/**
 * Кого выбрать. `null` — оставить текущий.
 *
 * - недоступные (null) не рассматриваются;
 * - если текущий не ответил, а кто-то ответил — переключаемся;
 * - текущий в топ-1 — не трогаем (в том числе при равенстве: стабильность);
 * - иначе переключаемся только если лучший быстрее текущего на `margin`.
 */
export function pickServer(
  current: Measure | undefined,
  all: Measure[],
  margin: number = SWITCH_MARGIN,
): string | null {
  const alive = all.filter((m) => typeof m.ms === "number" && m.ms !== null && m.ms >= 0);
  if (alive.length === 0) return null;

  const best = alive.reduce((a, b) => ((b.ms as number) < (a.ms as number) ? b : a));

  if (!current || current.ms === null || current.ms === undefined) {
    // Текущего нет или он не отвечает: любой живой лучше мёртвого.
    return best.id === current?.id ? null : best.id;
  }
  if (best.id === current.id) return null;
  // Текущий и есть лучший по замеру (равенство трактуем в его пользу).
  const currentMs = current.ms;
  if (best.ms === null || best.ms === undefined) return null;
  return best.ms <= currentMs * (1 - margin) ? best.id : null;
}

/**
 * Разделить серверы на основные и резервные. Резерв — это «последний шанс»:
 * он берётся, только если все основные не отвечают или в карантине.
 */
export function splitReserve<T extends { id: string }>(
  all: T[],
  reserveIds: Set<string>,
): { main: T[]; reserve: T[] } {
  const main: T[] = [];
  const reserve: T[] = [];
  for (const item of all) {
    if (reserveIds.has(item.id)) reserve.push(item);
    else main.push(item);
  }
  return { main, reserve };
}

/** Канал занят? Тогда переключение откладываем до паузы. */
export function isBusy(bytesPerSec: number, limit: number = BUSY_BYTES_PER_SEC): boolean {
  return bytesPerSec > limit;
}

/** Подпись частоты для настроек: 0 — выключено. */
export function label(minutes: number): string {
  return minutes <= 0 ? "off" : `${minutes} min`;
}
