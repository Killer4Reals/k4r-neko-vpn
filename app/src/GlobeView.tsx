import { useEffect, useMemo, useRef } from "react";
import { easeOut, landDots, project, rotationFor, shortestDelta, type LatLon } from "./globe";

type Props = {
  /** Куда повернуть шар: страна выбранного сервера. */
  target: LatLon | null;
  /** Подключено — рисуем дугу и яркую точку, иначе только точку. */
  connected?: boolean;
  /** Подпись под точкой: «Франкфурт · 38 мс». */
  label?: string;
  size?: number;
};

/**
 * Глобус из точек: суша — сетка 2°, проекция ортографическая. Никаких 3D-библиотек,
 * поэтому 60 fps даже на слабом ноутбуке и ноль мегабайт в установщике.
 */
export function Globe({ target, connected = false, label, size = 300 }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const dots = useMemo(() => landDots(), []);
  // текущий и желаемый угол поворота
  const state = useRef({ angle: target ? rotationFor(target) : 0, goal: target ? rotationFor(target) : 0 });

  useEffect(() => {
    if (!target) return;
    const goal = rotationFor(target);
    state.current.goal = state.current.angle + shortestDelta(state.current.angle, goal);
  }, [target]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const style = getComputedStyle(canvas);
    const accent = style.getPropertyValue("--green").trim() || "#39FF14";
    const ink = style.getPropertyValue("--txt-3").trim() || "#8b8b9a";
    const R = size / 2 - 10;
    const cx = size / 2;
    const cy = size / 2;

    let raf = 0;
    let last = performance.now();
    let t = 0;

    const draw = (now: number) => {
      const dt = Math.min(64, now - last) / 1000;
      last = now;
      const s = state.current;
      if (reduce) {
        s.angle = s.goal;
      } else {
        // плавно догоняем цель и держим лёгкое вращение, когда цель достигнута
        s.angle += (s.goal - s.angle) * Math.min(1, dt * 3.2);
        if (Math.abs(s.goal - s.angle) < 0.05) s.angle += dt * 4;
      }
      t += dt;

      ctx.clearRect(0, 0, size, size);

      // мягкое свечение шара
      const glow = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.05);
      glow.addColorStop(0, `${accent}22`);
      glow.addColorStop(1, "transparent");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.05, 0, Math.PI * 2);
      ctx.fill();

      for (const dot of dots) {
        const p = project(dot, s.angle, -14);
        if (p.z <= 0.02) continue;
        const x = cx + p.x * R;
        const y = cy - p.y * R;
        // ближние точки крупнее и ярче — создаёт объём
        const depth = 0.35 + p.z * 0.65;
        const r = 0.9 + depth * 1.3;
        ctx.globalAlpha = 0.15 + depth * 0.55;
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // точка страны и дуга подключения
      if (target) {
        const p = project(target, s.angle, -14);
        if (p.z > 0) {
          const x = cx + p.x * R;
          const y = cy - p.y * R;
          const pulse = reduce ? 0.6 : 0.5 + Math.sin(t * 3) * 0.5;
          ctx.fillStyle = accent;
          ctx.globalAlpha = 0.18 + pulse * 0.22;
          ctx.beginPath();
          ctx.arc(x, y, 14 + pulse * 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.fillStyle = accent;
          ctx.beginPath();
          ctx.arc(x, y, 3.4, 0, Math.PI * 2);
          ctx.fill();

          if (connected) {
            // дуга из точки к зрителю: намёк на «туннель поднят»
            ctx.strokeStyle = accent;
            ctx.globalAlpha = 0.5;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.quadraticCurveTo(cx, cy - R * 0.15, cx, cy + R * 0.1);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }
      }

      // рамка-орбита
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.16;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [dots, size, target, connected]);

  return (
    <div className="globe" style={{ width: size, height: size }}>
      <canvas ref={ref} style={{ width: size, height: size }} aria-hidden />
      {label && <span className="globe-label">{label}</span>}
    </div>
  );
}

export { easeOut };
