// Подсказка «в буфере ссылка подписки»: не вставляем молча — показываем
// предложение, потому что буфер обмена общий для всей системы.

export type ClipKind = "sub" | "transfer" | "config" | "other";

const CONFIG = /^(vless|vmess|ss|ssr|trojan|hysteria2?|hy2|tuic):\/\//i;

/** null — пусто или слишком длинно: такое не предлагаем. */
export function classifyClip(text: string): ClipKind | null {
  const v = text.trim();
  if (!v || v.length > 8192) return null;
  if (v.startsWith("k4r://sub/")) return "transfer";
  if (CONFIG.test(v)) return "config";
  if (/^https?:\/\//i.test(v)) return "sub";
  return "other";
}

/** Предлагаем только подписку и перенос; своё же значение не предлагаем. */
export function shouldOffer(kind: ClipKind | null, text: string, current: string): boolean {
  if (kind !== "sub" && kind !== "transfer") return false;
  return text.trim() !== current.trim();
}
