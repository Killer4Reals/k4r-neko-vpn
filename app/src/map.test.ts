import { describe, expect, it } from "vitest";
import { arcBetween, arcLength, arcPoint, arcsFrom, HOME, projectFlat } from "./map";

describe("плоская карта", () => {
  it("Москва правее Гринвича и выше экватора", () => {
    const m = projectFlat({ lat: 55.75, lon: 37.62 }, 1000, 500);
    const zero = projectFlat({ lat: 0, lon: 0 }, 1000, 500);
    expect(m.x).toBeGreaterThan(zero.x);
    expect(m.y).toBeLessThan(zero.y);
  });

  it("края карты совпадают с краями мира", () => {
    expect(projectFlat({ lat: 90, lon: -180 }, 360, 180)).toEqual({ x: 0, y: 0 });
    expect(projectFlat({ lat: -90, lon: 180 }, 360, 180)).toEqual({ x: 360, y: 180 });
  });

  it("дуга начинается и заканчивается в своих точках", () => {
    const arc = arcBetween(HOME, { lat: 50.1, lon: 8.7 }, 800, 400);
    expect(arcPoint(arc, 0)).toEqual(arc.from);
    const end = arcPoint(arc, 1);
    expect(end.x).toBeCloseTo(arc.to.x, 6);
    expect(end.y).toBeCloseTo(arc.to.y, 6);
  });

  it("середина дуги выше прямой", () => {
    const arc = arcBetween(HOME, { lat: 40.7, lon: -74 }, 800, 400);
    const mid = arcPoint(arc, 0.5);
    const lineMid = (arc.from.y + arc.to.y) / 2;
    expect(mid.y).toBeLessThan(lineMid);
  });

  it("длина дуги больше расстояния по прямой", () => {
    const arc = arcBetween(HOME, { lat: 35.7, lon: 139.7 }, 800, 400);
    const straight = Math.hypot(arc.to.x - arc.from.x, arc.to.y - arc.from.y);
    expect(arcLength(arc)).toBeGreaterThan(straight);
  });

  it("дуг ровно столько же, сколько точек", () => {
    const pts = [
      { lat: 50.1, lon: 8.7 },
      { lat: 40.7, lon: -74 },
      { lat: 35.7, lon: 139.7 },
    ];
    expect(arcsFrom(HOME, pts, 800, 400)).toHaveLength(3);
  });
});
