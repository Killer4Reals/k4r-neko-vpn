import { useEffect, useMemo, useRef } from "react";
import { landDots, project, rotationFor, shortestDelta, type LatLon } from "./globe";
import { HOME } from "./map";

type Props = {
  /** Куда повернуть шар: страна выбранного сервера. */
  target: LatLon | null;
  /** Подключено — дуга ярче и по ней бежит огонёк. */
  connected?: boolean;
  /** Подпись под точкой: «Франкфурт · 38 мс». */
  label?: string;
  size?: number;
};

const TILT = -14;
/** Сколько держим страну перед зрителем, прежде чем снова начать вращение. */
const HOLD_SECS = 7;
/** Скорость свободного вращения, радиан в секунду. */
const DRIFT = 0.05;

/** Точка на большом круге между двумя координатами (сферическая интерполяция). */
function greatCircle(a: LatLon, b: LatLon, t: number): LatLon {
  const toVec = (p: LatLon) => {
    const la = (p.lat * Math.PI) / 180;
    const lo = (p.lon * Math.PI) / 180;
    return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  };
  const [ax, ay, az] = toVec(a);
  const [bx, by, bz] = toVec(b);
  let dot = ax * bx + ay * by + az * bz;
  dot = Math.max(-1, Math.min(1, dot));
  const omega = Math.acos(dot);
  if (omega < 1e-4) return a;
  const k1 = Math.sin((1 - t) * omega) / Math.sin(omega);
  const k2 = Math.sin(t * omega) / Math.sin(omega);
  const x = ax * k1 + bx * k2;
  const y = ay * k1 + by * k2;
  const z = az * k1 + bz * k2;
  return {
    lat: (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI,
    lon: (Math.atan2(y, x) * 180) / Math.PI,
  };
}

/** Небольшой детерминированный шум: мерцание точек без Math.random в кадре. */
function hash(i: number): number {
  const x = Math.sin(i * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Глобус из точек: суша — сетка 2°, проекция ортографическая.
 *
 * Шар всегда медленно вращается. Когда меняется сервер, он доворачивается к
 * стране и держит её перед зрителем несколько секунд — так видно, куда идёт
 * трафик, и при этом картинка живая, а не «застывший шар».
 */
export function Globe({ target, connected = false, label, size = 300 }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  // Тригонометрия суши считается один раз: в кадре остаются только сложения
  // и умножения. Иначе 4600 точек × 60 fps греют ноутбук сильнее игры.
  const geom = useMemo(() => {
    const list = landDots(2);
    const n = list.length;
    const cosLat = new Float32Array(n);
    const sinLat = new Float32Array(n);
    const cosLon = new Float32Array(n);
    const sinLon = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const la = (list[i].lat * Math.PI) / 180;
      const lo = (list[i].lon * Math.PI) / 180;
      cosLat[i] = Math.cos(la);
      sinLat[i] = Math.sin(la);
      cosLon[i] = Math.cos(lo);
      sinLon[i] = Math.sin(lo);
    }
    return { n, cosLat, sinLat, cosLon, sinLon };
  }, []);
  const state = useRef({
    angle: target ? rotationFor(target) : 0,
    goal: target ? rotationFor(target) : 0,
    hold: target ? HOLD_SECS : 0,
  });

  // Смена страны: не рывком, а по кратчайшей дуге и с паузой перед вращением
  useEffect(() => {
    if (!target) return;
    const s = state.current;
    const goal = rotationFor(target);
    s.goal = s.angle + shortestDelta(s.angle, goal);
    s.hold = HOLD_SECS;
  }, [target]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    // цвета берём из темы один раз и обновляем при её смене
    const palette = { accent: "#39FF14", ink: "#8b8b9a", light: false };
    const read = () => {
      const cs = getComputedStyle(canvas);
      palette.accent = cs.getPropertyValue("--green").trim() || "#39FF14";
      palette.ink = cs.getPropertyValue("--txt-3").trim() || "#8b8b9a";
      palette.light = document.documentElement.dataset.theme === "light";
    };
    read();
    const themeWatch = new MutationObserver(read);
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const R = size / 2 - 12;
    const cx = size / 2;
    const cy = size / 2;

    // звёзды в пустоте вокруг шара: Premium-фон без картинок
    const stars = Array.from({ length: 46 }, (_, i) => {
      const a = hash(i * 3.1) * Math.PI * 2;
      const r = R * (1.06 + hash(i * 7.7) * 0.32);
      return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, s: 0.5 + hash(i * 1.3) * 0.9, p: hash(i * 5.9) * 6.28 };
    });

    let raf = 0;
    let last = performance.now();
    let t = 0;

    const draw = (now: number) => {
      const dt = Math.min(64, now - last) / 1000;
      last = now;
      t += dt;
      const s = state.current;
      const accent = palette.accent;
      const ink = palette.ink;

      if (reduce) {
        s.angle = s.goal;
      } else {
        if (s.hold > 0) {
          // держим страну перед зрителем, чуть покачивая: шар «дышит»
          s.hold -= dt;
          s.angle += (s.goal - s.angle) * Math.min(1, dt * 3.4);
          s.angle += Math.sin(t * 0.8) * dt * 0.02;
        } else {
          s.angle += dt * DRIFT;
          s.goal = s.angle;
        }
      }

      ctx.clearRect(0, 0, size, size);

      // звёзды
      if (!palette.light) {
        for (const st of stars) {
          ctx.globalAlpha = 0.18 + Math.abs(Math.sin(t * 0.6 + st.p)) * 0.35;
          ctx.fillStyle = ink;
          ctx.beginPath();
          ctx.arc(st.x, st.y, st.s, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // атмосфера: мягкое свечение вокруг шара
      const glow = ctx.createRadialGradient(cx, cy, R * 0.82, cx, cy, R * 1.18);
      glow.addColorStop(0, `${accent}00`);
      glow.addColorStop(0.55, `${accent}${palette.light ? "10" : "1f"}`);
      glow.addColorStop(1, `${accent}00`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.18, 0, Math.PI * 2);
      ctx.fill();

      // тело шара: тёмный океан с подсветкой сверху-слева
      const body = ctx.createRadialGradient(
        cx - R * 0.35,
        cy - R * 0.4,
        R * 0.1,
        cx,
        cy,
        R * 1.02,
      );
      if (palette.light) {
        body.addColorStop(0, "#ffffff");
        body.addColorStop(0.65, "#f2f7f3");
        body.addColorStop(1, "#e2ece4");
      } else {
        body.addColorStop(0, "#0d1620");
        body.addColorStop(0.65, "#080d14");
        body.addColorStop(1, "#05080d");
      }
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();

      // суша: три полосы по глубине, каждая рисуется одним путём.
      // Один проход по массиву, три заливки — так кадр дешевле в разы.
      {
        const rot = (s.angle * Math.PI) / 180;
        const cosR = Math.cos(rot);
        const sinR = Math.sin(rot);
        const tiltR = (TILT * Math.PI) / 180;
        const ct = Math.cos(tiltR);
        const stt = Math.sin(tiltR);
        const far = new Path2D();
        const mid = new Path2D();
        const near = new Path2D();
        const { n, cosLat, sinLat, cosLon, sinLon } = geom;

        for (let i = 0; i < n; i++) {
          const cl = cosLat[i];
          const clon = cosLon[i] * cosR + sinLon[i] * sinR;
          const slon = sinLon[i] * cosR - cosLon[i] * sinR;
          const x0 = cl * slon;
          const z0 = cl * clon;
          const y0 = sinLat[i];
          const y = y0 * ct - z0 * stt;
          const z = y0 * stt + z0 * ct;
          if (z <= 0.02) continue;
          const x = cx + x0 * R;
          const py = cy - y * R;
          const path = z > 0.72 ? near : z > 0.4 ? mid : far;
          path.rect(x - 0.7, py - 0.7, 1.5, 1.5);
        }

        ctx.fillStyle = ink;
        ctx.globalAlpha = palette.light ? 0.34 : 0.16;
        ctx.fill(far);
        ctx.globalAlpha = palette.light ? 0.55 : 0.34;
        ctx.fill(mid);
        ctx.globalAlpha = palette.light ? 0.85 : 0.62;
        ctx.fill(near);
        ctx.globalAlpha = 1;
      }

      // маршрут от тебя к выбранной стране по большому кругу
      if (target) {
        const steps = 64;
        ctx.lineWidth = 1.4;
        for (let i = 0; i < steps; i++) {
          const a = greatCircle(HOME, target, i / steps);
          const b = greatCircle(HOME, target, (i + 1) / steps);
          const pa = project(a, s.angle, TILT);
          const pb = project(b, s.angle, TILT);
          if (pa.z <= 0.02 || pb.z <= 0.02) continue;
          const fade = Math.min(pa.z, pb.z);
          ctx.globalAlpha = (connected ? 0.55 : 0.3) * fade;
          ctx.strokeStyle = accent;
          ctx.beginPath();
          ctx.moveTo(cx + pa.x * R, cy - pa.y * R);
          ctx.lineTo(cx + pb.x * R, cy - pb.y * R);
          ctx.stroke();
        }

        // огонёк, бегущий по маршруту
        if (!reduce) {
          const k = (t * 0.35) % 1;
          for (let j = 0; j < 3; j++) {
            const at = greatCircle(HOME, target, (k - j * 0.02 + 1) % 1);
            const pp = project(at, s.angle, TILT);
            if (pp.z <= 0.02) continue;
            ctx.globalAlpha = 0.9 - j * 0.3;
            ctx.fillStyle = accent;
            ctx.beginPath();
            ctx.arc(cx + pp.x * R, cy - pp.y * R, 2.4 - j * 0.6, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      }

      // точка «ты»
      {
        const p = project(HOME, s.angle, TILT);
        if (p.z > 0.02) {
          const x = cx + p.x * R;
          const y = cy - p.y * R;
          ctx.fillStyle = accent;
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.arc(x, y, 2.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      // выбранная страна: кольцо, пульс, точка
      if (target) {
        const p = project(target, s.angle, TILT);
        if (p.z > 0.02) {
          const x = cx + p.x * R;
          const y = cy - p.y * R;
          const pulse = reduce ? 0.5 : 0.5 + Math.sin(t * 2.6) * 0.5;

          ctx.globalAlpha = 0.1 + pulse * 0.16;
          ctx.fillStyle = accent;
          ctx.beginPath();
          ctx.arc(x, y, 16 + pulse * 10, 0, Math.PI * 2);
          ctx.fill();

          ctx.globalAlpha = 0.55;
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(x, y, 9, 0, Math.PI * 2);
          ctx.stroke();

          ctx.globalAlpha = 1;
          ctx.fillStyle = accent;
          ctx.beginPath();
          ctx.arc(x, y, 3.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // обод: тонкая световая линия по краю шара
      const rim = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      rim.addColorStop(0, `${accent}66`);
      rim.addColorStop(0.5, `${ink}22`);
      rim.addColorStop(1, `${accent}44`);
      ctx.strokeStyle = rim;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      themeWatch.disconnect();
    };
  }, [geom, size, target, connected]);

  return (
    <div className="globe" style={{ width: size, height: size }}>
      <canvas ref={ref} style={{ width: size, height: size }} aria-hidden />
      {label && <span className="globe-label">{label}</span>}
    </div>
  );
}
