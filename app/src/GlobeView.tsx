import { useEffect, useMemo, useRef, useState } from "react";
import { landDots, project, rotationFor, shortestDelta, type LatLon } from "./globe";
import { HOME } from "./map";
import { globeStyle, onGlobeStyle, type GlobeStyle } from "./globeStyle";
import { GlobePlanet, takePick, type GlobeNode } from "./GlobePlanet";

export { takePick };
import { TONE_COLOR, nodeTone } from "./health";

type Props = {
  /** Куда повернуть шар: страна выбранного сервера. */
  target: LatLon | null;
  /** Подключено — дуга ярче и по ней бежит огонёк. */
  connected?: boolean;
  /** Подпись под точкой: «Франкфурт · 38 мс». */
  label?: string;
  size?: number;
  /** Вид шара. Если не задан — берём сохранённый в настройках. */
  style?: GlobeStyle;
  /** Точки узлов на планете с результатом последнего замера. */
  nodes?: GlobeNode[];
  /** Нажали точку узла: выбрать этот сервер. */
  onPick?: (id: string) => void;
};

const TILT = -14;
const HOLD_SECS = 7;
const DRIFT = 0.05;

/** Точка на большом круге между двумя координатами. */
function greatCircle(a: LatLon, b: LatLon, t: number): LatLon {
  const toVec = (p: LatLon) => {
    const la = (p.lat * Math.PI) / 180;
    const lo = (p.lon * Math.PI) / 180;
    return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  };
  const [ax, ay, az] = toVec(a);
  const [bx, by, bz] = toVec(b);
  const dot = Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz));
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

function hash(i: number): number {
  const x = Math.sin(i * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

/** Цвет материка по широте: тропики зеленее, пустыни песочные, полюса белые. */
function biome(lat: number): number {
  const a = Math.abs(lat);
  if (a > 66) return 3;
  if (a > 48) return 2;
  if (a > 28) return 1;
  return 0;
}

/**
 * Глобус: шар из точек (неон) или планета с океаном и материками.
 *
 * Шар вращается сам, при смене сервера доворачивается к стране и держит её
 * перед зрителем. Крутится и мышью: потянул — завертелся.
 */
function GlobeDots({ target, connected = false, label, size = 300, nodes }: Omit<Props, "style">) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  // Пинг приходит уже после первого кадра, а цикл рисования зависит только от
  // геометрии и цели. Если читать nodes из замыкания, он навсегда запомнит
  // пустой список — узлы не появятся до смены страны. Держим свежий список в
  // ref, как это делает планета.
  const nodesRef = useRef<GlobeNode[]>([]);
  nodesRef.current = nodes ?? [];

  const geom = useMemo(() => {
    const list = landDots(2);
    const n = list.length;
    const cosLat = new Float32Array(n);
    const sinLat = new Float32Array(n);
    const cosLon = new Float32Array(n);
    const sinLon = new Float32Array(n);
    const biomeOf = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const la = (list[i].lat * Math.PI) / 180;
      const lo = (list[i].lon * Math.PI) / 180;
      cosLat[i] = Math.cos(la);
      sinLat[i] = Math.sin(la);
      cosLon[i] = Math.cos(lo);
      sinLon[i] = Math.sin(lo);
      biomeOf[i] = biome(list[i].lat);
    }
    return { n, cosLat, sinLat, cosLon, sinLon, biomeOf };
  }, []);

  const state = useRef({
    angle: target ? rotationFor(target) : 0,
    goal: target ? rotationFor(target) : 0,
    tilt: target ? Math.max(-68, Math.min(68, target.lat)) : TILT,
    goalTilt: target ? Math.max(-68, Math.min(68, target.lat)) : TILT,
    hold: target ? HOLD_SECS : 0,
  });

  useEffect(() => {
    if (!target) return;
    const s = state.current;
    const goal = rotationFor(target);
    s.goal = s.angle + shortestDelta(s.angle, goal);
    s.goalTilt = Math.max(-68, Math.min(68, target.lat));
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

    const palette = { accent: "#39FF14", ink: "#8b8b9a" };
    const read = () => {
      const cs = getComputedStyle(canvas);
      palette.accent = cs.getPropertyValue("--green").trim() || "#39FF14";
      palette.ink = cs.getPropertyValue("--txt-3").trim() || "#8b8b9a";
    };
    read();
    const themeWatch = new MutationObserver(read);
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const R = size / 2 - 12;
    const cx = size / 2;
    const cy = size / 2;
    const planet = false;

    const stars = Array.from({ length: 44 }, (_, i) => {
      const a = hash(i * 3.1) * Math.PI * 2;
      const r = R * (1.06 + hash(i * 7.7) * 0.3);
      return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, s: 0.5 + hash(i * 1.3) * 0.9, p: hash(i * 5.9) * 6.28 };
    });

    // две орбиты со спутниками: чисто украшение, поэтому углы не связаны с данными
    const orbits = [
      { radius: 1.16, speed: 0.22, phase: 0.6, tilt: -32, hue: planet ? "#9fd4ff" : palette.accent },
      { radius: 1.3, speed: -0.15, phase: 2.4, tilt: 24, hue: planet ? "#ffd479" : palette.accent },
    ];

    let raf = 0;
    let last = performance.now();
    let t = 0;

    const draw = (now: number) => {
      const dt = Math.min(64, now - last) / 1000;
      last = now;
      t += dt;
      const s = state.current;
      const accent = planet ? "#6ab8ff" : palette.accent;
      const ink = palette.ink;

      if (reduce) {
        s.angle = s.goal;
        s.tilt = s.goalTilt;
      } else {
        if (s.hold > 0) {
          s.hold -= dt;
          s.angle += (s.goal - s.angle) * Math.min(1, dt * 3.4);
          s.angle += Math.sin(t * 0.8) * dt * 0.02;
        } else if (target) {
          // Выбранная страна остаётся в центре. Раньше шар после паузы
          // возвращался к «нейтральному» наклону и уплывал, и точки узлов
          // сбивались к кромке — выглядело так, будто они все в одном месте.
          s.angle += (s.goal - s.angle) * Math.min(1, dt * 2.4);
        } else {
          s.angle += dt * DRIFT;
          s.goal = s.angle;
          s.goalTilt = TILT;
        }
        s.tilt += (s.goalTilt - s.tilt) * Math.min(1, dt * 2.4);
      }

      ctx.clearRect(0, 0, size, size);

      // звёзды
      for (const st of stars) {
        ctx.globalAlpha = (planet ? 0.12 : 0.2) + Math.abs(Math.sin(t * 0.6 + st.p)) * 0.28;
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // атмосфера
      const glow = ctx.createRadialGradient(cx, cy, R * 0.8, cx, cy, R * (planet ? 1.14 : 1.18));
      glow.addColorStop(0, `${accent}00`);
      glow.addColorStop(0.58, planet ? "rgba(120,190,255,0.22)" : `${accent}1f`);
      glow.addColorStop(1, `${accent}00`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.18, 0, Math.PI * 2);
      ctx.fill();

      // тело: тёмный неон или океан планеты
      const body = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R * 1.02);
      if (planet) {
        body.addColorStop(0, "#2a6ea8");
        body.addColorStop(0.5, "#17497a");
        body.addColorStop(0.85, "#0b2a4a");
        body.addColorStop(1, "#06182b");
      } else {
        body.addColorStop(0, "#0d1620");
        body.addColorStop(0.65, "#080d14");
        body.addColorStop(1, "#05080d");
      }
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();

      // суша: три полосы по глубине (неон) или четыре биома (планета)
      {
        const rot = (s.angle * Math.PI) / 180;
        const cosR = Math.cos(rot);
        const sinR = Math.sin(rot);
        const tiltR = (s.tilt * Math.PI) / 180;
        const ct = Math.cos(tiltR);
        const stt = Math.sin(tiltR);
        const { n, cosLat, sinLat, cosLon, sinLon, biomeOf } = geom;

        if (planet) {
          const land = [
            new Path2D(), // тропики
            new Path2D(), // умеренный пояс
            new Path2D(), // север
            new Path2D(), // льды
          ];
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
            const px = cx + x0 * R;
            const py = cy - y * R;
            // клетки чуть перекрываются, чтобы материки читались сплошными
            const w = 2.4 + z * 1.9;
            land[biomeOf[i]].rect(px - w / 2, py - w / 2, w, w);
          }
          const tone = ["#4a8a4f", "#7d8a4a", "#8f7f52", "#dfe8ef"];
          for (let b = 0; b < 4; b++) {
            ctx.fillStyle = tone[b];
            ctx.globalAlpha = 0.92;
            ctx.fill(land[b]);
          }
        } else {
          const far = new Path2D();
          const mid = new Path2D();
          const near = new Path2D();
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
            const px = cx + x0 * R;
            const py = cy - y * R;
            const path = z > 0.72 ? near : z > 0.4 ? mid : far;
            path.rect(px - 0.7, py - 0.7, 1.5, 1.5);
          }
          ctx.fillStyle = ink;
          ctx.globalAlpha = 0.16;
          ctx.fill(far);
          ctx.globalAlpha = 0.34;
          ctx.fill(mid);
          ctx.globalAlpha = 0.62;
          ctx.fill(near);
        }
        ctx.globalAlpha = 1;
      }

      // блик солнца на океане
      if (planet) {
        const spec = ctx.createRadialGradient(cx - R * 0.38, cy - R * 0.42, 0, cx - R * 0.38, cy - R * 0.42, R * 0.75);
        spec.addColorStop(0, "rgba(220,240,255,0.22)");
        spec.addColorStop(0.5, "rgba(220,240,255,0.05)");
        spec.addColorStop(1, "rgba(220,240,255,0)");
        ctx.fillStyle = spec;
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.fill();
      }

      // маршрут от тебя к выбранной стране
      if (target) {
        const steps = 64;
        ctx.lineWidth = planet ? 1.8 : 1.4;
        for (let i = 0; i < steps; i++) {
          const a = greatCircle(HOME, target, i / steps);
          const b = greatCircle(HOME, target, (i + 1) / steps);
          const pa = project(a, s.angle, s.tilt);
          const pb = project(b, s.angle, s.tilt);
          if (pa.z <= 0.02 || pb.z <= 0.02) continue;
          const fade = Math.min(pa.z, pb.z);
          ctx.globalAlpha = (connected ? 0.6 : 0.34) * fade;
          ctx.strokeStyle = planet ? "#ffe9a8" : palette.accent;
          ctx.beginPath();
          ctx.moveTo(cx + pa.x * R, cy - pa.y * R);
          ctx.lineTo(cx + pb.x * R, cy - pb.y * R);
          ctx.stroke();
        }

        if (!reduce) {
          const k = (t * 0.35) % 1;
          for (let j = 0; j < 3; j++) {
            const at = greatCircle(HOME, target, (k - j * 0.02 + 1) % 1);
            const pp = project(at, s.angle, s.tilt);
            if (pp.z <= 0.02) continue;
            ctx.globalAlpha = 0.9 - j * 0.3;
            ctx.fillStyle = planet ? "#fff4c9" : palette.accent;
            ctx.beginPath();
            ctx.arc(cx + pp.x * R, cy - pp.y * R, 2.4 - j * 0.6, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      }

      // точка «ты»
      {
        const p = project(HOME, s.angle, s.tilt);
        if (p.z > 0.02) {
          ctx.fillStyle = palette.accent;
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.arc(cx + p.x * R, cy - p.y * R, 2.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      // узлы: цвет точки = последний замер, как на планете
      for (const n of nodesRef.current) {
        const p = project(n, s.angle, s.tilt);
        if (p.z <= 0.02) continue;
        const x = cx + p.x * R;
        const y = cy - p.y * R;
        const tone = nodeTone(n.ms, !!n.stale && n.ms !== null);
        // тёмная подложка: цветная точка не сливается с точками суши
        ctx.globalAlpha = 0.55 * Math.min(1, p.z * 1.6);
        ctx.fillStyle = "#07070c";
        ctx.beginPath();
        ctx.arc(x, y, 4.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = (tone === "dead" ? 0.6 : tone === "stale" ? 0.45 : 0.9) * Math.min(1, p.z * 1.6);
        ctx.fillStyle = TONE_COLOR[tone];
        ctx.beginPath();
        ctx.arc(x, y, 2.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // выбранная страна
      if (target) {
        const p = project(target, s.angle, s.tilt);
        if (p.z > 0.02) {
          const x = cx + p.x * R;
          const y = cy - p.y * R;
          const pulse = reduce ? 0.5 : 0.5 + Math.sin(t * 2.6) * 0.5;
          ctx.globalAlpha = 0.1 + pulse * 0.16;
          ctx.fillStyle = palette.accent;
          ctx.beginPath();
          ctx.arc(x, y, 16 + pulse * 10, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 0.55;
          ctx.strokeStyle = palette.accent;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(x, y, 9, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.fillStyle = palette.accent;
          ctx.beginPath();
          ctx.arc(x, y, 3.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // обод
      const rim = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      if (planet) {
        rim.addColorStop(0, "rgba(150,215,255,0.75)");
        rim.addColorStop(0.55, "rgba(120,170,220,0.25)");
        rim.addColorStop(1, "rgba(90,140,200,0.5)");
      } else {
        rim.addColorStop(0, `${palette.accent}66`);
        rim.addColorStop(0.5, `${ink}22`);
        rim.addColorStop(1, `${palette.accent}44`);
      }
      ctx.strokeStyle = rim;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // спутники
      if (!reduce) {
        for (const o of orbits) {
          const a = t * o.speed + o.phase;
          const ox = Math.cos(a) * R * o.radius;
          const oy = Math.sin(a) * Math.cos((o.tilt * Math.PI) / 180) * R * o.radius * 0.34;
          const behind = Math.sin(a) < 0;
          // след: затухающие точки по орбите, а не линия — так не режет шар
          for (let k = 1; k <= 7; k++) {
            const aa = a - k * 0.045;
            const tx = Math.cos(aa) * R * o.radius;
            const ty = Math.sin(aa) * Math.cos((o.tilt * Math.PI) / 180) * R * o.radius * 0.34;
            ctx.globalAlpha = (behind ? 0.1 : 0.26) * (1 - k / 8);
            ctx.fillStyle = o.hue;
            ctx.beginPath();
            ctx.arc(cx + tx, cy + ty, 1.6 - k * 0.12, 0, Math.PI * 2);
            ctx.fill();
          }
          // сам спутник
          ctx.globalAlpha = behind ? 0.45 : 1;
          ctx.fillStyle = o.hue;
          ctx.beginPath();
          ctx.arc(cx + ox, cy + oy, behind ? 2 : 2.8, 0, Math.PI * 2);
          ctx.fill();
          if (!behind) {
            ctx.globalAlpha = 0.28;
            ctx.beginPath();
            ctx.arc(cx + ox, cy + oy, 7, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      themeWatch.disconnect();
    };
  }, [geom, size, target, connected]);

  // Крутить шар мышью: потянул влево — планета поехала влево.
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let dragging = false;
    let lastX = 0;

    const down = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
      state.current.hold = 0;
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      const s = state.current;
      s.angle -= dx * 0.35;
      s.goal = s.angle;
    };
    const up = () => {
      dragging = false;
    };

    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }, []);

  return (
    <div className="globe" style={{ width: size, height: size }}>
      <canvas ref={ref} style={{ width: size, height: size }} aria-hidden />
      {label && <span className="globe-label">{label}</span>}
    </div>
  );
}

/**
 * Глобус на главной. «Планета» — WebGL-сфера с настоящей текстурой Земли,
 * «Неон» — лёгкий шар из точек. Вид переключается в настройках.
 */
export function Globe({ target, connected = false, label, size = 300, style, nodes, onPick }: Props) {
  const [kind, setKind] = useState<GlobeStyle>(() => style ?? globeStyle());

  useEffect(() => {
    if (style) setKind(style);
  }, [style]);

  useEffect(() => onGlobeStyle(setKind), []);

  if (kind === "planet" || kind === "cinematic") {
    return (
      <GlobePlanet
        key={kind}
        target={target}
        connected={connected}
        label={label}
        size={size}
        nodes={nodes}
        onPick={onPick}
        variant={kind}
      />
    );
  }
  return <GlobeDots target={target} connected={connected} label={label} size={size} nodes={nodes} />;
}
