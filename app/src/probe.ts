/**
 * Проверка «через туннель реально ходит интернет». Используем лёгкие адреса,
 * которые отдают 204 без тела: трафика почти нет, а ответ честный.
 *
 * Если сеть заблокирована kill-switch'ем — проба просто не пройдёт, и это
 * правильно: обходить защиту мы не будем.
 */

export const PROBE_URLS = [
  "https://www.gstatic.com/generate_204",
  "https://cp.cloudflare.com/generate_204",
  "https://connectivitycheck.gstatic.com/generate_204",
];

export type ProbeResult = { ok: boolean; ms: number };

/**
 * Одна проба: гоняем адреса по очереди, пока какой-нибудь не ответит.
 * `fetchImpl` вынесен, чтобы тесты не ходили в сеть.
 */
export async function probeOnce(
  fetchImpl: typeof fetch = fetch,
  urls: string[] = PROBE_URLS,
  timeoutMs = 4000,
): Promise<ProbeResult> {
  for (const url of urls) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        cache: "no-store",
        signal: controller.signal,
        // Не тянем за собой куки и реферер: это проверка, а не визит.
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (res.ok) return { ok: true, ms: Date.now() - started };
    } catch {
      // пробуем следующий адрес
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, ms: 0 };
}
