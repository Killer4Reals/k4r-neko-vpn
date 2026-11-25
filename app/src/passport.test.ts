import { describe, expect, it } from "vitest";
import { grade, providerOf, score } from "./passport";

describe("паспорт выхода", () => {
  it("быстрый свежий узел — сотня, медленный — ниже", () => {
    expect(score(30, "good", true)).toBe(100);
    expect(score(400, "good", true)).toBeLessThan(score(90, "good", true));
  });

  it("старый замер штрафуется, но не обнуляет", () => {
    const fresh = score(60, "good", true);
    const stale = score(60, "good", false);
    expect(stale).toBe(fresh - 10);
    expect(stale).toBeGreaterThan(0);
  });

  it("нет замера — середина, а не ноль", () => {
    const s = score(null, "good", false);
    expect(s).toBeGreaterThan(40);
    expect(s).toBeLessThan(70);
  });

  it("плохой узел не выходит за границы 0..100", () => {
    expect(score(900, "bad", false)).toBeGreaterThanOrEqual(0);
    expect(score(900, "bad", false)).toBeLessThanOrEqual(100);
  });

  it("градация по порогам", () => {
    expect(grade(90)).toBe("A");
    expect(grade(75)).toBe("B");
    expect(grade(55)).toBe("C");
    expect(grade(20)).toBe("D");
  });

  it("провайдер — домен, а не имя узла", () => {
    expect(providerOf("fra12.somehost.net")).toBe("somehost.net");
    expect(providerOf("example.org")).toBe("example.org");
    expect(providerOf("203.0.113.9")).toBe("203.0.113.9");
    expect(providerOf("")).toBe("—");
  });
});
