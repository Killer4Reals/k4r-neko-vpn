/**
 * Вид глобуса: неоновый шар из точек или «планета» — синий океан, материки
 * по биомам, атмосфера. Выбор запоминается и переключается без перезапуска.
 */

export type GlobeStyle = "neon" | "planet";

const KEY = "k4r.globe.style";
const EVENT = "k4r:globe-style";

export function globeStyle(): GlobeStyle {
  try {
    return localStorage.getItem(KEY) === "planet" ? "planet" : "neon";
  } catch {
    return "neon";
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
