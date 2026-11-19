import { useEffect, useMemo, useRef } from "react";
import type { Server } from "./data";
import { countryOf, landDots, type LatLon } from "./globe";
import { arcsFrom, arcBetween, arcPoint, HOME, projectFlat, type Arc } from "./map";

type Props = {
  servers: Server[];
  selectedId: string;
  onPick: (id: string) => void;
  t: (k: string) => string;
};

const HEIGHT = 230;

/**
 * Карта мира из точек и дуги к серверам. Рисуем в canvas: точек суши ~4 тысячи,
 * DOM бы это не переварил, а так карта стоит один drawImage в кадре.
 */
export function ServerMap({ servers, selectedId, onPick, t }: Props) {
  const box = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const dots = useMemo(() => landDots(2), []);
  const size = useRef({ w: 800, h: HEIGHT });
  const layer = useRef<HTMLCanvasElement | null>(null);
  const spots = useRef<{ id: string; x: number; y: number }[]>([]);

  // Серверы, у которых понятна страна: без страны дугу вести некуда
  const pins = useMemo(() => {
    return servers
      .map((s) => ({ s, p: countryOf(s.flag || s.cc) }))
      .filter((x): x is { s: Server; p: LatLon } => !!x.p);
  }, [servers]);

  useEffect(() => {
    const el = box.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const paint = () => {
      const css = getComputedStyle(el);
      const accent = css.getPropertyValue("--green").trim() || "#39FF14";
      const ink = css.getPropertyValue("--txt-3").trim() || "#7C8698";
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = el.clientWidth || 800;
      const h = HEIGHT;
      size.current = { w, h };
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // суша один раз в отдельный слой: на каждом кадре только drawImage
      const off = document.createElement("canvas");
      off.width = cv.width;
      off.height = cv.height;
      const octx = off.getContext("2d");
      if (octx) {
        octx.setTransform(dpr, 0, 0, dpr, 0, 0);
        octx.fillStyle = ink;
        octx.globalAlpha = 0.5;
        for (const d of dots) {
          const p = projectFlat(d, w, h);
          octx.beginPath();
          octx.arc(p.x, p.y, 1.05, 0, Math.PI * 2);
          octx.fill();
        }
      }
      layer.current = off;

      spots.current = pins.map(({ s, p }) => {
        const xy = projectFlat(p, w, h);
        return { id: s.id, x: xy.x, y: xy.y };
      });

      const homeAt = projectFlat(HOME, w, h);
      const arcs = arcsFrom(
        HOME,
        pins.map((x) => x.p),
        w,
        h,
      );
      const selected = pins.findIndex((x) => x.s.id === selectedId);
      let raf = 0;
      let start = performance.now();

      const frame = (now: number) => {
        if (!layer.current) return;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(layer.current, 0, 0, w, h);

        const time = reduce ? 0 : (now - start) / 1000;

        // дуги: далёкие тусклее, выбранная ярче всех
        arcs.forEach((arc, i) => {
          const on = i === selected;
          ctx.beginPath();
          ctx.moveTo(arc.from.x, arc.from.y);
          ctx.quadraticCurveTo(arc.ctrl.x, arc.ctrl.y, arc.to.x, arc.to.y);
          ctx.strokeStyle = on ? accent : ink;
          ctx.globalAlpha = on ? 0.9 : 0.3;
          ctx.lineWidth = on ? 1.8 : 1.1;
          ctx.stroke();
        });

        // выбранная дуга: бегущая точка
        if (selected >= 0) {
          const arc: Arc = arcBetween(HOME, pins[selected].p, w, h);
          const t0 = reduce ? 0.5 : (time * 0.55) % 1;
          for (let k = 0; k < 3; k++) {
            const p = arcPoint(arc, (t0 + k * 0.06) % 1);
            ctx.beginPath();
            ctx.arc(p.x, p.y, 2.4 - k * 0.6, 0, Math.PI * 2);
            ctx.fillStyle = accent;
            ctx.globalAlpha = 0.9 - k * 0.25;
            ctx.fill();
          }
        }

        // точка пользователя
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(homeAt.x, homeAt.y, 3.6, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(homeAt.x, homeAt.y, 7 + (reduce ? 0 : Math.sin(time * 3) * 1.6), 0, Math.PI * 2);
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 0.75;
        ctx.font = "600 10px Manrope, system-ui, sans-serif";
        ctx.fillStyle = accent;
        ctx.fillText(t("mapYou"), homeAt.x + 8, homeAt.y + 4);

        // серверы
        pins.forEach(({ s }, i) => {
          const p = pins[i].p;
          const xy = projectFlat(p, w, h);
          const on = s.id === selectedId;
          ctx.globalAlpha = on ? 1 : 0.65;
          ctx.beginPath();
          ctx.arc(xy.x, xy.y, on ? 4.6 : 3, 0, Math.PI * 2);
          ctx.fillStyle = on ? accent : ink;
          ctx.fill();
          if (on) {
            ctx.beginPath();
            ctx.arc(xy.x, xy.y, 9, 0, Math.PI * 2);
            ctx.strokeStyle = accent;
            ctx.globalAlpha = 0.5;
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.font = "600 11px Manrope, system-ui, sans-serif";
            const label = s.city;
            const width = ctx.measureText(label).width;
            ctx.fillStyle = "rgba(8,6,12,0.78)";
            const bx = Math.min(w - width - 18, Math.max(6, xy.x - width / 2 - 6));
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(bx, xy.y - 26, width + 12, 17, 8);
            else ctx.rect(bx, xy.y - 26, width + 12, 17);
            ctx.fill();
            ctx.fillStyle = accent;
            ctx.fillText(label, bx + 6, xy.y - 14);
          }
        });

        if (!reduce) raf = requestAnimationFrame(frame);
      };
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
      return () => cancelAnimationFrame(raf);
    };

    let stop = paint();
    const ro = new ResizeObserver(() => {
      stop?.();
      stop = paint();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      stop?.();
    };
  }, [dots, pins, selectedId]);

  const pick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    let best: { id: string; d: number } | null = null;
    for (const s of spots.current) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < 16 && (!best || d < best.d)) best = { id: s.id, d };
    }
    if (best) onPick(best.id);
  };

  return (
    <div className="map-card">
      <div className="map-head">
        <span className="map-title">{t("mapTitle")}</span>
        <span className="map-hint">{t("mapHint")}</span>
      </div>
      <div className="map-box" ref={box}>
        <canvas ref={canvas} onClick={pick} />
      </div>
    </div>
  );
}
