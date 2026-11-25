import { describe, expect, it } from "vitest";
import { describePreset, filterPresets, presetCatalog } from "./zapretCatalog";

describe("describePreset", () => {
  it("убирает расширение и находит теги", () => {
    const p = describePreset("general ALT9 1.10.3 (game filter).txt");
    expect(p.title).toBe("general ALT9 1.10.3 (game filter)");
    expect(p.tags).toContain("games");
  });

  it("видео, discord и QUIC не путаются", () => {
    expect(describePreset("youtube split.txt").tags).toEqual(["video"]);
    expect(describePreset("discord fake.txt").tags).toEqual(["discord"]);
    expect(describePreset("QUIC disorder.txt").tags).toEqual(["quic"]);
  });

  it("методы обхода без повторов", () => {
    const p = describePreset("hostfakesplit split fake.txt");
    expect(p.methods).toContain("hostfakesplit");
    expect(p.methods).toContain("fake");
    expect(new Set(p.methods).size).toBe(p.methods.length);
  });

  it("неизвестное имя не падает", () => {
    expect(describePreset("custom.txt")).toEqual({
      file: "custom.txt",
      title: "custom",
      tags: [],
      methods: [],
    });
  });
});

describe("presetCatalog / filterPresets", () => {
  const list = presetCatalog(["game fake.txt", "discord split.txt", "readme.md"]);

  it("не txt в каталог не попадает", () => {
    expect(list.map((p) => p.file)).toEqual(["discord split.txt", "game fake.txt"]);
  });

  it("фильтр по тегу оставляет только совпадения", () => {
    expect(filterPresets(list, "games").map((p) => p.file)).toEqual(["game fake.txt"]);
    expect(filterPresets(list, "all")).toHaveLength(2);
    expect(filterPresets(list, "video")).toEqual([]);
  });
});
