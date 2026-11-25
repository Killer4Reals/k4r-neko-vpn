import type { Server } from "./data";

export type Grade = "A" | "B" | "C" | "D";

/**
 * Оценка выхода 0..100: одна цифра вместо трёх графиков. Штрафуем за
 * задержку, заявленное качество узла и за старый замер — последнее важно:
 * «40 мс» недельной давности не значит ничего.
 */
export function score(latency: number | null | undefined, quality: Server["quality"], fresh: boolean): number {
  let s = 100;
  if (latency === null || latency === undefined) {
    s = 55;
  } else if (latency > 300) {
    s -= 45;
  } else if (latency > 150) {
    s -= 30;
  } else if (latency > 80) {
    s -= 15;
  }
  if (quality === "bad") s -= 20;
  else if (quality === "mid") s -= 8;
  if (!fresh) s -= 10;
  return Math.max(0, Math.min(100, Math.round(s)));
}

export function grade(value: number): Grade {
  if (value >= 85) return "A";
  if (value >= 70) return "B";
  if (value >= 50) return "C";
  return "D";
}

/**
 * Провайдер по адресу: `fra12.somehost.net` → `somehost.net`. Имя узла у
 * провайдеров меняется, домен — нет, поэтому показываем домен.
 */
export function providerOf(host: string | undefined): string {
  const h = (host ?? "").trim().toLowerCase();
  if (!h) return "—";
  // IPv4/IPv6 буквально: домена нет, показываем как есть.
  if (/^[0-9.]+$/.test(h) || h.includes(":")) return h;
  const parts = h.split(".").filter(Boolean);
  if (parts.length <= 2) return h;
  return parts.slice(-2).join(".");
}
