/**
 * Звук региона: у Европы, Америки и Азии разные мотивы при подключении.
 *
 * Зачем: звук «подключился» одинаковый везде, а узел — это страна. Короткий
 * мотив в 300 мс даёт понять, куда подключился, не открывая глаза на экран.
 *
 * Данные и правила — здесь, синтез — в sound.ts: так мотивы проверяются тестами.
 */

export type Region = "eu" | "us" | "asia" | "other";

export type Tone = {
  /** Частота, Гц */
  hz: number;
  /** Длительность, секунды */
  dur: number;
  type: OscillatorType;
  /** Громкость относительно общей: мотив не должен бить в уши */
  gain: number;
  /** Куда скользит частота, если нужно */
  to?: number;
  /** Задержка от начала мотива, мс */
  delay?: number;
};

/** Азиатские страны: там «колокольчик», он заметно отличается по характеру. */
const ASIA = new Set([
  "jp", "kr", "cn", "hk", "tw", "sg", "th", "vn", "my", "id", "ph", "in", "kz", "ae", "il", "tr", "ge",
]);

/** Америка: две ноты вверх, как «готово» в старых интерфейсах. */
const AMERICAS = new Set(["us", "ca", "br", "ar", "cl", "mx", "pa", "co"]);

export function regionOf(cc: string | undefined | null): Region {
  const code = (cc ?? "").trim().toLowerCase();
  if (!code) return "other";
  if (ASIA.has(code)) return "asia";
  if (AMERICAS.has(code)) return "us";
  if (code === "ru" || code === "by" || code === "ua" || code === "md") return "other";
  // всё остальное, что похоже на европейский код, — Европа
  return "eu";
}

/** Мотив на регион: 2–3 ноты, не длиннее 0,4 с. */
export function motifOf(region: Region): Tone[] {
  switch (region) {
    case "asia":
      // колокольчик: высоко, коротко, с еле слышным «эхом»
      return [
        { hz: 1046, dur: 0.1, type: "sine", gain: 0.13 },
        { hz: 1568, dur: 0.16, type: "sine", gain: 0.09, delay: 85 },
        { hz: 2093, dur: 0.1, type: "sine", gain: 0.05, delay: 150 },
      ];
    case "us":
      return [
        { hz: 660, dur: 0.09, type: "sine", gain: 0.12 },
        { hz: 990, dur: 0.12, type: "sine", gain: 0.1, delay: 90 },
      ];
    case "eu":
      // тёплый бас: солиднее, чем «писк», и не путается с ошибкой
      return [
        { hz: 220, dur: 0.14, type: "triangle", gain: 0.16 },
        { hz: 330, dur: 0.16, type: "triangle", gain: 0.12, delay: 100 },
      ];
    default:
      // базовая пара нот: то же, что было до этой версии
      return [
        { hz: 620, dur: 0.12, type: "sine", gain: 0.16, to: 880 },
        { hz: 880, dur: 0.14, type: "sine", gain: 0.14, delay: 90 },
      ];
  }
}

/** Общая длительность мотива: нужна, чтобы не наложить его на себя же. */
export function motifLength(tones: Tone[]): number {
  return tones.reduce((max, t) => Math.max(max, (t.delay ?? 0) / 1000 + t.dur), 0);
}
