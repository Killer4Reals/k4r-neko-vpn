export const ONBOARD_KEY = "k4r.onboarding";

export type OnboardStep = { titleKey: string; bodyKey: string; pose: number };

/** Три шага: что это, что защищает, что не уходит наружу. */
export const ONBOARD_STEPS: OnboardStep[] = [
  { titleKey: "ob1Title", bodyKey: "ob1Body", pose: 1 },
  { titleKey: "ob2Title", bodyKey: "ob2Body", pose: 3 },
  { titleKey: "ob3Title", bodyKey: "ob3Body", pose: 5 },
];

/** Первый запуск: флаг не стоит — показываем. Битое значение считаем «не проходил». */
export function needOnboard(stored: string | null): boolean {
  return stored !== "1";
}

/** Шаг вперёд/назад в границах; круговая навигация тут путает. */
export function nextStep(i: number, dir: 1 | -1, total = ONBOARD_STEPS.length): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(total - 1, i + dir));
}
