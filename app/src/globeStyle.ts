/**
 * Вид глобуса: неоновая сетка из точек, спокойная «планета» или кинематик
 * с облаками и яркой атмосферой. Выбор запоминается и применяется без
 * перезапуска — через событие окна.
 */

export type GlobeStyle = "neon" | "planet" | "cinematic";

const KEY = "k4r.globe.style";
const EVENT = "k4r:globe-style";

/** Разбор сохранённого значения: старые ключи не должны кидать ошибку. */
export function normalizeGlobeStyle(value: string | null | undefined): GlobeStyle {
  if (value === "neon" || value === "planet" || value === "cinematic") return value;
  // «low-poly» больше не стиль: его место занял кинематик.
  if (value === "lowpoly") return "cinematic";
  return "planet";
}

export function globeStyle(): GlobeStyle {
  try {
    return normalizeGlobeStyle(localStorage.getItem(KEY));
  } catch {
    return "planet";
  }
}

export function setGlobeStyle(style: GlobeStyle) {
  try {
    localStorage.setItem(KEY, style);
  } catch {
    /* приватный режим — просто не запомним */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: style }));
}

export function onGlobeStyle(handler: (style: GlobeStyle) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent).detail as GlobeStyle);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
