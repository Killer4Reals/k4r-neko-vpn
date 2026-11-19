/**
 * Плоская карта для вкладки «Серверы»: равнопромежуточная проекция и дуги
 * от точки пользователя к серверам. Без canvas — считается тестами.
 */

import type { LatLon } from "./globe";

/** Где примерно пользователь. Точку можно не угадывать точно: это карта. */
export const HOME: LatLon = { lat: 55.75, lon: 37.62 };

export type XY = { x: number; y: number };

/** Долгота/широта → пиксели. y сверху, поэтому север вверху. */
export function projectFlat(p: LatLon, w: number, h: number): XY {
  return {
    x: ((p.lon + 180) / 360) * w,
    y: ((90 - p.lat) / 180) * h,
  };
}

export type Arc = {
  from: XY;
  to: XY;
  /** контрольная точка квадратичной кривой — над серединой */
  ctrl: XY;
};

/**
 * Дуга между двумя точками. Высота подъёма зависит от расстояния: близкие
 * города соединяем почти прямой, дальние — заметной дугой, иначе линии
 * сливаются с картой.
 */
export function arcBetween(from: LatLon, to: LatLon, w: number, h: number): Arc {
  const a = projectFlat(from, w, h);
  const b = projectFlat(to, w, h);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const lift = Math.min(0.45, dist / (w * 1.6));
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  // перпендикуляр к отрезку, направленный вверх
  const nx = -dy / (dist || 1);
  const ny = dx / (dist || 1);
  const sign = ny > 0 ? -1 : 1;
  return {
    from: a,
    to: b,
    ctrl: { x: mx + nx * dist * lift * sign, y: my + ny * dist * lift * sign },
  };
}

/** Точка на дуге: t от 0 до 1. */
export function arcPoint(arc: Arc, t: number): XY {
  const u = 1 - t;
  return {
    x: u * u * arc.from.x + 2 * u * t * arc.ctrl.x + t * t * arc.to.x,
    y: u * u * arc.from.y + 2 * u * t * arc.ctrl.y + t * t * arc.to.y,
  };
}

/** Длина дуги по ломаной — нужна, чтобы пускать «пакеты» с одинаковой скоростью. */
export function arcLength(arc: Arc, steps = 24): number {
  let len = 0;
  let prev = arcPoint(arc, 0);
  for (let i = 1; i <= steps; i++) {
    const next = arcPoint(arc, i / steps);
    len += Math.hypot(next.x - prev.x, next.y - prev.y);
    prev = next;
  }
  return len;
}

/** Несколько дуг от дома ко всем серверам, у которых известна страна. */
export function arcsFrom(home: LatLon, points: LatLon[], w: number, h: number): Arc[] {
  return points.map((p) => arcBetween(home, p, w, h));
}
