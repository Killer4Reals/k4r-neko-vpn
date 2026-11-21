/**
 * Звук без файлов: короткие синтезированные сигналы через WebAudio.
 * В установщике 0 КБ, лицензий нет, громкость и «выключить» — в настройках.
 */

import { motifOf, regionOf, type Tone } from "./regionSound";

type Ctx = AudioContext | null;

const KEY_ON = "k4r.sound.on";
const KEY_VOL = "k4r.sound.volume";

let ctx: Ctx = null;
let muted = false;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

export function soundOn(): boolean {
  return localStorage.getItem(KEY_ON) !== "off";
}

export function setSoundOn(on: boolean) {
  localStorage.setItem(KEY_ON, on ? "on" : "off");
}

export function volume(): number {
  const raw = Number(localStorage.getItem(KEY_VOL));
  return Number.isFinite(raw) && raw > 0 ? Math.min(1, raw) : 0.3;
}

export function setVolume(v: number) {
  localStorage.setItem(KEY_VOL, String(Math.min(1, Math.max(0, v))));
}

/** Быстрое «заглушить» на экране боя (не меняет настройки навсегда). */
export function muteTemporarily(value: boolean) {
  muted = value;
}

export function isMuted(): boolean {
  return muted;
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number) {
  const ac = context();
  if (!ac) return;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ac.currentTime);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ac.currentTime + dur);
  g.gain.setValueAtTime(0.0001, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(gain, ac.currentTime + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  osc.connect(g).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + dur + 0.02);
}

function noise(dur: number, gain: number, filterHz: number) {
  const ac = context();
  if (!ac) return;
  const frames = Math.floor(ac.sampleRate * dur);
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = filterHz;
  const g = ac.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(ac.destination);
  src.start();
}

export type Sfx = "click" | "whoosh" | "impact" | "papers" | "connect" | "disconnect" | "error";

/**
 * Мягкий «вдох» в момент подключения: шум, пропущенный через низкие частоты, с
 * плавным подъёмом и спадом. Это не петля и не фон — один короткий выдох,
 * который делает момент «подключился» дороже, и не может залипнуть.
 */
function swell(v: number) {
  const ac = context();
  if (!ac) return;
  const dur = 1.15;
  const frames = Math.floor(ac.sampleRate * dur);
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // подъём за 0.25 с, плавный спад до нуля: без щелчка на конце
    const k = i / frames;
    const env = k < 0.22 ? k / 0.22 : Math.pow(1 - (k - 0.22) / 0.78, 1.6);
    data[i] = (Math.random() * 2 - 1) * env;
  }
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(420, ac.currentTime);
  filter.frequency.exponentialRampToValueAtTime(1400, ac.currentTime + 0.5);
  const g = ac.createGain();
  g.gain.value = 0.075 * v;
  src.connect(filter).connect(g).connect(ac.destination);
  src.start();
}

/** Один тон мотива: та же логика, что в tone(), но с задержкой. */
function playTone(t: Tone, v: number) {
  const ac = context();
  if (!ac) return;
  const at = ac.currentTime + (t.delay ?? 0) / 1000;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = t.type;
  osc.frequency.setValueAtTime(t.hz, at);
  if (t.to) osc.frequency.exponentialRampToValueAtTime(t.to, at + t.dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, t.gain * v), at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + t.dur);
  osc.connect(g).connect(ac.destination);
  osc.start(at);
  osc.stop(at + t.dur + 0.02);
}

/**
 * Звук подключения с мотивом региона: у Азии колокольчик, у Европы бас, у
 * Америки две ноты вверх. Один и тот же сигнал везде — это упущенная подсказка.
 */
export function playConnected(cc: string | undefined) {
  if (muted || !soundOn()) return;
  const ac = context();
  if (!ac) return;
  if (ac.state === "suspended") void ac.resume();
  const v = volume();
  // Сначала «вдох», потом мотив: так сигнал читается как событие, а не как нота
  swell(v);
  for (const t of motifOf(regionOf(cc))) playTone(t, v);
}

/** Проиграть звук, если звук включён и не заглушён на экране боя. */
export function play(sfx: Sfx) {
  if (muted || !soundOn()) return;
  const ac = context();
  if (!ac) return;
  if (ac.state === "suspended") void ac.resume();
  const v = volume();
  switch (sfx) {
    case "click":
      tone(520, 0.06, "triangle", 0.12 * v, 380);
      break;
    case "whoosh":
      noise(0.18, 0.18 * v, 900);
      break;
    case "impact":
      tone(90, 0.22, "sawtooth", 0.5 * v, 40);
      noise(0.12, 0.25 * v, 2200);
      break;
    case "papers":
      noise(0.35, 0.12 * v, 3200);
      break;
    case "connect":
      tone(620, 0.12, "sine", 0.16 * v, 880);
      window.setTimeout(() => tone(880, 0.14, "sine", 0.14 * v), 90);
      break;
    case "disconnect":
      tone(420, 0.16, "sine", 0.14 * v, 260);
      break;
    case "error":
      tone(180, 0.28, "square", 0.16 * v, 120);
      break;
  }
}
