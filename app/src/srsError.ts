/**
 * Ошибки скачивания списков маршрутизации (.srs). Ядро грузит их само при
 * старте, и раньше любая беда выглядела одинаково: «движок не запустился».
 *
 * Разбор — по строкам sing-box: они стабильны («download rule-set»,
 * «decode rule-set», «unexpected status»), поэтому это чистая функция с тестами.
 */

export type SrsKind = "offline" | "timeout" | "http502" | "http" | "format" | "unknown";

/** Это вообще про список маршрутизации? Иначе не вмешиваемся в текст ошибки. */
export function looksLikeRuleSet(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("rule-set") ||
    text.includes("rule_set") ||
    text.includes(".srs") ||
    text.includes("rule set")
  );
}

export function classify(message: string): SrsKind {
  const text = message.toLowerCase();
  if (/\b502\b|bad gateway/.test(text)) return "http502";
  if (/unexpected status|status(code)?[\s:=]*\d{3}|сервер ответил\s*\d{3}/.test(text)) return "http";
  if (/i\/o timeout|context deadline|timed?\s*out|timeout/.test(text)) return "timeout";
  if (/invalid|decode|unmarshal|checksum|malformed|некорректн/.test(text)) return "format";
  if (/no such host|dial tcp|connection refused|network is unreachable|econnrefused/.test(text))
    return "offline";
  return "unknown";
}

/** Имя списка из сообщения ядра («geosite-category-ru»), если оно там есть. */
export function listName(message: string): string | null {
  const m = /rule[-_]?set(?:\[\d+\])?\s*\(([^)]+)\)/i.exec(message);
  return m?.[1] ?? null;
}

/** Подсказка-действие. */
export function hint(kind: SrsKind): string {
  switch (kind) {
    case "offline":
      return "Нет сети: список маршрутизации не скачался. Проверь интернет и подключись снова";
    case "timeout":
      return "Список маршрутизации не скачался вовремя — попробуй ещё раз через минуту";
    case "http502":
      return "CDN отдал 502 на список маршрутизации: это на их стороне, попробуй позже";
    case "http":
      return "Список маршрутизации не отдался — проверь, открывается ли ссылка списка в браузере";
    case "format":
      return "Файл списка битый: отключи списки в «Маршрутизации» или обнови подписку";
    default:
      return "Не удалось загрузить список маршрутизации";
  }
}

/** Готовый текст или null, если ошибка не про списки. */
export function describe(message: string): string | null {
  if (!looksLikeRuleSet(message)) return null;
  const kind = classify(message);
  const name = listName(message);
  const base = hint(kind);
  return name ? `${base} (${name})` : base;
}
