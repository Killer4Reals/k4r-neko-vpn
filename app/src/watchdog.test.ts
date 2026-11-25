import { describe, expect, it } from "vitest";
import { FAILS_TO_RESTART, MAX_ATTEMPTS, WATCHDOG_START, watchdogStep } from "./watchdog";

const step = (state = WATCHDOG_START, probeOk = false, coreAlive = true) =>
  watchdogStep({ connected: true, coreAlive, probeOk, state });

describe("сторож туннеля", () => {
  it("одна неудача — ещё не повод рвать связь", () => {
    const first = step();
    expect(first.action).toBe("wait");
    expect(first.state.fails).toBe(1);
  });

  it("две неудачи подряд — перезапуск на другом узле", () => {
    const second = step(step().state);
    expect(second.action).toBe("restart");
    expect(second.state).toEqual({ fails: 0, attempts: 1 });
  });

  it("успех обнуляет и счётчик, и бюджет попыток", () => {
    const afterRestart = step(step().state).state;
    expect(step(afterRestart, true).state).toEqual(WATCHDOG_START);
  });

  it("мёртвое ядро не ждёт второй пробы", () => {
    expect(step(WATCHDOG_START, false, false).action).toBe("restart");
  });

  it("после трёх перезапусков — честное «не могу»", () => {
    const last = step({ fails: 1, attempts: MAX_ATTEMPTS });
    expect(last.action).toBe("giveup");
    // бюджет остаётся исчерпанным, пока связь не оживёт по-настоящему
    expect(last.state.attempts).toBe(MAX_ATTEMPTS);
    expect(step(last.state, true).state).toEqual(WATCHDOG_START);
  });

  it("выключенный туннель сбрасывает сторожа", () => {
    const dirty = { fails: 1, attempts: 2 };
    expect(
      watchdogStep({ connected: false, coreAlive: false, probeOk: false, state: dirty }),
    ).toEqual({ state: WATCHDOG_START, action: "wait" });
  });

  it("последняя разрешённая попытка ещё даётся", () => {
    expect(step({ fails: FAILS_TO_RESTART - 1, attempts: MAX_ATTEMPTS - 1 }).action).toBe("restart");
  });
});
