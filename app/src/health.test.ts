import { describe, expect, it } from "vitest";
import {
  FRESH_MS,
  SLOW_MARGIN_MS,
  aliveCount,
  isFresh,
  lastAliveAt,
  nodeTone,
  poolDead,
  slowSwitchTarget,
} from "./health";

describe("свежесть замера", () => {
  it("свежий — пока не прошло 12 минут", () => {
    const now = 1_000_000;
    expect(isFresh(now - 60_000, now)).toBe(true);
    expect(isFresh(now - (FRESH_MS - 1), now)).toBe(true);
  });

  it("старый — после 12 минут и когда метки нет", () => {
    const now = 1_000_000;
    expect(isFresh(now - FRESH_MS, now)).toBe(false);
    expect(isFresh(undefined, now)).toBe(false);
  });
});

describe("цвет точки узла", () => {
  it("не ответил — красный, даже если замер свежий", () => {
    expect(nodeTone(null, false)).toBe("dead");
    expect(nodeTone(null, true)).toBe("dead");
  });

  it("старый замер перебивает скорость", () => {
    expect(nodeTone(20, true)).toBe("stale");
  });

  it("скорость делится на три ступени", () => {
    expect(nodeTone(38, false)).toBe("fast");
    expect(nodeTone(150, false)).toBe("ok");
    expect(nodeTone(320, false)).toBe("slow");
  });
});

describe("уход с просевшего узла", () => {
  const measured = { a: 120, b: 70, c: 400, d: null };

  it("уходит на лучший, если разница больше порога", () => {
    expect(slowSwitchTarget("a", measured)).toBe("b");
  });

  it("на границе порога не дёргает туннель", () => {
    const atEdge = { a: 110, b: 110 - SLOW_MARGIN_MS };
    expect(slowSwitchTarget("a", atEdge)).toBeNull();
  });

  it("чуть-чуть лучше — не повод переключаться", () => {
    expect(slowSwitchTarget("a", { a: 100, b: 95 })).toBeNull();
  });

  it("мы уже на лучшем — остаёмся", () => {
    expect(slowSwitchTarget("b", measured)).toBeNull();
  });

  it("текущий не ответил — решение не наше, молчим", () => {
    expect(slowSwitchTarget("d", measured)).toBeNull();
  });

  it("один живой сервер — переключаться некуда", () => {
    expect(slowSwitchTarget("a", { a: 900, b: null })).toBeNull();
  });
});

describe("счётчик живых", () => {
  it("считает только измерённые узлы", () => {
    const r = aliveCount(["a", "b", "c", "d"], { a: 40, b: null, c: 120 });
    expect(r.alive).toBe(2);
    expect(r.total).toBe(3);
  });

  it("неизмеренные не выглядят мёртвыми", () => {
    expect(aliveCount(["x"], {})).toEqual({ alive: 0, total: 0 });
  });
});
describe("весь пул молчит", () => {
  const now = 2_000_000;
  const fresh = { a: now - 1_000, b: now - 1_000, c: now - 1_000 };
  const dead = { a: null, b: null, c: null };

  it("все измерены, свежо, никто не ответил — диагноз есть", () => {
    expect(poolDead(["a", "b", "c"], dead, fresh, now)).toEqual({ dead: 3, total: 3 });
  });

  it("хоть один живой — это не «все мертвы»", () => {
    expect(poolDead(["a", "b", "c"], { ...dead, b: 90 }, fresh, now)).toBeNull();
  });

  it("старый замер — не повод объявлять провайдера мёртвым", () => {
    const old = { a: now - FRESH_MS - 1, b: now, c: now };
    expect(poolDead(["a", "b", "c"], dead, old, now)).toBeNull();
  });

  it("не всех померили — молчим, а не пугаем", () => {
    expect(poolDead(["a", "b", "c"], { a: null, b: null }, fresh, now)).toBeNull();
    expect(poolDead(["x"], {}, {}, now)).toBeNull();
  });

  it("пустой список — не диагноз", () => {
    expect(poolDead([], dead, fresh, now)).toBeNull();
  });
});

describe("последний живой ответ", () => {
  it("берёт самый свежий из ответивших", () => {
    expect(
      lastAliveAt({ a: 40, b: 80, c: null }, { a: 1000, b: 2000, c: 3000 }),
    ).toBe(2000);
  });

  it("все молчат — нуля хватает", () => {
    expect(lastAliveAt({ a: null }, { a: 5000 })).toBe(0);
  });
});
