import { describe, expect, it } from "vitest";
import { arcPath, turbineAngle, turbinePoint, turbineStats } from "./turbineMath";

describe("турбина скорости", () => {
  it("считает сейчас, среднюю и пик", () => {
    const t = turbineStats([10, 20, 30]);
    expect(t.now).toBe(30);
    expect(t.avg).toBe(20);
    expect(t.peak).toBe(30);
  });

  it("пустая история — нули и шкала от десяти", () => {
    expect(turbineStats([])).toEqual({ now: 0, avg: 0, peak: 0, cap: 10 });
  });

  it("отрицательные и NaN не ломают шкалу", () => {
    const t = turbineStats([-5, Number.NaN, 12]);
    expect(t.peak).toBe(12);
    expect(t.cap).toBeGreaterThanOrEqual(12);
  });

  it("стрелка в пределах 135..405 градусов", () => {
    expect(turbineAngle(0, 10)).toBe(135);
    expect(turbineAngle(10, 10)).toBe(405);
    expect(turbineAngle(99, 10)).toBe(405);
  });

  it("дуга от 135 до 405 рисуется большой дугой", () => {
    const d = arcPath(60, 60, 40, 135, 405);
    expect(d).toContain("A 40 40 0 1 1");
    expect(turbinePoint(135, 40).x).toBeCloseTo(31.72, 1);
  });
});
