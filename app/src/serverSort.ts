/**
 * Порядок узлов в списке. Избранные всегда сверху — это единственное, что
 * человек отметил руками.
 */

import type { Server } from "./data";

export type SortMode = "ping" | "name" | "country";

export const SORT_MODES: SortMode[] = ["ping", "name", "country"];

const byText = (a: string, b: string) => a.localeCompare(b, "ru", { sensitivity: "base" });

/**
 * Сортировка копией: исходный список приходит из подписки и менять его нельзя.
 * Узел без замера (0) уходит вниз: пустая строка в середине списка выглядит
 * как «сервер хуже всех», хотя его просто ещё не мерили.
 */
export function sortServers(list: Server[], mode: SortMode, favorites: string[]): Server[] {
  const fav = new Set(favorites);
  return list
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const f = Number(fav.has(b.s.id)) - Number(fav.has(a.s.id));
      if (f !== 0) return f;
      if (mode === "name") return byText(a.s.city, b.s.city) || a.i - b.i;
      if (mode === "country") {
        return byText(a.s.country, b.s.country) || byText(a.s.city, b.s.city) || a.i - b.i;
      }
      const am = a.s.lat;
      const bm = b.s.lat;
      if ((am === 0) !== (bm === 0)) return am === 0 ? 1 : -1;
      if (am !== bm) return am - bm;
      return a.i - b.i;
    })
    .map((x) => x.s);
}
