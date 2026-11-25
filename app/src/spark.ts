export const SPARK_CAP = 12;

/** Последние замеры задержки: null — узел не ответил, это разрыв, а не ноль. */
export type Spark = (number | null)[];
export type Sparks = Record<string, Spark>;

/** Кольцевой буфер на узел: старые замеры вытесняются, память не растёт. */
export function pushSpark(sparks: Sparks, id: string, ms: number | null, cap = SPARK_CAP): Sparks {
  const prev = sparks[id] ?? [];
  const next = [...prev, ms].slice(-cap);
  return { ...sparks, [id]: next };
}

/**
 * Точки для SVG: медленный узел рисуется выше — плохое видно сразу, а не
 * после чтения цифры. Нормализуем к собственному минимуму и максимуму окна,
 * поэтому линия «дышит» даже когда узел стабильно 40 мс.
 */
export function sparkPoints(values: Spark, w: number, h: number): string {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return "";
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts: string[] = [];
  values.forEach((v, i) => {
    if (v === null) return;
    const x = (i * step).toFixed(1);
    const y = (h - ((v - min) / span) * h).toFixed(1);
    pts.push(`${x},${y}`);
  });
  return pts.join(" ");
}

export type SparkTone = "none" | "ok" | "warn" | "bad";

/** Порог грубый намеренно: цвет — подсказка, точная цифра рядом. */
export function sparkTone(ms: number | null | undefined): SparkTone {
  if (ms === null || ms === undefined) return "none";
  if (ms < 120) return "ok";
  if (ms < 300) return "warn";
  return "bad";
}
