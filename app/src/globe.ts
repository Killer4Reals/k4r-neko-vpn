/**
 * Математика глобуса: суша из маски, проекция точки на шар, поворот к стране.
 * Всё чистое и без canvas — чтобы это можно было проверить тестами.
 */

import { LAND_H, LAND_W } from "./landmask";
import { LANDMASK_B64 } from "./landmask";

import { COUNTRY, countryOf, type LatLon } from "./countries";

export { COUNTRY, countryOf };
export type { LatLon };

const mask = (() => {
  const bytes = atob(LANDMASK_B64);
  const rowBytes = Math.ceil(LAND_W / 8);
  const out = new Uint8Array(LAND_W * LAND_H);
  for (let y = 0; y < LAND_H; y++) {
    for (let x = 0; x < LAND_W; x++) {
      const byte = bytes.charCodeAt(y * rowBytes + (x >> 3));
      out[y * LAND_W + x] = (byte >> (7 - (x & 7))) & 1;
    }
  }
  return out;
})();

export function isLand(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= LAND_W || y >= LAND_H) return false;
  return mask[y * LAND_W + x] === 1;
}

/** Сетка точек суши в градусах: шаг 2°, ровно то, что нарисовано в маске. */
export function landDots(step = 2): LatLon[] {
  const dots: LatLon[] = [];
  for (let y = 0; y < LAND_H; y++) {
    for (let x = 0; x < LAND_W; x++) {
      if (!isLand(x, y)) continue;
      const lat = 90 - (y + 0.5) * step;
      const lon = -180 + (x + 0.5) * step;
      dots.push({ lat, lon });
    }
  }
  return dots;
}

/** Проекция точки на шар. Возвращает экранные координаты и видимость. */
export function project(
  point: LatLon,
  rotY: number,
  tiltDeg: number,
): { x: number; y: number; z: number } {
  const lat = (point.lat * Math.PI) / 180;
  const lon = ((point.lon - rotY) * Math.PI) / 180;
  const tilt = (tiltDeg * Math.PI) / 180;
  // вращение вокруг вертикальной оси
  let x = Math.cos(lat) * Math.sin(lon);
  let y = Math.sin(lat);
  let z = Math.cos(lat) * Math.cos(lon);
  // наклон к зрителю
  const y2 = y * Math.cos(tilt) - z * Math.sin(tilt);
  const z2 = y * Math.sin(tilt) + z * Math.cos(tilt);
  y = y2;
  z = z2;
  return { x, y, z };
}

/** Куда нужно повернуть шар, чтобы страна оказалась в центре. */
export function rotationFor(target: LatLon): number {
  return target.lon;
}

/** Угол поворота с учётом кратчайшего пути (без «прокрутки» на 300°). */
export function shortestDelta(from: number, to: number): number {
  let delta = ((to - from) % 360 + 540) % 360 - 180;
  return delta;
}

/** Плавное замедление. */
export function easeOut(t: number): number {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
}

/**
 * Ближайшая точка на экране: по ней ловим наведение и нажатие. Радиус 12 px —
 * «почти попал»: прицеливаться в точку 3 px мышью невозможно.
 */
export function nearestWithin<T extends { x: number; y: number }>(
  points: T[],
  x: number,
  y: number,
  radius = 12,
): T | null {
  let best: T | null = null;
  let bestD = radius;
  for (const p of points) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}