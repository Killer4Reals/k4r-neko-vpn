import { describe, expect, it } from "vitest";
import { COUNTRY, COUNTRY_CODES, countryOf } from "./countries";
import { project } from "./globe";

describe("координаты стран", () => {
  it("таблица покрывает все страны и территории", () => {
    expect(COUNTRY_CODES.length).toBeGreaterThanOrEqual(240);
    for (const code of ["ru", "de", "pl", "es", "fi", "gb", "jp", "br", "za", "kz", "xk"]) {
      expect(COUNTRY[code], code).toBeTruthy();
    }
  });

  it("коды и координаты в допустимых пределах", () => {
    for (const [code, at] of Object.entries(COUNTRY)) {
      expect(code, code).toMatch(/^[a-z]{2}$/);
      expect(at.lat, code).toBeGreaterThanOrEqual(-90);
      expect(at.lat, code).toBeLessThanOrEqual(90);
      expect(at.lon, code).toBeGreaterThanOrEqual(-180);
      expect(at.lon, code).toBeLessThanOrEqual(180);
      // точка на полюсе — это не страна: широта не должна быть ровно ±90
      expect(Math.abs(at.lat), code).toBeLessThan(90);
    }
  });

  it("ключевые страны на своих местах", () => {
    const near = (code: string, lat: number, lon: number, spread = 4) => {
      const at = countryOf(code)!;
      expect(Math.abs(at.lat - lat), code).toBeLessThanOrEqual(spread);
      expect(Math.abs(at.lon - lon), code).toBeLessThanOrEqual(spread);
    };
    near("ru", 55.7, 37.6);
    near("de", 52.5, 13.4);
    near("pl", 52.2, 21.0);
    near("es", 40.4, -3.7);
    near("fi", 60.2, 24.9);
    near("gb", 51.5, -0.1);
    near("jp", 35.7, 139.7);
    near("us", 38.9, -77.0);
  });

  it("код не зависит от регистра и пробелов", () => {
    expect(countryOf("PL")).toEqual(countryOf("pl"));
    expect(countryOf(" de ")).toEqual(countryOf("DE"));
    expect(countryOf("")).toBeNull();
    expect(countryOf("zz")).toBeNull();
    expect(countryOf(null)).toBeNull();
  });

  it("соседние страны не слипаются в одну точку на шаре", () => {
    const R = 160;
    const screen = (code: string) => {
      const p = project(countryOf(code)!, 21, -14);
      return { x: p.x * R, y: p.y * R, z: p.z };
    };
    const pl = screen("pl");
    const de = screen("de");
    const es = screen("es");
    expect(Math.hypot(pl.x - de.x, pl.y - de.y)).toBeGreaterThan(8);
    expect(Math.hypot(pl.x - es.x, pl.y - es.y)).toBeGreaterThan(25);
    for (const p of [pl, de, es]) expect(p.z).toBeGreaterThan(0);
  });
});
