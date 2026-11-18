/**
 * Оркестратор: решение «какой сервер считать живым» на основе того, что мы
 * про него уже знаем. Логика чистая, сеть и таймеры — в App.tsx.
 *
 * Идея взята у zapret 2 (strategy-lock-manager: счётчики успехов, карантин,
 * закрепление лучшего), но применяется к паре «сервер + транспорт».
 */

export type Stats = {
  key: string;
  ok: number;
  fail: number;
  latency_ms: number;
  score: number;
  quarantined: boolean;
};

/** Ключ пары «сервер + транспорт»: у одного сервера их может быть несколько. */
export function pairKey(server: { id: string; network?: string; security?: string }): string {
  const net = (server.network || "tcp").toLowerCase();
  const sec = (server.security || "").toLowerCase();
  return `${server.id}|${net}|${sec}`;
}

/**
 * Кого нельзя выбирать прямо сейчас: сервер в карантине. Карантин ставит
 * бэкенд после трёх провалов подряд, снимается первой удачей.
 */
export function quarantinedIds(stats: Stats[]): Set<string> {
  const out = new Set<string>();
  for (const s of stats) {
    if (!s.quarantined) continue;
    // ключ = id|транспорт|безопасность
    const id = s.key.split("|")[0];
    if (id) out.add(id);
  }
  return out;
}

/**
 * Порядок предпочтения: сначала по счёту (надёжность + задержка), при равном
 * счёте — по замеру. Сервер, о котором нет данных, считается нейтральным.
 */
export function rank(measures: { id: string; ms: number | null }[], stats: Stats[]): string[] {
  const byScore = new Map<string, number>();
  for (const s of stats) {
    const id = s.key.split("|")[0];
    if (!id) continue;
    // у сервера может быть несколько транспортов — берём лучший
    byScore.set(id, Math.max(byScore.get(id) ?? 0, s.score));
  }
  const alive = measures.filter((m) => typeof m.ms === "number" && m.ms !== null) as {
    id: string;
    ms: number;
  }[];
  alive.sort((a, b) => {
    const sa = byScore.get(a.id) ?? 0.5;
    const sb = byScore.get(b.id) ?? 0.5;
    if (Math.abs(sb - sa) > 0.03) return sb - sa;
    return a.ms - b.ms;
  });
  return alive.map((m) => m.id);
}

/** Порог «тишины»: столько секунд без успешной пробы — считаем, что туннель мёртв. */
export const DEAD_AFTER_MS = 45_000;

/**
 * Пора ли переключаться из-за тишины. Возвращает true, если провалы идут
 * подряд и последний успех был слишком давно.
 */
export function looksDead(lastOkAt: number, now: number, fails: number, limit = DEAD_AFTER_MS): boolean {
  return fails >= 2 && now - lastOkAt >= limit;
}

/** Человеческая подпись счёта: 0..1 → проценты. */
export function scoreLabel(stats: Stats): string {
  return `${Math.round(stats.score * 100)}%`;
}
