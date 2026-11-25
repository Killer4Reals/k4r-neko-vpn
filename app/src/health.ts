/**
 * Здоровье узлов: одна пара правил на всё приложение, чтобы список серверов,
 * точки на планете и автопереключение считали одинаково.
 *
 * Замер — это TCP-рукопожатие, а не «пинг» в игре: он говорит, сколько ждать
 * до сервера, и не тратит трафик.
 */

/** Замер свежий 12 минут: опрос идёт раз в 10, но круг не идеален. */
export const FRESH_MS = 12 * 60 * 1000;

/** Порог, ниже которого человек разницы не чувствует, а туннель дёргать нельзя. */
export const SLOW_MARGIN_MS = 40;

/** Живой ли замер: старый — это «давно не спрашивали», а не «узел умер». */
export function isFresh(at: number | undefined, now = Date.now()): boolean {
  return typeof at === "number" && now - at < FRESH_MS;
}

/**
 * Цвет точки: null — не ответил, старый замер — серый, дальше по скорости.
 * Значения те же, что в палитре приложения.
 */
export type NodeTone = "dead" | "stale" | "fast" | "ok" | "slow";

export function nodeTone(ms: number | null, stale: boolean): NodeTone {
  if (ms === null) return "dead";
  if (stale) return "stale";
  if (ms < 90) return "fast";
  if (ms < 180) return "ok";
  return "slow";
}

/** Цвета для холста: держим их здесь, чтобы три места не разъезжались. */
export const TONE_COLOR: Record<NodeTone, string> = {
  dead: "#ff5d6c",
  stale: "#8e8a9c",
  fast: "#39FF14",
  ok: "#ffd166",
  slow: "#ff9a4d",
};

/**
 * Стоит ли уходить с текущего узла. Возвращает лучший вариант или null.
 *
 * Правила простые и проверяемые: текущий должен ответить, лучший должен быть
 * лучше на SLOW_MARGIN_MS, и это должен быть не тот же самый сервер.
 */
export function slowSwitchTarget(
  current: string,
  measured: Record<string, number | null>,
): string | null {
  const cur = measured[current];
  if (typeof cur !== "number") return null;
  let bestId: string | null = null;
  let bestMs = Number.POSITIVE_INFINITY;
  for (const [id, ms] of Object.entries(measured)) {
    if (id === current || typeof ms !== "number") continue;
    if (ms < bestMs) {
      bestMs = ms;
      bestId = id;
    }
  }
  if (!bestId) return null;
  // «хуже больше чем на 40 мс» — значит ровно 40 ещё не повод
  if (cur - bestMs <= SLOW_MARGIN_MS) return null;
  return bestId;
}

/**
 * Сколько узлов ответило: «4 из 6». Считаем только те, кого уже мерили —
 * неизмеренный узел не должен выглядеть мёртвым.
 */
export function aliveCount(
  ids: string[],
  measured: Record<string, number | null>,
): { alive: number; total: number } {
  let alive = 0;
  let total = 0;
  for (const id of ids) {
    if (!(id in measured)) continue;
    total += 1;
    if (typeof measured[id] === "number") alive += 1;
  }
  return { alive, total };
}

/**
 * Весь пул молчит. Возвращаем счётчик только когда измерены ВСЕ узлы, замеры
 * свежие и ни один не ответил. Иначе это «ещё не мерили» или «мерили давно», а
 * не приговор провайдеру — пугать человека таким нельзя.
 */
export function poolDead(
  ids: string[],
  measured: Record<string, number | null>,
  at: Record<string, number> = {},
  now = Date.now(),
): { dead: number; total: number } | null {
  if (ids.length === 0) return null;
  let total = 0;
  let dead = 0;
  for (const id of ids) {
    if (!(id in measured)) return null;
    if (!isFresh(at[id], now)) return null;
    total += 1;
    if (measured[id] === null) dead += 1;
  }
  if (total === 0 || dead !== total) return null;
  return { dead, total };
}

/** Когда последний раз хоть один узел реально ответил (0 — не было ни разу). */
export function lastAliveAt(
  measured: Record<string, number | null>,
  at: Record<string, number> = {},
): number {
  let last = 0;
  for (const [id, ms] of Object.entries(measured)) {
    if (typeof ms === "number" && (at[id] ?? 0) > last) last = at[id] ?? 0;
  }
  return last;
}
