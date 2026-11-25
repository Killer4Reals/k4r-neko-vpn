import { describe, expect, it } from "vitest";
import { ringDash, ringLength, ringPct } from "./ringMath";

describe("кольца статистики", () => {
  it("доля ограничена 0..1 и не делит на ноль", () => {
    expect(ringPct(5, 0)).toBe(0);
    expect(ringPct(-2, 10)).toBe(0);
    expect(ringPct(20, 10)).toBe(1);
    expect(ringPct(2.5, 10)).toBe(0.25);
  });

  it("пустая доля — штрих не виден, полная — виден весь", () => {
    const c = ringLength(26);
    expect(ringDash(0, c)).toBeCloseTo(c, 6);
    expect(ringDash(1, c)).toBeCloseTo(0, 6);
  });

  it("половина круга — половина длины", () => {
    const c = ringLength(10);
    expect(ringDash(0.5, c)).toBeCloseTo(c / 2, 6);
  });
});
