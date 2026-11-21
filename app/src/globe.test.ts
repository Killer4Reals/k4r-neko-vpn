import { describe, expect, it } from "vitest";
import { countryOf, isLand, landDots, project, rotationFor, shortestDelta, nearestWithin } from "./globe";

describe("landmask", () => {
  it("has a meaningful amount of land, but not all of it", () => {
    const dots = landDots();
    expect(dots.length).toBeGreaterThan(800);
    const total = 180 * 90;
    expect(dots.length).toBeLessThan(total * 0.5);
  });

  it("knows where Europe, Africa and Australia are", () => {
    // Германия, Египет, Австралия — точки суши
    const de = countryOf("DE")!;
    const eg = countryOf("EG")!;
    const au = countryOf("AU")!;
    expect(de && eg && au).toBeTruthy();
    // проверяем саму маску через точки: ближайшая точка суши недалеко
    const dots = landDots();
    const near = (lat: number, lon: number) =>
      dots.some((d) => Math.abs(d.lat - lat) < 6 && Math.abs(d.lon - lon) < 8);
    expect(near(de.lat, de.lon)).toBe(true);
    expect(near(eg.lat, eg.lon)).toBe(true);
    expect(near(au.lat, au.lon)).toBe(true);
  });

  it("does not paint the middle of the Pacific", () => {
    expect(isLand(90, 45)).toBe(false);
  });
});

describe("projection", () => {
  it("puts the target country in front after rotating to it", () => {
    const tokyo = countryOf("JP")!;
    const p = project(tokyo, rotationFor(tokyo), 0);
    expect(p.z).toBeGreaterThan(0.75);
    expect(Math.abs(p.x)).toBeLessThan(0.2);
  });

  it("hides the opposite side of the planet", () => {
    const tokyo = countryOf("JP")!;
    const p = project(tokyo, rotationFor(tokyo) + 180, 0);
    expect(p.z).toBeLessThan(0);
  });

  it("rotates the short way around", () => {
    expect(shortestDelta(350, 10)).toBe(20);
    expect(shortestDelta(10, 350)).toBe(-20);
    expect(shortestDelta(0, 90)).toBe(90);
  });

  it("returns null for unknown countries", () => {
    expect(countryOf("ZZ")).toBeNull();
    expect(countryOf(undefined)).toBeNull();
  });
});

describe("центрирование страны", () => {
  // Страны из реальной подписки (DE, NL, NO, EE, SE, TR, KZ, JP, US, RU):
  // после доворота метка обязана стоять ровно в центре диска.
  const codes = ["DE", "NL", "NO", "EE", "SE", "TR", "KZ", "JP", "US", "RU", "BR", "AU", "ZA", "SG"];

  it("каждая страна после доворота попадает в центр", () => {
    for (const cc of codes) {
      const c = countryOf(cc);
      expect(c, cc).toBeTruthy();
      if (!c) continue;
      const tilt = Math.max(-68, Math.min(68, c.lat));
      const p = project(c, rotationFor(c), tilt);
      expect(Math.abs(p.x), cc).toBeLessThan(1e-9);
      expect(Math.abs(p.y), cc).toBeLessThan(1e-9);
      expect(p.z, cc).toBeGreaterThan(0.9);
    }
  });

  it("страна видна, то есть на передней стороне шара", () => {
    for (const cc of codes) {
      const c = countryOf(cc)!;
      const p = project(c, rotationFor(c), c.lat);
      expect(p.z, cc).toBeGreaterThan(0);
    }
  });
});

describe("попадание в точку узла", () => {
  const pts = [
    { id: "a", x: 10, y: 10 },
    { id: "b", x: 60, y: 60 },
  ];

  it("берёт ближайшую точку в радиусе", () => {
    expect(nearestWithin(pts, 14, 12)?.id).toBe("a");
    expect(nearestWithin(pts, 58, 63)?.id).toBe("b");
  });

  it("дальше радиуса — мимо", () => {
    expect(nearestWithin(pts, 40, 40)).toBeNull();
  });

  it("ровно на границе радиуса ещё считается", () => {
    expect(nearestWithin(pts, 10 + 12, 10)?.id).toBe("a");
  });

  it("из двух близких побеждает ближняя", () => {
    const two = [
      { id: "far", x: 20, y: 0 },
      { id: "near", x: 4, y: 0 },
    ];
    expect(nearestWithin(two, 0, 0)?.id).toBe("near");
  });
});
