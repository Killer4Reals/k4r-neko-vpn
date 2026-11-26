export function providerOf(host: string | undefined): string {
  const h = (host ?? "").trim().toLowerCase();
  if (!h) return "—";
  // IPv4/IPv6 буквально: домена нет, показываем как есть.
  if (/^[0-9.]+$/.test(h) || h.includes(":")) return h;
  const parts = h.split(".").filter(Boolean);
  if (parts.length <= 2) return h;
  return parts.slice(-2).join(".");
}
