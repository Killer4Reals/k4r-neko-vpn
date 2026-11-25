/** Заставка: 1.2 с — глаз успевает поймать маскота, и это не заставляет ждать. */
export const SPLASH_MS = 1200;

/** При «уменьшить движение» заставка не мигает — остаётся только пауза. */
export const SPLASH_SHORT_MS = 200;

export function splashDelay(reduce: boolean): number {
  return reduce ? SPLASH_SHORT_MS : SPLASH_MS;
}
