/**
 * Математика глобуса: суша из маски, проекция точки на шар, поворот к стране.
 * Всё чистое и без canvas — чтобы это можно было проверить тестами.
 */

import { LAND_H, LAND_W } from "./landmask";
import { LANDMASK_B64 } from "./landmask";

/** Точка на шаре в градусах. */
export type LatLon = { lat: number; lon: number };

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

/** Координаты стран, между которыми переключается пользователь. */
export const COUNTRY: Record<string, LatLon> = {
  RU: { lat: 55.7, lon: 37.6 },
  DE: { lat: 50.1, lon: 8.7 },
  NL: { lat: 52.4, lon: 4.9 },
  FR: { lat: 48.9, lon: 2.4 },
  GB: { lat: 51.5, lon: -0.1 },
  US: { lat: 40.7, lon: -74 },
  CA: { lat: 43.7, lon: -79.4 },
  FI: { lat: 60.2, lon: 24.9 },
  SE: { lat: 59.3, lon: 18.1 },
  NO: { lat: 59.9, lon: 10.8 },
  DK: { lat: 55.7, lon: 12.6 },
  PL: { lat: 52.2, lon: 21 },
  CZ: { lat: 50.1, lon: 14.4 },
  AT: { lat: 48.2, lon: 16.4 },
  CH: { lat: 47.4, lon: 8.5 },
  IT: { lat: 45.5, lon: 9.2 },
  ES: { lat: 40.4, lon: -3.7 },
  PT: { lat: 38.7, lon: -9.1 },
  IE: { lat: 53.3, lon: -6.3 },
  BE: { lat: 50.8, lon: 4.4 },
  LU: { lat: 49.6, lon: 6.1 },
  EE: { lat: 59.4, lon: 24.8 },
  LV: { lat: 56.9, lon: 24.1 },
  LT: { lat: 54.7, lon: 25.3 },
  RO: { lat: 44.4, lon: 26.1 },
  BG: { lat: 42.7, lon: 23.3 },
  GR: { lat: 38, lon: 23.7 },
  HU: { lat: 47.5, lon: 19 },
  SK: { lat: 48.1, lon: 17.1 },
  SI: { lat: 46, lon: 14.5 },
  HR: { lat: 45.8, lon: 16 },
  RS: { lat: 44.8, lon: 20.5 },
  UA: { lat: 50.5, lon: 30.5 },
  BY: { lat: 53.9, lon: 27.6 },
  MD: { lat: 47, lon: 28.9 },
  GE: { lat: 41.7, lon: 44.8 },
  AM: { lat: 40.2, lon: 44.5 },
  KZ: { lat: 43.2, lon: 76.9 },
  TR: { lat: 39.9, lon: 32.9 },
  AE: { lat: 25.2, lon: 55.3 },
  IL: { lat: 32.1, lon: 34.8 },
  IN: { lat: 28.6, lon: 77.2 },
  SG: { lat: 1.3, lon: 103.8 },
  JP: { lat: 35.7, lon: 139.7 },
  KR: { lat: 37.6, lon: 127 },
  HK: { lat: 22.3, lon: 114.2 },
  TW: { lat: 25, lon: 121.5 },
  TH: { lat: 13.8, lon: 100.5 },
  VN: { lat: 21, lon: 105.8 },
  ID: { lat: -6.2, lon: 106.8 },
  MY: { lat: 3.1, lon: 101.7 },
  PH: { lat: 14.6, lon: 121 },
  AU: { lat: -33.9, lon: 151.2 },
  NZ: { lat: -36.8, lon: 174.8 },
  BR: { lat: -23.5, lon: -46.6 },
  AR: { lat: -34.6, lon: -58.4 },
  CL: { lat: -33.4, lon: -70.7 },
  MX: { lat: 19.4, lon: -99.1 },
  ZA: { lat: -26.2, lon: 28 },
  EG: { lat: 30, lon: 31.2 },
  NG: { lat: 6.5, lon: 3.4 },
  KE: { lat: -1.3, lon: 36.8 },
};

export function countryOf(code: string | undefined | null): LatLon | null {
  if (!code) return null;
  const hit = COUNTRY[code.toUpperCase()];
  return hit ?? null;
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
