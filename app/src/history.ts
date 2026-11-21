/**
 * История событий: что происходило с туннелем и узлами.
 *
 * Зачем: падение видно только в момент падения. Через час уже не вспомнить,
 * «переключился на NL или я сам его выбрал», а с историей это одна строка.
 *
 * Всё здесь — чистые функции: их проверяют тесты, и они же рисуют экран.
 * Хранится последними 300 записей, поэтому файл настроек не растёт.
 */

export type HistoryKind = "connect" | "disconnect" | "switch" | "fail" | "nodeDown" | "nodeUp";

export type HistoryEvent = {
  /** Когда: миллисекунды, как у Date.now(). */
  at: number;
  kind: HistoryKind;
  /** Узел или его id: для switch — откуда, для nodeDown/nodeUp — кто. */
  a?: string;
  /** Куда переключились или текст ошибки. */
  b?: string;
};

export const HISTORY_CAP = 300;

/** Одинаковые события подряд (дребезг переподключения) схлопываем. */
const SAME_WINDOW_MS = 90_000;

/**
 * Добавить событие. Список хранится новыми сверху — так его и рисуем.
 * Если такое же событие (тот же вид и тот же узел) было меньше 1,5 минут назад,
 * второе не пишем: при переподключении они идут пачками и топят полезное.
 */
export function pushEvent(
  list: HistoryEvent[],
  ev: HistoryEvent,
  cap = HISTORY_CAP,
): HistoryEvent[] {
  const last = list[0];
  // Текст тоже сравниваем: две разные ошибки подряд — это два события,
  // а не дребезг одного (иначе пропадёт причина второго отказа)
  const same =
    last &&
    last.kind === ev.kind &&
    last.a === ev.a &&
    last.b === ev.b &&
    Math.abs(ev.at - last.at) < SAME_WINDOW_MS;
  if (same) return list;
  return [ev, ...list].slice(0, Math.max(1, cap));
}

/** Разбор сохранённого: битый JSON или чужие поля не должны ломать экран. */
export function parseEvents(raw: string | null | undefined): HistoryEvent[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const kinds: HistoryKind[] = ["connect", "disconnect", "switch", "fail", "nodeDown", "nodeUp"];
  const out: HistoryEvent[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const at = typeof o.at === "number" ? o.at : 0;
    const kind = o.kind as HistoryKind;
    if (!at || !kinds.includes(kind)) continue;
    out.push({
      at,
      kind,
      a: typeof o.a === "string" && o.a ? o.a : undefined,
      b: typeof o.b === "string" && o.b ? o.b : undefined,
    });
  }
  return out.sort((x, y) => y.at - x.at).slice(0, HISTORY_CAP);
}

export function serializeEvents(list: HistoryEvent[]): string {
  return JSON.stringify(list.slice(0, HISTORY_CAP));
}

export type DayKey = "today" | "yesterday" | "older";

/** К какому заголовку относится время: «Сегодня», «Вчера» или дата. */
export function dayKey(at: number, now: number): DayKey {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const today = startOfToday.getTime();
  if (at >= today) return "today";
  if (at >= today - 86_400_000) return "yesterday";
  return "older";
}

export type DayGroup = { key: DayKey; at: number; items: HistoryEvent[] };

/** Группы по дням, в том же порядке, что и события (новые сверху). */
export function groupByDay(list: HistoryEvent[], now: number): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const ev of list) {
    const key = dayKey(ev.at, now);
    // «older» — это разные даты, поэтому каждую дату даём отдельной группой
    const groupAt = key === "older" ? startOfDay(ev.at) : 0;
    const found = groups.find((g) => g.key === key && g.at === groupAt);
    if (found) found.items.push(ev);
    else groups.push({ key, at: groupAt, items: [ev] });
  }
  return groups;
}

function startOfDay(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export type NodeHealth = {
  id: string;
  /** Сколько процентов времени узел был в строю за окно. */
  pct: number;
  /** Сколько раз падал — по этому видно «моргающий» узел. */
  downs: number;
};

/**
 * Доступность узлов по истории: считаем, сколько времени узел был «не в строю».
 * Берём только узлы, у которых были переходы: у остальных и так 100%.
 */
export function availability(
  list: HistoryEvent[],
  now: number,
  windowMs = 7 * 86_400_000,
): NodeHealth[] {
  const from = now - windowMs;
  const byNode = new Map<string, HistoryEvent[]>();
  for (const ev of list) {
    if (ev.kind !== "nodeDown" && ev.kind !== "nodeUp") continue;
    if (!ev.a || ev.at < from) continue;
    const arr = byNode.get(ev.a) ?? [];
    arr.push(ev);
    byNode.set(ev.a, arr);
  }
  const out: NodeHealth[] = [];
  for (const [id, events] of byNode) {
    // старые сверху: так удобнее идти по времени вперёд
    const sorted = [...events].sort((x, y) => x.at - y.at);
    let downMs = 0;
    let downSince: number | null = null;
    let downs = 0;
    const start = Math.max(from, sorted[0].at);
    for (const ev of sorted) {
      if (ev.kind === "nodeDown") {
        downs += 1;
        if (downSince === null) downSince = ev.at;
      } else if (downSince !== null) {
        downMs += Math.max(0, ev.at - downSince);
        downSince = null;
      }
    }
    if (downSince !== null) downMs += Math.max(0, now - downSince);
    const span = Math.max(60_000, now - start);
    const pct = Math.round(100 * (1 - Math.min(1, downMs / span)));
    out.push({ id, pct: Math.max(0, Math.min(100, pct)), downs });
  }
  return out.sort((x, y) => x.pct - y.pct);
}

/** Ключ подписи для i18n: вид события → текст. */
export function labelKey(kind: HistoryKind): string {
  switch (kind) {
    case "connect":
      return "histConnect";
    case "disconnect":
      return "histDisconnect";
    case "switch":
      return "histSwitch";
    case "fail":
      return "histFail";
    case "nodeDown":
      return "histNodeDown";
    case "nodeUp":
      return "histNodeUp";
  }
}

/**
 * Склонение для «1 сбой / 2 сбоя / 5 сбоев».
 * Русские правила (1, 2–4, 5+) не совпадают с английскими (1 / остальное),
 * поэтому язык передаём явно, а не надеемся на общий счётчик.
 */
export function plural(n: number, lang: "ru" | "en"): "one" | "few" | "many" {
  const abs = Math.abs(n) % 100;
  if (lang === "en") return n === 1 ? "one" : "many";
  if (abs >= 11 && abs <= 14) return "many";
  const last = abs % 10;
  if (last === 1) return "one";
  if (last >= 2 && last <= 4) return "few";
  return "many";
}

/** Время в формате 21:40 — секунды в истории не нужны. */
export function clock(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
