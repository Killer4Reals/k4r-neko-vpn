import { describe, expect, it } from "vitest";
import { exitLabel, exitTone, metroCounts } from "./metroMath";

describe("схема маршрута", () => {
  it("считает только включённые правила по действиям", () => {
    const c = metroCounts([
      { action: "proxy", enabled: true },
      { action: "proxy", enabled: false },
      { action: "direct", enabled: true },
      { action: "block", enabled: true },
    ]);
    expect(c).toEqual({ proxy: 1, direct: 1, block: 1 });
  });

  it("пустой список — нули, а не ошибка", () => {
    expect(metroCounts([])).toEqual({ proxy: 0, direct: 0, block: 0 });
  });

  it("тон выхода: нет адреса — плохо, нет связи — ждёт", () => {
    expect(exitTone(false, "")).toBe("bad");
    expect(exitTone(false, "Tokyo")).toBe("idle");
    expect(exitTone(true, "Tokyo")).toBe("ok");
  });

  it("подпись выхода падает с города на страну", () => {
    expect(exitLabel("Tokyo", "Japan")).toBe("Tokyo");
    expect(exitLabel("", "Japan")).toBe("Japan");
    expect(exitLabel("", "")).toBe("—");
  });
});
