import { describe, expect, it } from "vitest";
import { SPARK_CAP, pushSpark, sparkPoints, sparkTone } from "./spark";

describe("спарклайн задержки", () => {
  it("хранит последние замеры и вытесняет старые", () => {
    let s: Record<string, (number | null)[]> = {};
    for (let i = 0; i < SPARK_CAP + 3; i += 1) s = pushSpark(s, "a", i);
    expect(s.a).toHaveLength(SPARK_CAP);
    expect(s.a[SPARK_CAP - 1]).toBe(SPARK_CAP + 2);
  });

  it("не мутирует вход, чтобы React видел новый объект", () => {
    const before = { a: [10, 20] };
    const after = pushSpark(before, "a", 30);
    expect(before.a).toEqual([10, 20]);
    expect(after).not.toBe(before);
    expect(after.a).toEqual([10, 20, 30]);
  });

  it("медленный узел рисуется выше, быстрый — ниже", () => {
    const slow = sparkPoints([100, 400], 10, 10).split(" ");
    const fast = sparkPoints([400, 100], 10, 10).split(" ");
    expect(slow[1]).toBe("10.0,0.0");
    expect(fast[1]).toBe("10.0,10.0");
  });

  it("одна точка или одни обрывы — линии нет", () => {
    expect(sparkPoints([120], 10, 10)).toBe("");
    expect(sparkPoints([null, null], 10, 10)).toBe("");
  });

  it("обрыв пропускается, соседние точки остаются", () => {
    const pts = sparkPoints([100, null, 300], 20, 10);
    expect(pts.split(" ")).toHaveLength(2);
  });

  it("цвет по порогам: 40 зелёный, 200 жёлтый, 500 красный, обрыв серый", () => {
    expect(sparkTone(40)).toBe("ok");
    expect(sparkTone(200)).toBe("warn");
    expect(sparkTone(500)).toBe("bad");
    expect(sparkTone(null)).toBe("none");
  });
});
