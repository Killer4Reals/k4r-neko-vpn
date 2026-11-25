// Память «сеть → узел»: дома, в кафе и в офисе нужны разные серверы, и каждый
// раз искать один и тот же город руками — это то, за что VPN не любят.

export type NetMap = Record<string, string>;

export const NET_KEY = "k4r.netmem";

/** Пустой ключ или id ничего не помнит: «нет сети» — не сеть. */
export function remember(map: NetMap, key: string, id: string): NetMap {
  const k = key.trim();
  const v = id.trim();
  if (!k || !v) return map;
  if (map[k] === v) return map;
  return { ...map, [k]: v };
}

export function recall(map: NetMap, key: string): string | null {
  const hit = map[key.trim()];
  return hit && hit.trim() ? hit : null;
}

/** Короткая подпись сети для интерфейса: IP шлюза, без хвостов. */
export function shortNet(key: string): string {
  const v = key.trim();
  if (!v) return "—";
  // «192.168.1.1:0» / «fe80::1%12» — показываем только адрес
  return v.replace(/:\d+$/, "").replace(/%\w+$/, "");
}
