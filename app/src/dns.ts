// Каталог публичных DNS. У каждого — три способа подключения: обычный адрес,
// DNS через HTTPS и DNS через TLS. Приложение подставляет выбранное значение в
// dns_server и дальше уже не важно, что это было: движок понимает и адрес, и URL.
//
// Данные проверяемые: адреса и хосты публичных резолверов, никаких выдуманных.
// Если резолвер платный или требует личного ID (NextDNS), его здесь нет.

export type DnsProof = "plain" | "doh" | "dot";

export type DnsEntry = {
  id: string;
  /** кто держит резолвер */
  owner: string;
  /** короткая подпись, чем он отличается */
  note: { ru: string; en: string };
  plain: string;
  doh: string;
  dot: string;
  /** главный сервер в категории — показываем первым и подсвечиваем */
  star?: boolean;
};

export type DnsGroup = {
  id: string;
  title: { ru: string; en: string };
  hint: { ru: string; en: string };
  items: DnsEntry[];
};

export const dnsGroups: DnsGroup[] = [
  {
    id: "fast",
    title: { ru: "Быстрые, без фильтров", en: "Fast, no filtering" },
    hint: {
      ru: "Отдают всё как есть: ни рекламу, ни фишинг не блокируют. Самый предсказуемый выбор, если фильтрация не нужна",
      en: "They hand back everything as is and block nothing. The most predictable choice when you do not want filtering",
    },
    items: [
      {
        id: "cloudflare",
        owner: "Cloudflare",
        note: { ru: "Один из самых быстрых в Европе, сеть anycast", en: "One of the fastest in Europe, anycast network" },
        plain: "1.1.1.1",
        doh: "https://cloudflare-dns.com/dns-query",
        dot: "tls://1.1.1.1",
        star: true,
      },
      {
        id: "google",
        owner: "Google",
        note: { ru: "Стабильный, хорошо отвечает из любой точки", en: "Steady answers from almost anywhere" },
        plain: "8.8.8.8",
        doh: "https://dns.google/dns-query",
        dot: "tls://dns.google",
      },
      {
        id: "quad9-open",
        owner: "Quad9 Unfiltered",
        note: { ru: "Та же сеть Quad9, но без блокировки вредных доменов", en: "The Quad9 network without blocking bad domains" },
        plain: "9.9.9.10",
        doh: "https://dns10.quad9.net/dns-query",
        dot: "tls://dns10.quad9.net",
      },
      {
        id: "adguard-open",
        owner: "AdGuard Unfiltered",
        note: { ru: "AdGuard без фильтров — только разрешение имён", en: "AdGuard with filtering switched off" },
        plain: "94.140.14.140",
        doh: "https://unfiltered.adguard-dns.com/dns-query",
        dot: "tls://unfiltered.adguard-dns.com",
      },
      {
        id: "opendns",
        owner: "OpenDNS",
        note: { ru: "Старый и предсказуемый, есть защита от опечаток", en: "Old and predictable, fixes typos in addresses" },
        plain: "208.67.222.222",
        doh: "https://doh.opendns.com/dns-query",
        dot: "tls://doh.opendns.com",
      },
    ],
  },
  {
    id: "ads",
    title: { ru: "Без рекламы и трекеров", en: "No ads or trackers" },
    hint: {
      ru: "Выкидывают рекламные и следящие домены ещё до загрузки страницы. Иногда вместе с рекламой пропадает нужная кнопка — это цена",
      en: "They drop ad and tracking domains before a page loads. Sometimes a useful button disappears with the ads — that is the price",
    },
    items: [
      {
        id: "adguard",
        owner: "AdGuard",
        note: { ru: "Реклама, трекеры, аналитика. Лучший баланс для повседневного", en: "Ads, trackers, analytics. The best everyday balance" },
        plain: "94.140.14.14",
        doh: "https://dns.adguard-dns.com/dns-query",
        dot: "tls://dns.adguard-dns.com",
        star: true,
      },
      {
        id: "mullvad-adblock",
        owner: "Mullvad Adblock",
        note: { ru: "Блокирует рекламу, открыт для всех без аккаунта", en: "Blocks ads and is open to anyone without an account" },
        plain: "194.242.2.3",
        doh: "https://adblock.dns.mullvad.net/dns-query",
        dot: "tls://adblock.dns.mullvad.net",
      },
    ],
  },
  {
    id: "guard",
    title: { ru: "Против вирусов и фишинга", en: "Against malware and phishing" },
    hint: {
      ru: "Не пускают на известные вредоносные домены. Для банка и почты — самое то, для отладки сайтов — мешает",
      en: "They refuse known malicious domains. Great for banking and mail, annoying when debugging a site",
    },
    items: [
      {
        id: "quad9",
        owner: "Quad9",
        note: { ru: "Некоммерческий, сверяется с базой вредоносных доменов", en: "Non-profit, checks against a malware domain list" },
        plain: "9.9.9.9",
        doh: "https://dns.quad9.net/dns-query",
        dot: "tls://dns.quad9.net",
        star: true,
      },
      {
        id: "cloudflare-security",
        owner: "Cloudflare Security",
        note: { ru: "Тот же быстрый Cloudflare, но с блокировкой вредного", en: "The same fast Cloudflare with malicious hosts blocked" },
        plain: "1.1.1.2",
        doh: "https://security.cloudflare-dns.com/dns-query",
        dot: "tls://security.cloudflare-dns.com",
      },
    ],
  },
  {
    id: "family",
    title: { ru: "Семейные", en: "Family" },
    hint: {
      ru: "Кроме вредного режут взрослые сайты. Ставь, если за этим компьютером бывают дети",
      en: "They cut adult sites as well as malicious ones. Use it if children use this computer",
    },
    items: [
      {
        id: "cloudflare-family",
        owner: "Cloudflare Family",
        note: { ru: "Вредное и взрослое, плюс безопасный поиск", en: "Malware, adult content and safe search" },
        plain: "1.1.1.3",
        doh: "https://family.cloudflare-dns.com/dns-query",
        dot: "tls://family.cloudflare-dns.com",
        star: true,
      },
      {
        id: "adguard-family",
        owner: "AdGuard Family",
        note: { ru: "Реклама, трекеры и взрослые сайты одним пакетом", en: "Ads, trackers and adult sites in one package" },
        plain: "94.140.14.15",
        doh: "https://family.adguard-dns.com/dns-query",
        dot: "tls://family.adguard-dns.com",
      },
      {
        id: "mullvad-family",
        owner: "Mullvad Family",
        note: { ru: "Семейный вариант от Mullvad, без аккаунта", en: "Mullvad's family resolver, no account needed" },
        plain: "194.242.2.4",
        doh: "https://family.dns.mullvad.net/dns-query",
        dot: "tls://family.dns.mullvad.net",
      },
    ],
  },
];

export const allDns = dnsGroups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.id })));

/** Какое значение сейчас стоит в настройках: адрес, DoH, DoT или своё. */
export function proofOf(value: string): DnsProof | "own" {
  const text = (value ?? "").trim().toLowerCase();
  if (!text) return "own";
  if (text.startsWith("https://")) {
    return allDns.some((d) => d.doh.toLowerCase() === text) ? "doh" : "own";
  }
  if (text.startsWith("tls://")) {
    return allDns.some((d) => d.dot.toLowerCase() === text) ? "dot" : "own";
  }
  if (allDns.some((d) => d.plain === text)) return "plain";
  return "own";
}

/** Какой резолвер выбран, если он из каталога. */
export function entryOf(value: string): string | null {
  const text = (value ?? "").trim().toLowerCase();
  const hit = allDns.find(
    (d) => d.plain === text || d.doh.toLowerCase() === text || d.dot.toLowerCase() === text,
  );
  return hit ? hit.id : null;
}

/** Человеческая подпись протокола для плашки под адресом. */
export function proofLabel(p: DnsProof): string {
  return p === "doh" ? "DoH" : p === "dot" ? "DoT" : "IP";
}
