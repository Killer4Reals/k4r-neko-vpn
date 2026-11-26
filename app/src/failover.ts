/** Решения при неожиданном обрыве: без сети и таймеров, поэтому проверяются тестами. */

export type EngineState = "running" | "idle" | "error";

/**
 * Обрыв считается неожиданным, только если человек хотел туннель, движок уже
 * работал и статус перестал быть running. Ручное отключение сюда не попадает.
 */
export function unexpectedStop(
  want: "on" | "off" | null,
  wasRunning: boolean,
  state: EngineState,
): boolean {
  return want === "on" && wasRunning && state !== "running";
}

/**
 * Rust-супервизор поднимает тот же узел и меняет pid раньше, чем фронтенд
 * успевает увидеть idle/error. Смена pid при живом туннеле — тоже обрыв.
 */
export function engineRestarted(lastPid: number, pid: number, wasRunning: boolean): boolean {
  return wasRunning && lastPid > 0 && pid > 0 && pid !== lastPid;
}

/**
 * Кого поднять после обрыва: сначала живой узел с лучшим замером, затем любой
 * непроверенный, но не текущий и не карантинный. null — альтернатив нет.
 */
export function pickFailover<T extends { id: string }>(
  profiles: T[],
  currentId: string,
  lat: Record<string, number | null | undefined>,
  blocked: Set<string> = new Set(),
): T | null {
  const others = profiles.filter((p) => p.id !== currentId && !blocked.has(p.id));
  if (others.length === 0) return null;
  const alive = others
    .filter((p) => typeof lat[p.id] === "number" && (lat[p.id] as number) >= 0)
    .sort((a, b) => (lat[a.id] as number) - (lat[b.id] as number));
  return alive[0] ?? others[0] ?? null;
}
