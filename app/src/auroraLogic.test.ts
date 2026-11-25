import { describe, expect, it } from "vitest";
import { auroraIntensity, auroraTint } from "./auroraLogic";

describe("аврора", () => {
  it("на холостом — фиолетовый, на связи — зелёный", () => {
    expect(auroraTint("idle").from).toBe(250);
    expect(auroraTint("connected").from).toBe(96);
  });

  it("обрыв красный, и переход через ноль не ломает оттенок", () => {
    expect(auroraTint("error")).toEqual({ from: 340, to: 8 });
    expect(auroraTint("error").to).toBeLessThan(auroraTint("error").from);
  });

  it("связь ярче ожидания, обрыв — тише связи", () => {
    expect(auroraIntensity("connected", 0, 0)).toBeGreaterThan(auroraIntensity("idle", 0, 0));
    expect(auroraIntensity("error", 0, 0)).toBeLessThan(auroraIntensity("connected", 0, 0));
  });

  it("трафик добавляет яркости, но не больше единицы", () => {
    const quiet = auroraIntensity("connected", 0, 0);
    expect(auroraIntensity("connected", 400_000, 90_000)).toBeGreaterThan(quiet);
    // Потолок в 0.4 добавки: даже на гигабите фон не выжигает глаза.
    expect(auroraIntensity("connected", 10 ** 12, 10 ** 12)).toBeLessThanOrEqual(1);
    expect(auroraIntensity("connected", 10 ** 12, 10 ** 12)).toBeGreaterThan(0.8);
  });

  it("отрицательный трафик не гасит фон ниже базы", () => {
    expect(auroraIntensity("connected", -5, -5)).toBe(auroraIntensity("connected", 0, 0));
  });
});
