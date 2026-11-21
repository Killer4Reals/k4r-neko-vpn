import { describe, expect, it } from "vitest";
import {
  activeScenario,
  changedKeys,
  matches,
  SCENARIOS,
  scenarioById,
  type ScenarioSettings,
} from "./scenarios";

/** Ровно настройки игрового сценария: от них и пляшем. */
const base: ScenarioSettings = {
  autoSwitchSlow: false,
  blockIpv6: true,
  dnsMode: "tunnel",
  gameMode: true,
  splitMode: "all",
};

describe("сценарии", () => {
  it("их ровно три и id не повторяются", () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(["game", "stream", "work"]);
    expect(new Set(SCENARIOS.map((s) => s.titleKey)).size).toBe(3);
  });

  it("у каждого есть название и объяснение", () => {
    for (const s of SCENARIOS) {
      expect(s.titleKey).toMatch(/^sc/);
      expect(s.hintKey).toMatch(/^sc/);
    }
  });

  it("игровой сценарий не переключает узел посреди матча", () => {
    expect(scenarioById("game")!.settings.autoSwitchSlow).toBe(false);
    expect(scenarioById("game")!.settings.gameMode).toBe(true);
  });

  it("стрим переключается сам: залипший узел хуже смены", () => {
    expect(scenarioById("stream")!.settings.autoSwitchSlow).toBe(true);
  });

  it("работа — только выбранные программы, остальное напрямую", () => {
    expect(scenarioById("work")!.settings.splitMode).toBe("only");
  });

  it("неизвестный id не ломает экран", () => {
    expect(scenarioById("нет такого")).toBeUndefined();
  });

  it("совпадение настроек определяется точно", () => {
    const game = scenarioById("game")!;
    expect(matches(game, base)).toBe(true);
    expect(matches(game, { ...base, gameMode: false })).toBe(false);
  });

  it("активный сценарий виден по настройкам", () => {
    expect(activeScenario(base)).toBe("game");
    expect(activeScenario({ ...base, autoSwitchSlow: true, gameMode: false })).toBe("stream");
    expect(
      activeScenario({ ...base, autoSwitchSlow: true, splitMode: "only", gameMode: false }),
    ).toBe("work");
  });

  it("смешанные руками настройки не выдают себя за сценарий", () => {
    expect(activeScenario({ ...base, blockIpv6: false })).toBeNull();
  });

  it("видно, что именно поменялось", () => {
    const stream = scenarioById("stream")!.settings;
    expect(changedKeys(base, stream).sort()).toEqual(["autoSwitchSlow", "gameMode"]);
    expect(changedKeys(base, base)).toEqual([]);
  });
});
