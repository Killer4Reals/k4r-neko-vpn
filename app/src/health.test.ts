import { describe, expect, it } from "vitest";
import { FRESH_MS, SLOW_MARGIN_MS, isFresh, nodeTone, slowSwitchTarget } from "./health";

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
