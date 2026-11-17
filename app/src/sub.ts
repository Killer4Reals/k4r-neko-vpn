/** Срок и остаток подписки: считать это в интерфейсе на глаз — значит врать. */

export type SubTiming = {
  /** сколько целых дней осталось; 0 — истекает сегодня */
  days: number;
  /** "none" — провайдер не сказал, "ok" — живём, "soon" — три дня и меньше, "expired" */
  state: "none" | "ok" | "soon" | "expired";
};

/**
 * Разница в днях между сроком и «сейчас». Работает и с unix-секундами, и с
 * миллисекундами: провайдеры отдают секунды, но ошибиться на три нуля легко,
 * поэтому большое число считаем миллисекундами.
 */
export function subTiming(expire: number, nowMs: number = Date.now()): SubTiming {
  if (!expire || expire <= 0) return { days: 0, state: "none" };
  const expireMs = expire > 1e12 ? expire : expire * 1000;
  const left = expireMs - nowMs;
  if (left <= 0) return { days: 0, state: "expired" };
  const days = Math.floor(left / 86_400_000);
  return { days, state: days <= 3 ? "soon" : "ok" };
}

/** Сколько байт осталось; отрицательное не показываем — это уже не «осталось». */
export function leftBytes(total: number, usedDown: number, usedUp: number): number {
  if (!total || total <= 0) return 0;
  return Math.max(0, total - usedDown - usedUp);
}

/** Байты в человеческое «12.3 ГБ» — одна цифра после точки, без ложной точности. */
export function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(gb < 10 ? 1 : 0)} ГБ`;
  const mb = bytes / 1024 ** 2;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} МБ`;
}
