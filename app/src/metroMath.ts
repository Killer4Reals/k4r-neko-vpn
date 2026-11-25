export type MetroCounts = { proxy: number; direct: number; block: number };

/** Считаем только включённые правила: выключенное в схеме не участвует. */
export function metroCounts(rules: { action: string; enabled: boolean }[]): MetroCounts {
  const out: MetroCounts = { proxy: 0, direct: 0, block: 0 };
  for (const r of rules) {
    if (!r.enabled) continue;
    if (r.action === "proxy") out.proxy += 1;
    else if (r.action === "direct") out.direct += 1;
    else if (r.action === "block") out.block += 1;
  }
  return out;
}

/** Тон выхода: есть связь и есть адрес — зелёный; связи нет — серый; пусто — красный. */
export function exitTone(connected: boolean, exit: string): "ok" | "idle" | "bad" {
  if (!exit.trim()) return "bad";
  return connected ? "ok" : "idle";
}

/** Подпись для станции «выход»: город, иначе страна, иначе прочерк. */
export function exitLabel(city: string, country: string): string {
  const c = city.trim();
  if (c) return c;
  const k = country.trim();
  return k || "—";
}
