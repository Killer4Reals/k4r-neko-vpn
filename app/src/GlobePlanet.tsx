import { useEffect, useRef, useState } from "react";
import { nearestWithin, project, rotationFor, shortestDelta, type LatLon } from "./globe";
import { HOME } from "./map";

/** Узел на планете: где он и как его последний замер. */
export type GlobeNode = {
  lat: number;
  lon: number;
  /** миллисекунды или null, если узел не ответил */
  ms: number | null;
  /** замер постарел — узел не мёртв, его просто давно не спрашивали */
  stale?: boolean;
  /** ещё ни разу не мерили: узел есть, результата пока нет */
  pending?: boolean;
  /** «Франкфурт» — для подсказки при наведении */
  label?: string;
  /** id сервера: по нему нажатие на точку выбирает узел */
  id?: string;
};

type Props = {
  target: LatLon | null;
  connected?: boolean;
  label?: string;
  size: number;
  nodes?: GlobeNode[];
  /** нажатие на точку узла: выбрать этот сервер */
  onPick?: (id: string) => void;
  /** «planet» — спокойный снимок Земли, «cinematic» — облака, звёзды, яркая атмосфера */
  variant?: "planet" | "cinematic";
};

/**
 * Шар лежит внутри кнопки «включить», поэтому клик по точке дошёл бы и до неё.
 * Метка времени решает спор: если только что выбрали узел, кнопка молчит.
 * Живёт дольше одного кадра, потому что click приходит после pointerup.
 */
let pickedAt = 0;

export function takePick(): boolean {
  if (performance.now() - pickedAt > 500) return false;
  pickedAt = 0;
  return true;
}

const TILT = -14;
const HOLD_SECS = 7;
const DRIFT = 0.05;

/** Мягкий перелёт с еле заметным перелётом по инерции: без него поворот
 *  выглядит механическим, а с ним — «живым». */
function easeOutBack(p: number): number {
  const c = 0.14;
  const t = Math.min(1, Math.max(0, p)) - 1;
  return 1 + (c + 1) * t * t * t + c * t * t;
}

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
uniform sampler2D uNormal;
uniform float uCloudShift;
uniform float uConnected;
uniform float uRelief;
uniform vec3 uSun;
/** 1 — кинематик: контрастнее свет, плотнее облака, ярче атмосфера. */
uniform float uCine;

void main() {
  vec3 n = normalize(vNormal);
  vec3 sun = normalize(uSun);
  vec3 eye = vec3(0.0, 0.0, 1.0);

  float water = texture2D(uWater, vUv).r;

  // Рельеф: нормаль из карты высот. Горы ловят свет с одной стороны и уходят
  // в тень с другой — именно это отличает объёмную планету от наклейки.
  // У океана рельеф почти плоский, иначе вода выглядит гофрированной.
  vec3 nTex = texture2D(uNormal, vUv).xyz * 2.0 - 1.0;
  vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), n) + vec3(1e-5, 0.0, 0.0));
  vec3 north = cross(n, east);
  // У полюсов рельеф даёт радиальные лучи: там строки текстуры сходятся в точку.
  float polarSame = smoothstep(0.80, 0.94, abs(n.y));
  float bump = uRelief * mix(1.0, 0.18, water) * (1.0 - polarSame);
  vec3 nb = normalize(n + (east * nTex.x + north * nTex.y) * bump);

  float ndlGeo = dot(n, sun);
  float ndl = dot(nb, sun);
  float day = smoothstep(mix(-0.30, -0.14, uCine), mix(0.45, 0.30, uCine), ndlGeo);

  // Облака плывут быстрее планеты; их тень падает на землю со сдвигом к солнцу.
  // У полюсов строки текстуры сходятся в точку: любой рисунок там растягивается
  // в радиальные лучи. Гасим облака и тень у полюсов — так чище и физично.
  float polar = polarSame;
  // Плотность облаков в текстуре низкая: без кривой весь шар выглядит молочным.
  float cloud = pow(texture2D(uClouds, vec2(vUv.x + uCloudShift, vUv.y)).r, 1.35) * (1.0 - polar);
  float shadowUvX = vUv.x + uCloudShift + 0.012 * dot(sun, east);
  float shadowUvY = vUv.y - 0.012 * dot(sun, north);
  float cloudShadow = texture2D(uClouds, vec2(shadowUvX, shadowUvY)).r * (1.0 - polar);

  vec3 base = texture2D(uDay, vUv).rgb;
  // Кинематик: цвет чуть плотнее снимка, иначе на тёмной карточке он киснет.
  float baseLum = dot(base, vec3(0.299, 0.587, 0.114));
  base = max(vec3(0.0), base + (base - vec3(baseLum)) * 0.34 * uCine);
  base *= mix(1.0, 1.05, uCine);
  // Вода чуть глубже суши: снимок NASA на шаре выглядит слишком светлым.
  base *= mix(1.0, 0.93, water);
  // Кинематик: океан уводим в глубокий синий, иначе он серо-голубой.
  base = mix(base, base * vec3(0.80, 0.95, 1.18), water * 0.55 * uCine);
  base *= mix(1.0, 0.80, cloudShadow * 0.9);

  // Свет: тёплое солнце + холодная подсветка с ночной стороны.
  vec3 warm = vec3(1.04, 0.99, 0.93);
  vec3 cool = vec3(0.10, 0.16, 0.30);
  float diffuse = max(ndl, 0.0);
  vec3 col = base * (warm * (0.24 + 1.05 * diffuse) + cool * (1.0 - day) * 0.55);
  col += vec3(0.015, 0.03, 0.075) * (1.0 - day);

  // ночные огни городов
  vec3 lights = texture2D(uLights, vUv).rgb;
  col += lights * (1.0 - day) * 0.62;

  // Вода: узкий блик солнца и широкая «стеклянная» полоса.
  vec3 h = normalize(sun + eye);
  float nh = max(dot(nb, h), 0.0);
  float spec = pow(nh, mix(220.0, 330.0, uCine)) * mix(0.24, 0.30, uCine) + pow(nh, 40.0) * 0.02;
  col += vec3(1.0, 0.97, 0.90) * spec * water * day;

  // Облака: сверху свой свет, в тени почти не видно.
  float lit = 0.14 + 1.02 * max(ndl, 0.0);
  col = mix(col, vec3(0.96, 0.98, 1.0) * lit, cloud * mix(0.42, 0.60, uCine));

  // Атмосфера: плотная голубая дымка у края диска, ярче со стороны солнца.
  float rim = 1.0 - clamp(dot(n, eye), 0.0, 1.0);
  float haze = pow(rim, 2.4);
  float halo = pow(rim, 6.0);
  float sunSide = 0.35 + 0.65 * smoothstep(-0.45, 0.55, ndlGeo);
  float air = mix(0.55, 1.0, uCine);
  col += vec3(0.26, 0.55, 0.95) * haze * 0.55 * sunSide * air;
  col += vec3(0.55, 0.78, 1.0) * halo * 0.55 * sunSide * air;
  // Кинематик: широкая голубая вуаль по всему краю, как на референсе.
  col += vec3(0.10, 0.30, 0.60) * pow(rim, 3.1) * uCine * 0.30;

  // Тёплый терминатор: там, где день переходит в ночь.
  float edge = smoothstep(0.30, 0.0, abs(ndlGeo));
  col += vec3(1.0, 0.55, 0.28) * edge * 0.09;

  // Лёгкое затемнение к краю — шар перестаёт быть плоским кругом.
  col *= mix(0.80, 1.0, pow(clamp(dot(n, eye), 0.0, 1.0), 0.55));

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

function loadTex(gl: WebGLRenderingContext, url: string, wrapS: number, onLoad?: () => void): WebGLTexture {
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
    onLoad?.();
  };
  img.src = url;
  return tex;
}

/**
 * Настоящая планета: сфера с текстурой Земли, солнце, ночные огни городов,
 * облака и атмосфера. WebGL, без сторонних библиотек.
 */
export function GlobePlanet({ target, connected = false, label, size, nodes, onPick, variant = "planet" }: Props) {
  const glRef = useRef<HTMLCanvasElement | null>(null);
  // Пока текстура не пришла, шар рисовать нечем: вместо чёрного круга — скелет.
  const [ready, setReady] = useState(false);
  const overRef = useRef<HTMLCanvasElement | null>(null);
  // замеры обновляются каждые 10 минут; пересоздавать ради них WebGL незачем
  const nodesRef = useRef<GlobeNode[]>([]);
  nodesRef.current = nodes ?? [];
  // Курсор над планетой: по нему ищем ближайший узел для подсказки.
  const pointer = useRef<{ x: number; y: number; inside: boolean }>({ x: 0, y: 0, inside: false });
  // Где точки оказались на экране в последнем кадре — по этому и ловим клик.
  const hitRef = useRef<{ id: string; x: number; y: number }[]>([]);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  const state = useRef({
    angle: target ? rotationFor(target) : 0,
    goal: target ? rotationFor(target) : 0,
    tilt: target ? Math.max(-68, Math.min(68, target.lat)) : TILT,
    goalTilt: target ? Math.max(-68, Math.min(68, target.lat)) : TILT,
    hold: target ? HOLD_SECS : 0,
    cloud: 0,
    /// текущий переход: откуда, куда и когда начался
    move: null as null | { from: number; to: number; fromTilt: number; toTilt: number; t0: number; dur: number },
    /// когда прилетели — для вспышки в точке прибытия
    arrived: -1,
    zoom: 1,
  });

  useEffect(() => {
    if (!target) return;
    const s = state.current;
    const to = s.angle + shortestDelta(s.angle, rotationFor(target));
    const toTilt = Math.max(-68, Math.min(68, target.lat));
    // Дальний перелёт длится дольше ближнего: глаз ждёт соразмерности пути.
    const span = Math.abs(to - s.angle) / 180;
    s.move = {
      from: s.angle,
      to,
      fromTilt: s.tilt,
      toTilt,
      t0: performance.now(),
      dur: 0.85 + Math.min(0.75, span * 0.8),
    };
    s.goal = to;
    s.goalTilt = toTilt;
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

    const cine = variant === "cinematic";
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const u: Record<string, WebGLUniformLocation | null> = {
      spin: gl.getUniformLocation(prog, "uSpin"),
      tilt: gl.getUniformLocation(prog, "uTilt"),
      scale: gl.getUniformLocation(prog, "uScale"),
    };
    let vbo: WebGLBuffer | null = null;
    let ubo: WebGLBuffer | null = null;
    let ibo: WebGLBuffer | null = null;
    let day: WebGLTexture | null = null;
    let water: WebGLTexture | null = null;
    let lights: WebGLTexture | null = null;
    let clouds: WebGLTexture | null = null;
    let normal: WebGLTexture | null = null;
    let sphereIndexCount = 0;
    const geo = sphere();
    sphereIndexCount = geo.idx.length;
    vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, geo.pos, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

    ubo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ubo);
    gl.bufferData(gl.ARRAY_BUFFER, geo.uv, gl.STATIC_DRAW);
    const aUv = gl.getAttribLocation(prog, "aUv");
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);

    ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.idx, gl.STATIC_DRAW);

    day = loadTex(gl, "/earth/day.webp", gl.REPEAT, () => setReady(true));
    normal = loadTex(gl, "/earth/normal.webp", gl.REPEAT);
    water = loadTex(gl, "/earth/water.png", gl.REPEAT);
    lights = loadTex(gl, "/earth/lights.webp", gl.REPEAT);
    clouds = loadTex(gl, "/earth/clouds.webp", gl.REPEAT);

    u.cloud = gl.getUniformLocation(prog, "uCloudShift");
    u.day = gl.getUniformLocation(prog, "uDay");
    u.water = gl.getUniformLocation(prog, "uWater");
    u.lights = gl.getUniformLocation(prog, "uLights");
    u.clouds = gl.getUniformLocation(prog, "uClouds");
    u.normal = gl.getUniformLocation(prog, "uNormal");
    u.relief = gl.getUniformLocation(prog, "uRelief");
    u.sun = gl.getUniformLocation(prog, "uSun");
    u.cine = gl.getUniformLocation(prog, "uCine");
    gl.uniform1i(u.day, 0);
    gl.uniform1i(u.water, 1);
    gl.uniform1i(u.lights, 2);
    gl.uniform1i(u.clouds, 3);
    gl.uniform1i(u.normal, 4);
    gl.uniform1f(u.relief, 1.0);
    if (cine) gl.uniform3f(u.sun, 0.55, 0.45, 0.70);
    else gl.uniform3f(u.sun, -0.26, 0.34, 0.90);
    gl.uniform1f(u.cine, cine ? 1 : 0);

    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.viewport(0, 0, canvas.width, canvas.height);

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const live = { current: true };
    let onScreen = true;
    const updateLive = () => {
      live.current = onScreen && !document.hidden;
    };
    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      updateLive();
    });
    io.observe(canvas);
    const onVis = () => updateLive();
    document.addEventListener("visibilitychange", onVis);
    updateLive();
    let raf = 0;
    let last = performance.now();
    let t = 0;

    const frame = (now: number) => {
      if (!live.current) {
        raf = requestAnimationFrame(frame);
        return;
      }
      const dt = Math.min(64, now - last) / 1000;
      last = now;
      t += dt;
      const s = state.current;

      if (reduce) {
        s.angle = s.goal;
        s.tilt = s.goalTilt;
        s.zoom = 1;
        s.move = null;
      } else if (s.move) {
        const m = s.move;
        const p = Math.min(1, (now - m.t0) / (m.dur * 1000));
        // easeInOutQuint: разгон, длинный «полёт», мягкая остановка
        const e = p < 0.5 ? 16 * p ** 5 : 1 - Math.pow(-2 * p + 2, 5) / 2;
        s.angle = m.from + (m.to - m.from) * e;
        s.tilt = m.fromTilt + (m.toTilt - m.fromTilt) * easeOutBack(p);
        // планета чуть отъезжает и возвращается — как будто её повернули рукой
        s.zoom = 1 - 0.07 * Math.sin(Math.PI * p);
        if (p >= 1) {
          s.move = null;
          s.zoom = 1;
          s.arrived = now;
        }
      } else if (s.hold > 0) {
        s.hold -= dt;
      } else if (target) {
        // Выбранная страна держится в центре. Раньше шар после паузы
        // возвращался к нейтральному наклону, и точки узлов уезжали к кромке.
        s.angle += (s.goal - s.angle) * Math.min(1, dt * 2.4);
        s.tilt += (s.goalTilt - s.tilt) * Math.min(1, dt * 2.4);
      } else {
        s.angle += dt * DRIFT * 4.2;
        s.goal = s.angle;
        s.goalTilt = TILT;
        s.tilt += (s.goalTilt - s.tilt) * Math.min(1, dt * 1.6);
      }
      if (!reduce) s.cloud += dt * 0.0016;

      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniform1f(u.spin, s.angle);
      gl.uniform1f(u.tilt, s.tilt);
      gl.uniform1f(u.scale, (1 - 24 / size) * s.zoom);

      gl.uniform1f(u.cloud, s.cloud);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, day);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, water);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, lights);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, clouds);
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, normal);
      gl.drawElements(gl.TRIANGLES, sphereIndexCount, gl.UNSIGNED_SHORT, 0);
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
      const s = state.current;
      const R = (size / 2 - 12) * s.zoom;
      const cx = size / 2;
      const cy = size / 2;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const accent = connected ? "#5dff6a" : "#39FF14";

      // Атмосферное свечение вокруг диска: тонкая голубая дымка за краем шара.
      // Именно она даёт ощущение «настоящей планеты в космосе», а не кружка.
      const cine = variant === "cinematic";
      const glow = ctx.createRadialGradient(cx, cy, R * 0.97, cx, cy, R * 1.16);
      glow.addColorStop(0, `rgba(122,190,255,${cine ? 0.32 : 0.26})`);
      glow.addColorStop(0.4, `rgba(86,146,255,${cine ? 0.20 : 0.12})`);
      glow.addColorStop(1, "rgba(46,96,206,0)");
      // Заливка круга градиентом красила и сам диск: шар покрывался голубой
      // дымкой, из-за которой и планета, и low-poly выглядели выцветшими.
      // Клипаем кольцо — дымка остаётся только за краем.
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.16, 0, Math.PI * 2);
      ctx.arc(cx, cy, R * 0.995, 0, Math.PI * 2, true);
      ctx.clip("evenodd");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Кинематик: солнце за краем диска и его ореол — как на референсе.
      if (cine) {
        const n = Math.hypot(0.55, 0.45, 0.70);
        const sx = cx + (0.55 / n) * R * 1.12;
        const sy = cy - (0.45 / n) * R * 1.12;
        const flare = ctx.createRadialGradient(sx, sy, 0, sx, sy, R * 0.46);
        flare.addColorStop(0, "rgba(200,235,255,0.16)");
        flare.addColorStop(0.4, "rgba(130,195,255,0.07)");
        flare.addColorStop(1, "rgba(80,140,255,0)");
        ctx.fillStyle = flare;
        ctx.beginPath();
        ctx.arc(sx, sy, R * 0.46, 0, Math.PI * 2);
        ctx.fill();
      }

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

      // --- узлы на планете: цвет точки = результат последнего замера.
      // Человеку не нужно открывать список, чтобы увидеть, кто жив.
      const nodeList = nodesRef.current;
      if (nodeList.length > 0) {
        const hits: { id: string; x: number; y: number }[] = [];
        for (const n of nodeList) {
          const p = project(n, s.angle, s.tilt);
          if (p.z <= 0.02) continue;
          const x = cx + p.x * R;
          const y = cy - p.y * R;
          if (n.id) hits.push({ id: n.id, x, y });
          const pending = n.pending === true;
          const color = pending
            ? "#9db6d8"
            : n.ms === null
              ? "#ff5d6c"
              : n.stale
                ? "#8e8a9c"
                : n.ms < 90
                  ? "#39FF14"
                  : n.ms < 180
                    ? "#ffd166"
                    : "#ff9a4d";
          const a = (pending ? 0.5 : n.ms === null ? 0.6 : n.stale ? 0.45 : 0.85) * Math.min(1, p.z * 1.6);
          // тёмная подложка: точка читается и на белом облаке, и на синем океане
          ctx.globalAlpha = a * 0.55;
          ctx.fillStyle = "#07040d";
          ctx.beginPath();
          ctx.arc(x, y, 4.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = a;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
          if (pending) {
            // Нет замера — не «мёртв»: спокойное кольцо вместо красной точки.
            ctx.globalAlpha = a * 0.8;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(x, y, 5.2, 0, Math.PI * 2);
            ctx.stroke();
          } else if (n.ms !== null && !n.stale) {
            ctx.globalAlpha = a * 0.3;
            ctx.beginPath();
            ctx.arc(x, y, 6.4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
        hitRef.current = hits;
      } else {
        hitRef.current = [];
      }

      // --- подсказка при наведении: ближайший узел и его замер.
      // Человеку не нужно уходить в список, чтобы понять «кто это».
      const ptr = pointer.current;
      if (ptr.inside && nodeList.length > 0) {
        let near: { n: GlobeNode; x: number; y: number; d: number } | null = null;
        for (const n of nodeList) {
          const p = project(n, s.angle, s.tilt);
          if (p.z <= 0.02) continue;
          const x = cx + p.x * R;
          const y = cy - p.y * R;
          const d = Math.hypot(x - ptr.x, y - ptr.y);
          if (!near || d < near.d) near = { n, x, y, d };
        }
        // 12 px — «почти попал»: прицеливаться в точку 3 px мышью невозможно
        if (near && near.d <= 12 && near.n.label) {
          const tail = near.n.id ? " · нажми" : "";
          const text = near.n.pending
            ? `${near.n.label} · ещё не мерили${tail}`
            : near.n.ms === null
              ? `${near.n.label} · нет ответа${tail}`
              : near.n.stale
                ? `${near.n.label} · ${near.n.ms} мс (давно)${tail}`
                : `${near.n.label} · ${near.n.ms} мс${tail}`;
          ctx.font = "600 11px system-ui, sans-serif";
          const w = ctx.measureText(text).width + 14;
          const h = 20;
          let bx = near.x - w / 2;
          let by = near.y - 26;
          if (bx < 6) bx = 6;
          if (bx + w > size - 6) bx = size - 6 - w;
          if (by < 6) by = near.y + 14;
          ctx.fillStyle = "rgba(10,7,16,.92)";
          ctx.strokeStyle = "rgba(57,255,20,.35)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          // скруглённый прямоугольник без ручной геометрии радиуса
          const r = 7;
          ctx.moveTo(bx + r, by);
          ctx.arcTo(bx + w, by, bx + w, by + h, r);
          ctx.arcTo(bx + w, by + h, bx, by + h, r);
          ctx.arcTo(bx, by + h, bx, by, r);
          ctx.arcTo(bx, by, bx + w, by, r);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "#e9eef7";
          ctx.textBaseline = "middle";
          ctx.fillText(text, bx + 7, by + h / 2 + 0.5);
        }
      }

      // --- вспышка в точке прибытия: «приехали»
      if (s.arrived > 0 && !reduce) {
        const age = (performance.now() - s.arrived) / 1000;
        if (age < 0.9) {
          const p = project(target ?? HOME, s.angle, s.tilt);
          if (p.z > 0.02) {
            const k = age / 0.9;
            ctx.globalAlpha = 0.55 * (1 - k);
            ctx.strokeStyle = accent;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(cx + p.x * R, cy - p.y * R, 8 + 30 * k, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }
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
          ctx.arc(x, y, 10 + pulse * 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 0.6;
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(x, y, 7, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.fillStyle = accent;
          ctx.beginPath();
          ctx.arc(x, y, 3.2, 0, Math.PI * 2);
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
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      if (vbo) gl.deleteBuffer(vbo);
      if (ubo) gl.deleteBuffer(ubo);
      if (ibo) gl.deleteBuffer(ibo);
      for (const tex of [day, water, lights, clouds, normal]) if (tex) gl.deleteTexture(tex);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [size, target, connected, variant]);

  // крутить мышью
  useEffect(() => {
    const canvas = overRef.current;
    if (!canvas) return;
    let dragging = false;
    let lastX = 0;
    let moved = 0;
    const down = (e: PointerEvent) => {
      dragging = true;
      moved = 0;
      lastX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
      state.current.hold = 0;
    };
    const move = (e: PointerEvent) => {
      // где курсор: нужно для подсказки над узлом
      const box = canvas.getBoundingClientRect();
      pointer.current = {
        x: ((e.clientX - box.left) / box.width) * size,
        y: ((e.clientY - box.top) / box.height) * size,
        inside: true,
      };
      if (!dragging) return;
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      moved += Math.abs(dx);
      state.current.angle -= dx * 0.35;
      state.current.goal = state.current.angle;
    };
    const leave = () => {
      pointer.current.inside = false;
    };
    const up = () => {
      // потянул шар — это не нажатие «включить»
      if (dragging && moved > 4) canvas.dataset.dragged = "1";
      dragging = false;
      // короткое нажатие по точке узла: выбираем сервер, а не включаем VPN
      const ptr = pointer.current;
      if (moved <= 4 && ptr.inside && onPickRef.current) {
        const hit = nearestWithin(hitRef.current, ptr.x, ptr.y);
        if (hit) {
          pickedAt = performance.now();
          onPickRef.current(hit.id);
        }
      }
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("pointerleave", leave);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("pointerleave", leave);
    };
  }, [size]);

  return (
    <div className={`globe globe-3d${variant === "cinematic" ? " cine" : ""}`} style={{ width: size, height: size }}>
      {variant === "cinematic" && <span className="globe-stars" aria-hidden />}
      <div className="globe-halo" aria-hidden />
      {!ready && <span className="globe-boot" aria-hidden />}
      <canvas
        ref={glRef}
        style={{ width: size, height: size, opacity: ready ? 1 : 0, transition: "opacity 0.45s ease" }}
        aria-hidden
      />
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