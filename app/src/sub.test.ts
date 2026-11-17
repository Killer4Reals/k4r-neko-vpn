import { describe, expect, it } from "vitest";
import { humanBytes, leftBytes, subTiming } from "./sub";

const NOW = Date.UTC(2026, 10, 17, 12, 0, 0); // 17.11.2026 12:00 UTC
const sec = (ms: number) => Math.floor(ms / 1000);

describe("subTiming", () => {
  it("без срока ничего не обещает", () => {
    expect(subTiming(0, NOW)).toEqual({ days: 0, state: "none" });
    expect(subTiming(-5, NOW)).toEqual({ days: 0, state: "none" });
  });

  it("срок в прошлом — истекла", () => {
    expect(subTiming(sec(NOW - 86_400_000), NOW).state).toBe("expired");
  });

  it("три дня и меньше — предупреждение", () => {
    expect(subTiming(sec(NOW + 3 * 86_400_000), NOW)).toEqual({ days: 3, state: "soon" });
    expect(subTiming(sec(NOW + 86_400_000), NOW).state).toBe("soon");
    // сегодняшний срок — ещё не истёк, но это уже «soon»
    expect(subTiming(sec(NOW + 3_600_000), NOW)).toEqual({ days: 0, state: "soon" });
  });

  it("четыре дня и больше — спокойно", () => {
    const r = subTiming(sec(NOW + 4 * 86_400_000), NOW);
    expect(r.state).toBe("ok");
    expect(r.days).toBe(4);
  });

  it("миллисекунды отдельно от секунд не путаются", () => {
    // провайдер, отдавший срок в миллисекундах, не должен показать «истекла»
    expect(subTiming(NOW + 10 * 86_400_000, NOW).days).toBe(10);
  });
});

describe("leftBytes", () => {
  it("считает остаток из лимита и потраченного", () => {
    expect(leftBytes(100, 30, 20)).toBe(50);
  });

  it("без лимита остаток неизвестен, а не «ноль гигабайт»", () => {
    expect(leftBytes(0, 30, 20)).toBe(0);
  });

  it("потратил больше лимита — остаток не отрицательный", () => {
    expect(leftBytes(100, 90, 40)).toBe(0);
  });
});

describe("humanBytes", () => {
  it("гигабайты: дробь только там, где она что-то значит", () => {
    expect(humanBytes(5.24 * 1024 ** 3)).toBe("5.2 ГБ");
    expect(humanBytes(12.34 * 1024 ** 3)).toBe("12 ГБ");
    expect(humanBytes(120 * 1024 ** 3)).toBe("120 ГБ");
  });

  it("мегабайты, когда гигабайт ещё нет", () => {
    expect(humanBytes(512 * 1024 ** 2)).toBe("512 МБ");
    expect(humanBytes(0)).toBe("0");
  });
});
