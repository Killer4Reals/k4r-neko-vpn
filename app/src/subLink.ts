// Перенос подписки с ПК на телефон: короткая ссылка k4r://sub/<base64url>.
// Почему не просто URL подписки: вместе с адресом переносим выбранный узел,
// иначе на телефоне человек снова ищет тот же город глазами.

export type SubLink = {
  /** Адрес подписки, http(s). */
  u: string;
  /** User-Agent подписки, если провайдер его требует. */
  ua?: string;
  /** id узла, который был выбран на ПК. */
  id?: string;
};

const PREFIX = "k4r://sub/";

function b64url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): string | null {
  try {
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** Только http(s) с хостом: k4r:// не должен нести file: или javascript:. */
export function isSubUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return (u.protocol === "https:" || u.protocol === "http:") && !!u.hostname;
  } catch {
    return false;
  }
}

export function encodeSubLink(link: SubLink): string {
  const body: SubLink = { u: link.u.trim() };
  if (link.ua?.trim()) body.ua = link.ua.trim();
  if (link.id?.trim()) body.id = link.id.trim();
  return PREFIX + b64url(JSON.stringify(body));
}

/** null — битая ссылка; молча чинить её нельзя, иначе перенесётся мусор. */
export function decodeSubLink(text: string): SubLink | null {
  const raw = text.trim();
  if (!raw.startsWith(PREFIX)) return null;
  const json = unb64url(raw.slice(PREFIX.length));
  if (!json) return null;
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  if (typeof o.u !== "string" || !isSubUrl(o.u)) return null;
  const out: SubLink = { u: o.u.trim() };
  if (typeof o.ua === "string" && o.ua.trim()) out.ua = o.ua.trim();
  if (typeof o.id === "string" && o.id.trim()) out.id = o.id.trim();
  return out;
}
