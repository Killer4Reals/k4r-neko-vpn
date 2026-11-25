/**
 * Сторож туннеля: «подключено» — это состояние движка, а не факт, что интернет
 * ходит. Провайдер умеет молча выкидывать трафик, ядро — падать, оставляя
 * галочку «connected». Сторож отличает три случая: связь жива, связь умерла
 * (тогда — на другой узел), ядро умерло (тогда — сразу перезапуск).
 *
 * Логика вынесена из App.tsx чистой функцией: у неё есть тесты, и её можно
 * проверить без окна и без сети.
 */

/** Сколько неудачных проб подряд считаем аварией. */
export const FAILS_TO_RESTART = 2;

/** Больше трёх перезапусков — это не сбой узла, а сломанная подписка. */
export const MAX_ATTEMPTS = 3;

export type WatchdogState = {
  /** неудачных проб подряд; успех обнуляет */
  fails: number;
  /** сколько перезапусков уже потрачено в этой аварии */
  attempts: number;
};

export const WATCHDOG_START: WatchdogState = { fails: 0, attempts: 0 };

export type WatchdogAction = "wait" | "restart" | "giveup";

export type WatchdogInput = {
  /** туннель считается поднятым */
  connected: boolean;
  /** движок реально работает */
  coreAlive: boolean;
  /** проба через туннель дошла до ответа */
  probeOk: boolean;
  state: WatchdogState;
};

/**
 * Один шаг сторожа. Возвращает новое состояние и что делать:
 * wait — ничего, restart — перезапустить на другом узле,
 * giveup — попытки кончились, надо честно сказать человеку.
 */
export function watchdogStep(input: WatchdogInput): {
  state: WatchdogState;
  action: WatchdogAction;
} {
  if (!input.connected) return { state: WATCHDOG_START, action: "wait" };
  if (input.probeOk) return { state: WATCHDOG_START, action: "wait" };
  // Без живого ядра вторая проба ничего не добавит: трафика нет уже сейчас.
  const fails = input.coreAlive
    ? input.state.fails + 1
    : Math.max(FAILS_TO_RESTART, input.state.fails + 1);
  if (fails < FAILS_TO_RESTART) {
    return { state: { fails, attempts: input.state.attempts }, action: "wait" };
  }
  if (input.state.attempts >= MAX_ATTEMPTS) {
    return { state: { fails: 0, attempts: input.state.attempts }, action: "giveup" };
  }
  return { state: { fails: 0, attempts: input.state.attempts + 1 }, action: "restart" };
}
