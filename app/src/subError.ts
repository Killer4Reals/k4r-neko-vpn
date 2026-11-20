/**
 * Почему не загрузился список серверов. Панели отвечают по-разному, а человеку
 * нужно действие, а не текст ошибки: «нет сети» и «панель лежит» лечатся
 * разными способами.
 *
 * Разбор — по сообщениям, которые приходят из Rust: они стабильны, это наши же
 * строки. Чистая функция, поэтому покрыта тестами.
 */

export type SubErrorKind =
  | "offline"
  | "timeout"
  | "http502"
  | "http"
  | "format"
  | "empty"
  | "provider"
  | "unknown";

/** Ключ подсказки в i18n (без префикса). */
export type SubErrorInfo = { kind: SubErrorKind; hint: string };

export function classify(message: string): SubErrorKind {
  const text = message.toLowerCase();
  // Порядок важен: сетевые ошибки часто содержат слово «connect», а панель —
  // код ответа. Сначала самое конкретное.
  if (/сервер ответил\s*502|bad gateway|502/.test(text)) return "http502";
  if (/сервер ответил\s*\d{3}|status(code)?\s*\d{3}/.test(text)) return "http";
  if (/время ожидания|timed?\s*out|timeout|deadline/.test(text)) return "timeout";
  if (/некорректный json|invalid json|unexpected (token|character)|json/.test(text)) return "format";
  if (/нет серверов|серверов[^.]{0,24}нет|пуст|no servers|empty/.test(text)) return "empty";
  if (/провайдер:|placeholder/.test(text)) return "provider";
  if (/сеть недоступна|dns|econnrefused|econnreset|unreachable|network|failed to connect/.test(text))
    return "offline";
  return "unknown";
}

/** Подсказка-действие для каждого случая. */
export function hint(kind: SubErrorKind): string {
  switch (kind) {
    case "offline":
      // Домены подписок в РФ часто режут по SNI: напрямую не открывается, а
      // через туннель — открывается. Без этой подсказки человек видит «нет сети»
      // и не понимает, что делать.
      return "адрес панели не открывается напрямую — включи любой сервер и нажми «Обновить»";
    case "timeout":
      return "панель не ответила вовремя — попробуй ещё раз через минуту";
    case "http502":
      return "у панели сбой (502): это на её стороне, попробуй позже";
    case "http":
      return "панель ответила отказом — проверь срок подписки и лимит устройств";
    case "format":
      return "ответ не похож на список серверов — проверь ссылку подписки";
    case "empty":
      return "список пуст: в кабинете провайдера нет активных серверов";
    case "provider":
      return "провайдер отказал: смотри его текст ниже";
    default:
      return "не удалось загрузить список";
  }
}

/** Человеческая строка: что случилось + что делать. */
export function describe(message: string): { kind: SubErrorKind; text: string } {
  const kind = classify(message);
  const base = hint(kind);
  const raw = message.trim();
  return {
    kind,
    text: raw && !raw.includes(base) ? `${base}. Ответ: ${raw}` : base,
  };
}
