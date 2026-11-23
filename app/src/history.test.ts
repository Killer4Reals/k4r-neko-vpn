import { describe, expect, it } from "vitest";
import {
  availability,
  clock,
  dayKey,
  groupByDay,
  HISTORY_CAP,
  labelKey,
  parseEvents,
  plural,
  pushEvent,
  serializeEvents,
  toCsv,
  type HistoryEvent,
} from "./history";

const T = 1_700_000_000_000; // произвольный «сейчас»
const MIN = 60_000;

const ev = (at: number, kind: HistoryEvent["kind"], a?: string, b?: string): HistoryEvent => ({
  at,
  kind,
  a,
  b,
});

describe("pushEvent", () => {
  it("новые сверху", () => {
    const list = pushEvent([], ev(T, "connect", "de"));
    const out = pushEvent(list, ev(T + MIN, "disconnect"));
    expect(out.map((e) => e.kind)).toEqual(["disconnect", "connect"]);
  });

  it("дребезг схлопывается: то же событие через 20 секунд не пишем", () => {
    const list = pushEvent([], ev(T, "connect", "de"));
    const out = pushEvent(list, ev(T + 20_000, "connect", "de"));
    expect(out).toHaveLength(1);
  });

  it("но то же событие через час — уже новое", () => {
    const list = pushEvent([], ev(T, "connect", "de"));
    const out = pushEvent(list, ev(T + 3_600_000, "connect", "de"));
    expect(out).toHaveLength(2);
  });

  it("разные узлы не схлопываются", () => {
    const list = pushEvent([], ev(T, "connect", "de"));
    const out = pushEvent(list, ev(T + 1000, "connect", "nl"));
    expect(out).toHaveLength(2);
  });

  it("длина ограничена, старые выпадают", () => {
    let list: HistoryEvent[] = [];
    for (let i = 0; i < HISTORY_CAP + 20; i += 1) {
      list = pushEvent(list, ev(T + i * 1000, "fail", undefined, `e${i}`));
    }
    expect(list).toHaveLength(HISTORY_CAP);
    expect(list[0].b).toBe(`e${HISTORY_CAP + 19}`);
  });
});

describe("parseEvents / serializeEvents", () => {
  it("переживает круг через JSON", () => {
    const list = [ev(T, "switch", "de", "nl"), ev(T - MIN, "connect", "de")];
    expect(parseEvents(serializeEvents(list))).toEqual(list);
  });

  it("битый JSON — пустая история, а не падение", () => {
    expect(parseEvents("{не json")).toEqual([]);
    expect(parseEvents(null)).toEqual([]);
    expect(parseEvents('{"a":1}')).toEqual([]);
  });

  it("мусор в элементах пропускаем, годные оставляем", () => {
    const raw = JSON.stringify([
      { at: T, kind: "connect", a: "de" },
      { at: "нет", kind: "connect" },
      { at: T - 1, kind: "что-то" },
      null,
      { at: T - 2, kind: "fail", b: "нет сети" },
    ]);
    const out = parseEvents(raw);
    expect(out).toHaveLength(2);
    expect(out[0].kind).toBe("connect");
    expect(out[1].b).toBe("нет сети");
  });

  it("порядок восстанавливаем даже если в файле он сбит", () => {
    const raw = JSON.stringify([{ at: T - 1000, kind: "connect" }, { at: T, kind: "fail" }]);
    expect(parseEvents(raw)[0].kind).toBe("fail");
  });
});

describe("dayKey / groupByDay", () => {
  const noon = new Date(2026, 10, 21, 12, 0, 0).getTime();

  it("сегодня / вчера / раньше", () => {
    expect(dayKey(noon - 3600_000, noon)).toBe("today");
    expect(dayKey(noon - 13 * 3600_000, noon)).toBe("yesterday");
    expect(dayKey(noon - 60 * 3600_000, noon)).toBe("older");
  });

  it("вчера считается от полуночи, а не «24 часа назад»", () => {
    const justAfterMidnight = new Date(2026, 10, 21, 0, 10, 0).getTime();
    expect(dayKey(new Date(2026, 10, 20, 23, 59, 0).getTime(), justAfterMidnight)).toBe("yesterday");
  });

  it("группы идут в порядке событий, старые даты — отдельными группами", () => {
    const list = [
      ev(noon, "connect", "de"),
      ev(noon - 30 * 3600_000, "disconnect"), // вчера, после полуночи
      ev(noon - 60 * 3600_000, "connect", "nl"), // позавчера
      ev(noon - 96 * 3600_000, "fail"), // ещё двумя днями раньше
    ];
    const groups = groupByDay(list, noon);
    expect(groups.map((g) => g.key)).toEqual(["today", "yesterday", "older", "older"]);
    expect(groups.map((g) => g.items.length)).toEqual([1, 1, 1, 1]);
    // два «older» — это две разные даты, а не одна свалка
    expect(groups[2].at).not.toBe(groups[3].at);
  });
});

describe("availability", () => {
  it("без переходов узел в списке не появляется", () => {
    expect(availability([ev(T, "connect", "de")], T)).toEqual([]);
  });

  it("узел упал час назад и до сих пор лежит — доступность падает", () => {
    const now = T + 86_400_000; // окно недели
    const list = [ev(now - 3_600_000, "nodeDown", "nl")];
    const [row] = availability(list, now);
    expect(row.id).toBe("nl");
    expect(row.downs).toBe(1);
    expect(row.pct).toBeLessThan(100);
  });

  it("узел упал и поднялся через 10 минут — почти 100%", () => {
    const now = T;
    const list = [ev(now - 14_400_000, "nodeDown", "nl"), ev(now - 13_800_000, "nodeUp", "nl")];
    const [row] = availability(list, now, 7 * 86_400_000);
    expect(row.downs).toBe(1);
    expect(row.pct).toBeGreaterThan(95);
    expect(row.pct).toBeLessThanOrEqual(100);
  });

  it("худший узел сверху", () => {
    const now = T;
    const list = [
      ev(now - 6 * 86_400_000, "nodeDown", "good"),
      ev(now - 6 * 86_400_000 + 60_000, "nodeUp", "good"),
      ev(now - 86_400_000, "nodeDown", "bad"),
    ];
    const rows = availability(list, now);
    expect(rows[0].id).toBe("bad");
    expect(rows[0].pct).toBeLessThan(rows[1].pct);
  });

  it("события вне окна недели не учитываются", () => {
    const now = T;
    const list = [ev(now - 10 * 86_400_000, "nodeDown", "old")];
    expect(availability(list, now)).toEqual([]);
  });
});

describe("прочее", () => {
  it("у каждого вида события есть подпись", () => {
    const kinds: HistoryEvent["kind"][] = [
      "connect",
      "disconnect",
      "switch",
      "fail",
      "nodeDown",
      "nodeUp",
    ];
    for (const k of kinds) expect(labelKey(k)).toMatch(/^hist/);
  });

  it("склонение: 1 сбой, 2 сбоя, 5 сбоев", () => {
    expect([1, 21, 101].map((n) => plural(n, "ru"))).toEqual(["one", "one", "one"]);
    expect([2, 3, 4, 22].map((n) => plural(n, "ru"))).toEqual(["few", "few", "few", "few"]);
    expect([0, 5, 11, 12, 14, 25].map((n) => plural(n, "ru"))).toEqual([
      "many",
      "many",
      "many",
      "many",
      "many",
      "many",
    ]);
    // по-английски форм две
    expect([1, 2, 0].map((n) => plural(n, "en"))).toEqual(["one", "many", "many"]);
  });

  it("время в часах и минутах", () => {
    const at = new Date(2026, 10, 21, 9, 5, 0).getTime();
    expect(clock(at)).toBe("09:05");
  });
});

describe("toCsv", () => {
  const name = (id: string) => (id === "de" ? "Франкфурт" : id);

  it("первая строка — заголовки с BOM, разделитель «;»", () => {
    const csv = toCsv([], name, "ru");
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.split("\r\n")[0]).toContain("Время");
  });

  it("строка на событие, свежие сверху, узел назван по имени", () => {
    const csv = toCsv([ev(T, "connect", "de"), ev(T + MIN, "switch", "de", "nl")], name, "ru");
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("Переключение");
    expect(lines[2]).toContain("Франкфурт");
  });

  it("кавычки внутри значений не ломают таблицу", () => {
    const csv = toCsv([ev(T, "fail", undefined, 'нет "сети"')], name, "ru");
    expect(csv).toContain('""сети""');
  });
});
