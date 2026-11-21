/**
 * Сценарии: один клик вместо пяти переключателей.
 *
 * Зачем: у «поиграть» и «посмотреть кино» разные требования к туннелю, и каждый
 * раз вручную ставить DNS, IPv6 и автопереключение — это то, из-за чего такие
 * настройки в итоге не трогают вообще.
 *
 * Всё здесь — чистые данные и чистые функции: экран только рисует.
 */

export type ScenarioId = "game" | "stream" | "work";

export type ScenarioSettings = {
  /** Уходить с просевшего узла (нужно для кино, вредно в матче). */
  autoSwitchSlow: boolean;
  /** Блокировать IPv6 внутри туннеля. */
  blockIpv6: boolean;
  /** DNS: внутри туннеля или системный. */
  dnsMode: "tunnel" | "system";
  /** Игровой режим: быстрый узел при старте игры. */
  gameMode: boolean;
  /** Разделение по программам: «только выбранные» или «все, кроме». */
  splitMode: "only" | "all";
};

export type Scenario = {
  id: ScenarioId;
  /** Ключи i18n: название и объяснение в одну строку. */
  titleKey: string;
  hintKey: string;
  /** Значок из набора иконок приложения. */
  icon: "bolt" | "play" | "shield";
  settings: ScenarioSettings;
};

export const SCENARIOS: Scenario[] = [
  {
    id: "game",
    titleKey: "scGame",
    hintKey: "scGameHint",
    icon: "bolt",
    // В матче переключение на другой узел — это разрыв соединения, поэтому
    // автопереключение выключено, а игровой режим включён
    settings: { autoSwitchSlow: false, blockIpv6: true, dnsMode: "tunnel", gameMode: true, splitMode: "all" },
  },
  {
    id: "stream",
    titleKey: "scStream",
    hintKey: "scStreamHint",
    icon: "play",
    // Кино не любит обрывов: автопереключение спасает от «залипшего» узла
    settings: { autoSwitchSlow: true, blockIpv6: true, dnsMode: "tunnel", gameMode: false, splitMode: "all" },
  },
  {
    id: "work",
    titleKey: "scWork",
    hintKey: "scWorkHint",
    icon: "shield",
    // Работа: только выбранные программы через VPN, остальное напрямую —
    // так корпоративные принтеры и локалка не ломаются
    settings: { autoSwitchSlow: true, blockIpv6: true, dnsMode: "tunnel", gameMode: false, splitMode: "only" },
  },
];

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

/** Какие поля заданы сценарием — по ним считается «похож ли текущий режим». */
export function matches(s: Scenario, current: ScenarioSettings): boolean {
  return (
    s.settings.autoSwitchSlow === current.autoSwitchSlow &&
    s.settings.blockIpv6 === current.blockIpv6 &&
    s.settings.dnsMode === current.dnsMode &&
    s.settings.gameMode === current.gameMode &&
    s.settings.splitMode === current.splitMode
  );
}

/**
 * Какой сценарий сейчас активен. Если настройки смешаны руками, ни один не
 * подсвечиваем: пусть лучше не горит ничего, чем врёт «Игры».
 */
export function activeScenario(current: ScenarioSettings): ScenarioId | null {
  return SCENARIOS.find((s) => matches(s, current))?.id ?? null;
}

/** Что поменяется при выборе сценария — для подсказки «применено: …». */
export function changedKeys(current: ScenarioSettings, next: ScenarioSettings): (keyof ScenarioSettings)[] {
  const keys: (keyof ScenarioSettings)[] = ["autoSwitchSlow", "blockIpv6", "dnsMode", "gameMode", "splitMode"];
  return keys.filter((k) => current[k] !== next[k]);
}
