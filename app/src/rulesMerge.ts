import type { RouteRule } from "./api";

/**
 * Слияние импортированных правил с уже существующими.
 *
 * Импорт из zapret приносит тысячи строк, и повторный импорт не должен
 * удваивать список: правило с тем же признаком и значением остаётся одно.
 * Верхний предел — чтобы интерфейс и конфиг не превращались в болото.
 */
export const MAX_RULES = 6000;

export function mergeRules(current: RouteRule[], incoming: RouteRule[]): { rules: RouteRule[]; added: number } {
  const seen = new Set(current.map((r) => `${r.kind}|${r.value.toLowerCase()}`));
  const out = [...current];
  let added = 0;
  for (const rule of incoming) {
    const key = `${rule.kind}|${rule.value.toLowerCase()}`;
    if (seen.has(key)) continue;
    if (out.length >= MAX_RULES) break;
    seen.add(key);
    out.push(rule);
    added++;
  }
  return { rules: out, added };
}
