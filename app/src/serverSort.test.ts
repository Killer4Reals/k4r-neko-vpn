import { describe, expect, it } from "vitest";
import type { Server } from "./data";
import { sortServers } from "./serverSort";

const srv = (id: string, city: string, country: string, lat: number): Server => ({
  id,
  cc: "de",
  flag: "de",
  city,
  country,
  tag: "VLESS",
  lat,
});

const list = [
  srv("a", "Франкфурт", "Германия", 84),
  srv("b", "Амстердам", "Нидерланды", 51),
  srv("c", "Польша", "Польша", 0),
  srv("d", "Берлин", "Германия", 51),
];

describe("сортировка узлов", () => {
  it("избранные всегда сверху, даже с плохим пингом", () => {
    const out = sortServers(list, "ping", ["a"]);
    expect(out[0].id).toBe("a");
    expect(out.slice(1).map((s) => s.id)).toEqual(["b", "d", "c"]);
  });

  it("по пингу: меньше — выше, без замера — в конце", () => {
    const out = sortServers(list, "ping", []);
    expect(out.map((s) => s.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("по названию и по стране", () => {
    expect(sortServers(list, "name", []).map((s) => s.city)).toEqual([
      "Амстердам",
      "Берлин",
      "Польша",
      "Франкфурт",
    ]);
    expect(sortServers(list, "country", []).map((s) => s.id)).toEqual(["d", "a", "b", "c"]);
  });

  it("не меняет исходный список", () => {
    const before = list.map((s) => s.id);
    sortServers(list, "name", ["c"]);
    expect(list.map((s) => s.id)).toEqual(before);
  });
});
