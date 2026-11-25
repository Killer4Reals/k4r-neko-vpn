import { useEffect, useRef } from "react";
import { auroraIntensity, auroraTint, type AuroraPhase } from "./auroraLogic";

type Props = { phase: AuroraPhase; down: number; up: number };

/**
 * Живой фон: три мягких пятна плывут по экрану, оттенок и яркость берут из
 * состояния туннеля и трафика. Рисуем на canvas 30 раз в секунду — чаще
 * незаметно, а батарею на ноутбуке это экономит.
 */
export function Aurora({ phase, down, up }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  // Параметры меняются каждый тик трафика: держим их в ref, чтобы не
  // пересоздавать цикл рисования двадцать раз в секунду.
  const live = useRef({ phase, down, up, power: 0 });
  live.current.phase = phase;
  live.current.down = down;
  live.current.up = up;
  live.current.power = auroraIntensity(phase, down, up);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let raf = 0;
    let w = 0;
    let h = 0;
    let t = 0;
    let lastDraw = 0;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const paint = () => {
      if (!w || !h) return;
      const state = live.current;
      const tint = auroraTint(state.phase);
      const hueAt = (i: number) => {
        // Красный переход идёт через 360: без этого между 340 и 8 оттенок
        // уезжал бы в зелёный.
        const to = tint.to < tint.from ? tint.to + 360 : tint.to;
        return (tint.from + (to - tint.from) * (i / 2)) % 360;
      };
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < 3; i += 1) {
        const cx = w * (0.5 + 0.32 * Math.sin(t * 0.11 + i * 2.1));
        const cy = h * (0.5 + 0.26 * Math.cos(t * 0.08 + i * 1.7));
        const r = Math.max(w, h) * (0.4 + 0.06 * i);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `hsla(${hueAt(i)}, 88%, 62%, ${0.18 * state.power})`);
        g.addColorStop(1, "hsla(0, 0%, 0%, 0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      if (now - lastDraw < 33) return;
      const dt = Math.min(0.2, (now - lastDraw) / 1000);
      lastDraw = now;
      t += dt;
      paint();
    };

    resize();
    paint();
    if (!reduce) raf = requestAnimationFrame(frame);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} className="aurora" aria-hidden="true" />;
}
