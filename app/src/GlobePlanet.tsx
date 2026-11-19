import { useEffect, useRef } from "react";
import { project, rotationFor, shortestDelta, type LatLon } from "./globe";
import { HOME } from "./map";

type Props = {
  target: LatLon | null;
  connected?: boolean;
  label?: string;
  size: number;
};

const TILT = -14;
const HOLD_SECS = 7;
const DRIFT = 0.05;

const VERT = `
attribute vec3 aPos;
attribute vec2 aUv;
uniform float uSpin;
uniform float uTilt;
uniform float uScale;
varying vec2 vUv;
varying vec3 vNormal;
void main() {
  vec2 uv = aUv;
  float la = radians(90.0 - uv.y * 180.0);
  float lo = radians(uv.x * 360.0 - 180.0 - uSpin);
  vec3 p = vec3(cos(la) * sin(lo), sin(la), cos(la) * cos(lo));
  float t = radians(uTilt);
  p = vec3(p.x, p.y * cos(t) - p.z * sin(t), p.y * sin(t) + p.z * cos(t));
  vNormal = p;
  vUv = aUv;
  gl_Position = vec4(p.x * uScale, p.y * uScale, -p.z * 0.6, 1.0);
}
`;

const FRAG = `
precision highp float;
varying vec2 vUv;
varying vec3 vNormal;
uniform sampler2D uDay;
uniform sampler2D uWater;
uniform sampler2D uLights;
uniform sampler2D uClouds;
uniform float uCloudShift;
uniform float uConnected;

void main() {
  vec3 n = normalize(vNormal);
  vec3 sun = normalize(vec3(-0.42, 0.40, 0.82));
  vec3 eye = vec3(0.0, 0.0, 1.0);
  float ndl = dot(n, sun);
  float day = smoothstep(-0.30, 0.45, ndl);

  vec3 base = texture2D(uDay, vUv).rgb;
  vec3 col = base * (0.32 + 1.02 * max(ndl, 0.0)) + vec3(0.02, 0.04, 0.08);

  // ночные огни городов
  vec3 lights = texture2D(uLights, vUv).rgb;
  col += lights * (1.0 - day) * 0.55;

  // блик солнца на воде
  float water = texture2D(uWater, vUv).r;
  vec3 h = normalize(sun + eye);
  float spec = pow(max(dot(n, h), 0.0), 110.0) * water * day;
  col += vec3(1.0, 0.96, 0.86) * spec * 0.28;

  // облака чуть быстрее планеты
  float cloud = texture2D(uClouds, vec2(vUv.x + uCloudShift, vUv.y)).r;
  float lit = 0.18 + 1.05 * max(ndl, 0.0);
  col = mix(col, vec3(1.0) * lit, cloud * 0.34);

  // голубая кайма атмосферы по краю диска
  float fres = pow(1.0 - clamp(dot(n, eye), 0.0, 1.0), 3.2);
  col += vec3(0.32, 0.6, 1.0) * fres * (0.35 + 0.55 * day);

  // тёплый терминатор
  float edge = smoothstep(0.25, 0.0, abs(ndl));
  col += vec3(0.9, 0.45, 0.2) * edge * 0.06;

  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function sphere(nLat = 96, nLon = 192) {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= nLat; i++) {
    const v = i / nLat;
    const lat = 90 - v * 180;
    for (let j = 0; j <= nLon; j++) {
      const u = j / nLon;
      const lon = -180 + u * 360;
      const la = (lat * Math.PI) / 180;
      const lo = (lon * Math.PI) / 180;
      pos.push(Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo));
      uv.push(u, v);
    }
  }
  const row = nLon + 1;
  for (let i = 0; i < nLat; i++) {
    for (let j = 0; j < nLon; j++) {
      const a = i * row + j;
      const b = a + row;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return { pos: new Float32Array(pos), uv: new Float32Array(uv), idx: new Uint16Array(idx) };
}

function aniso(gl: WebGLRenderingContext): number {
  const ext =
    gl.getExtension("EXT_texture_filter_anisotropic") ||
    gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic");
  if (!ext) return 1;
  const max = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
  return Math.min(8, max || 1);
}

function loadTex(gl: WebGLRenderingContext, url: string, wrapS: number): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([90, 110, 150, 255]),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const an = aniso(gl);
  const ext =
    gl.getExtension("EXT_texture_filter_anisotropic") ||
    gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic");
  if (ext && an > 1) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, an);
  const img = new Image();
  img.onload = () => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
  };
  img.src = url;
  return tex;
}

/**
 * Настоящая планета: сфера с текстурой Земли, солнце, ночные огни городов,
 * облака и атмосфера. WebGL, без сторонних библиотек.
 */
export function GlobePlanet({ target, connected = false, label, size }: Props) {
  const glRef = useRef<HTMLCanvasElement | null>(null);
  const overRef = useRef<HTMLCanvasElement | null>(null);

  const state = useRef({
    angle: target ? rotationFor(target) : 0,
    goal: target ? rotationFor(target) : 0,
    tilt: target ? Math.max(-18, Math.min(18, target.lat)) : TILT,
    goalTilt: target ? Math.max(-18, Math.min(18, target.lat)) : TILT,
    hold: target ? HOLD_SECS : 0,
    cloud: 0,
  });

  useEffect(() => {
    if (!target) return;
    const s = state.current;
    const goal = rotationFor(target);
    s.goal = s.angle + shortestDelta(s.angle, goal);
    s.goalTilt = Math.max(-18, Math.min(18, target.lat));
    s.hold = HOLD_SECS;
  }, [target]);

  // сфера
  useEffect(() => {
    const canvas = glRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
    });
    if (!gl) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const geo = sphere();
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, geo.pos, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

    const ubo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ubo);
    gl.bufferData(gl.ARRAY_BUFFER, geo.uv, gl.STATIC_DRAW);
    const aUv = gl.getAttribLocation(prog, "aUv");
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);

    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.idx, gl.STATIC_DRAW);

    const day = loadTex(gl, "/earth/day.webp", gl.REPEAT);
    const water = loadTex(gl, "/earth/water.png", gl.REPEAT);
    const lights = loadTex(gl, "/earth/lights.webp", gl.REPEAT);
    const clouds = loadTex(gl, "/earth/clouds.webp", gl.REPEAT);

    const u = {
      spin: gl.getUniformLocation(prog, "uSpin"),
      tilt: gl.getUniformLocation(prog, "uTilt"),
      scale: gl.getUniformLocation(prog, "uScale"),
      cloud: gl.getUniformLocation(prog, "uCloudShift"),
      day: gl.getUniformLocation(prog, "uDay"),
      water: gl.getUniformLocation(prog, "uWater"),
      lights: gl.getUniformLocation(prog, "uLights"),
      clouds: gl.getUniformLocation(prog, "uClouds"),
    };
    gl.uniform1i(u.day, 0);
    gl.uniform1i(u.water, 1);
    gl.uniform1i(u.lights, 2);
    gl.uniform1i(u.clouds, 3);

    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.viewport(0, 0, canvas.width, canvas.height);

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let raf = 0;
    let last = performance.now();
    let t = 0;

    const frame = (now: number) => {
      const dt = Math.min(64, now - last) / 1000;
      last = now;
      t += dt;
      const s = state.current;

      if (reduce) {
        s.angle = s.goal;
        s.tilt = s.goalTilt;
      } else if (s.hold > 0) {
        s.hold -= dt;
        s.angle += (s.goal - s.angle) * Math.min(1, dt * 3.4);
      } else {
        s.angle += dt * DRIFT * 4.2;
        s.goal = s.angle;
        s.goalTilt = TILT;
      }
      if (!reduce) s.tilt += (s.goalTilt - s.tilt) * Math.min(1, dt * 2.4);
      if (!reduce) s.cloud += dt * 0.0016;

      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniform1f(u.spin, s.angle);
      gl.uniform1f(u.tilt, s.tilt);
      gl.uniform1f(u.scale, 1 - 24 / size);
      gl.uniform1f(u.cloud, s.cloud);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, day);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, water);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, lights);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, clouds);

      gl.drawElements(gl.TRIANGLES, geo.idx.length, gl.UNSIGNED_SHORT, 0);
      drawOverlay();

      raf = requestAnimationFrame(frame);
    };

    // --- оверлей: маршрут, точка «ты», страна, спутники ---------------------
    const drawOverlay = () => {
      const over = overRef.current;
      if (!over) return;
      const ctx = over.getContext("2d");
      if (!ctx) return;
      if (over.width !== canvas.width) {
        over.width = canvas.width;
        over.height = canvas.height;
      }
      const R = size / 2 - 12;
      const cx = size / 2;
      const cy = size / 2;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const s = state.current;
      const accent = connected ? "#5dff6a" : "#39FF14";

      if (target) {
        const steps = 72;
        ctx.lineWidth = 1.7;
        ctx.strokeStyle = "#ffe9a8";
        for (let i = 0; i < steps; i++) {
          const a = gc(HOME, target, i / steps);
          const b = gc(HOME, target, (i + 1) / steps);
          const pa = project(a, s.angle, s.tilt);
          const pb = project(b, s.angle, s.tilt);
          if (pa.z <= 0.02 || pb.z <= 0.02) continue;
          ctx.globalAlpha = (connected ? 0.72 : 0.4) * Math.min(pa.z, pb.z);
          ctx.beginPath();
          ctx.moveTo(cx + pa.x * R, cy - pa.y * R);
          ctx.lineTo(cx + pb.x * R, cy - pb.y * R);
          ctx.stroke();
        }
        if (!reduce) {
          const k = (t * 0.32) % 1;
          for (let j = 0; j < 3; j++) {
            const at = gc(HOME, target, (k - j * 0.022 + 1) % 1);
            const pp = project(at, s.angle, s.tilt);
            if (pp.z <= 0.02) continue;
            ctx.globalAlpha = 0.95 - j * 0.3;
            ctx.fillStyle = "#fff6d0";
            ctx.beginPath();
            ctx.arc(cx + pp.x * R, cy - pp.y * R, 2.6 - j * 0.6, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      }

      {
        const p = project(HOME, s.angle, s.tilt);
        if (p.z > 0.02) {
          ctx.fillStyle = accent;
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.arc(cx + p.x * R, cy - p.y * R, 2.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      if (target) {
        const p = project(target, s.angle, s.tilt);
        if (p.z > 0.02) {
          const x = cx + p.x * R;
          const y = cy - p.y * R;
          const pulse = reduce ? 0.5 : 0.5 + Math.sin(t * 2.6) * 0.5;
          ctx.globalAlpha = 0.1 + pulse * 0.18;
          ctx.fillStyle = accent;
          ctx.beginPath();
          ctx.arc(x, y, 15 + pulse * 11, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 0.6;
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

      if (!reduce) {
        const orbits = [
          { r: 1.12, speed: 0.24, phase: 0.6, tilt: -30, hue: "#9fd4ff" },
          { r: 1.26, speed: -0.16, phase: 2.5, tilt: 22, hue: "#ffd479" },
        ];
        for (const o of orbits) {
          const a = t * o.speed + o.phase;
          const ox = Math.cos(a) * R * o.r;
          const oy = Math.sin(a) * Math.cos((o.tilt * Math.PI) / 180) * R * o.r * 0.34;
          const behind = Math.sin(a) < 0;
          for (let k = 1; k <= 7; k++) {
            const aa = a - k * 0.045;
            const tx = Math.cos(aa) * R * o.r;
            const ty = Math.sin(aa) * Math.cos((o.tilt * Math.PI) / 180) * R * o.r * 0.34;
            ctx.globalAlpha = (behind ? 0.1 : 0.26) * (1 - k / 8);
            ctx.fillStyle = o.hue;
            ctx.beginPath();
            ctx.arc(cx + tx, cy + ty, 1.6 - k * 0.12, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = behind ? 0.45 : 1;
          ctx.fillStyle = o.hue;
          ctx.beginPath();
          ctx.arc(cx + ox, cy + oy, behind ? 2 : 2.8, 0, Math.PI * 2);
          ctx.fill();
          if (!behind) {
            ctx.globalAlpha = 0.25;
            ctx.beginPath();
            ctx.arc(cx + ox, cy + oy, 7, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
      }
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      gl.deleteBuffer(vbo);
      gl.deleteBuffer(ubo);
      gl.deleteBuffer(ibo);
      gl.deleteTexture(day);
      gl.deleteTexture(water);
      gl.deleteTexture(lights);
      gl.deleteTexture(clouds);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [size, target, connected]);

  // крутить мышью
  useEffect(() => {
    const canvas = overRef.current;
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
      state.current.angle -= dx * 0.35;
      state.current.goal = state.current.angle;
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
    <div className="globe globe-3d" style={{ width: size, height: size }}>
      <div className="globe-halo" aria-hidden />
      <canvas ref={glRef} style={{ width: size, height: size }} aria-hidden />
      <canvas ref={overRef} style={{ width: size, height: size }} />
      {label && <span className="globe-label">{label}</span>}
    </div>
  );
}

function gc(a: LatLon, b: LatLon, t: number): LatLon {
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
