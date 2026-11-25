import { describe, expect, it } from "vitest";
import { cleanApps, cleanName, MAX_PRESETS, removePreset, sameApps, savePreset } from "./presets";
import type { ChosenApp, SplitPreset } from "./api";

const app = (exe: string, via = true, name = exe): ChosenApp => ({ exe, name, via });
const preset = (id: string, name: string, apps: ChosenApp[]): SplitPreset => ({ id, name, apps });

describe("cleanName", () => {
  it("убирает лишние пробелы и обрезает до 32 символов", () => {
    expect(cleanName("  Работа   из   дома ")).toBe("Работа из дома");
    expect(cleanName("x".repeat(50))).toHaveLength(32);
    expect(cleanName("   ")).toBe("");
  });
});

describe("cleanApps", () => {
  it("приводит exe к нижнему регистру и убирает повторы", () => {
    const out = cleanApps([app("Discord.EXE", true, "Discord"), app("discord.exe", false)]);
    expect(out).toEqual([{ exe: "discord.exe", name: "Discord", via: false }]);
  });

  it("выбрасывает пустые имена файлов и даёт имя по умолчанию", () => {
    expect(cleanApps([app(" "), app("steam.exe", true, "  ")])).toEqual([
      { exe: "steam.exe", name: "steam.exe", via: true },
    ]);
  });
});

describe("sameApps", () => {
  it("сравнивает маршрут, а не порядок", () => {
    expect(sameApps([app("a.exe", true), app("b.exe", false)], [app("b.exe", false), app("a.exe", true)])).toBe(true);
    expect(sameApps([app("a.exe", true)], [app("a.exe", false)])).toBe(false);
    expect(sameApps([app("a.exe")], [])).toBe(false);
  });
});

describe("savePreset", () => {
  it("создаёт пресет с обрезанным именем и чистыми программами", () => {
    const { list, error } = savePreset([], "  Игры  ", [app("Steam.exe", true, "Steam")]);
    expect(error).toBeUndefined();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Игры");
    expect(list[0].apps[0].exe).toBe("steam.exe");
  });

  it("отказывает без имени, без программ и при повторе имени", () => {
    expect(savePreset([], "  ", [app("a.exe")]).error).toBe("emptyName");
    expect(savePreset([], "Игры", []).error).toBe("emptyApps");
    const base = [preset("one", "Игры", [app("a.exe")])];
    expect(savePreset(base, "игры", [app("b.exe")]).error).toBe("duplicate");
  });

  it("обновляет пресет по id, сохраняя ключ", () => {
    const base = [preset("one", "Игры", [app("a.exe")])];
    const { list } = savePreset(base, "Игры", [app("b.exe", false)], "one");
    expect(list[0].id).toBe("one");
    expect(list[0].apps[0].exe).toBe("b.exe");
    expect(list[0].apps[0].via).toBe(false);
  });

  it("не даёт сохранить больше двадцати", () => {
    const many = Array.from({ length: MAX_PRESETS }, (_, i) => preset(String(i), "P" + i, [app("a.exe")]));
    expect(savePreset(many, "лишний", [app("a.exe")]).error).toBe("limit");
  });
});

describe("removePreset", () => {
  it("удаляет только свой ключ", () => {
    const list = [preset("a", "A", [app("1.exe")]), preset("b", "B", [app("2.exe")])];
    expect(removePreset(list, "a").map((p) => p.id)).toEqual(["b"]);
    expect(removePreset(list, "zzz")).toHaveLength(2);
  });
});
