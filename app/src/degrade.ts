// Сеть «дышит»: секундные просадки — норма, а вот ровное падение скорости
// на минуты значит, что узел пора менять. Задержка такое не ловит: сервер
// может отвечать быстро и отдавать 50 КБ/с.

export type DegradeOpts = {
  /** Сколько секунд держится просадка, прежде чем это повод переключиться. */
  hold?: number;
  /** Доля от пика, ниже которой канал считается просевшим. */
  ratio?: number;
  /** Пик меньше этого — не «медленно», а «тихо»: переключение не поможет. */
  floorBytes?: number;
};

export function pushRate(samples: number[], rate: number, cap = 30): number[] {
  const next = [...samples, Number.isFinite(rate) && rate > 0 ? rate : 0];
  return next.slice(-cap);
}

export function isDegraded(samples: number[], opts: DegradeOpts = {}): boolean {
  const hold = opts.hold ?? 8;
  const ratio = opts.ratio ?? 0.3;
  const floor = opts.floorBytes ?? 300 * 1024;
  if (samples.length < hold * 2) return false;
  const peak = Math.max(...samples);
  if (peak < floor) return false;
  const tail = samples.slice(-hold);
  const median = [...tail].sort((a, b) => a - b)[Math.floor(hold / 2)];
  return median < peak * ratio;
}
