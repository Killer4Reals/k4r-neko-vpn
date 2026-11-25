export type AuroraPhase = "idle" | "connecting" | "connected" | "error" | "guard";

export type AuroraTint = { from: number; to: number };

/**
 * Цвет фона: состояние важнее трафика — его видно боковым зрением, а цифры
 * человек читает отдельно. Оттенок в HSL, `to` меньше `from` — значит через 0.
 */
export function auroraTint(phase: AuroraPhase): AuroraTint {
  switch (phase) {
    case "connected":
      return { from: 96, to: 140 };
    case "connecting":
      return { from: 170, to: 210 };
    case "error":
      return { from: 340, to: 8 };
    case "guard":
      return { from: 340, to: 8 };
    default:
      return { from: 250, to: 292 };
  }
}

/**
 * Яркость 0..1: трафик добавляет жизни, но логарифмом — иначе на гигабите
 * фон превращается в прожектор, а на холостом ходе мигает от одного пакета.
 */
export function auroraIntensity(phase: AuroraPhase, down: number, up: number): number {
  const base =
    phase === "connected" ? 0.5 : phase === "connecting" ? 0.34 : phase === "error" || phase === "guard" ? 0.3 : 0.22;
  const rate = Math.max(0, down) + Math.max(0, up);
  const add = Math.min(0.4, Math.log10(1 + rate) / 8);
  return Math.min(1, base + add);
}

/** Выключатель живёт в localStorage: тема уже так хранится. */
const KEY = "k4r.aurora";

export function readAurora(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeAurora(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // приватный режим или запрет хранилища — фон просто не запомнится
  }
}
