package ink.k4r.nekoneko.data

/**
 * Каталог публичных DNS — тот же, что в Windows-версии. У каждой записи три
 * способа: обычный адрес, DoH и DoT; приложение подставляет выбранное значение
 * в настройку, а движок понимает и адрес, и URL.
 */
data class DnsEntry(
    val id: String,
    val owner: String,
    val noteRu: String,
    val noteEn: String,
    val plain: String,
    val doh: String,
    val dot: String,
    val star: Boolean = false,
)

data class DnsGroup(
    val id: String,
    val titleRu: String,
    val titleEn: String,
    val hintRu: String,
    val hintEn: String,
    val items: List<DnsEntry>,
)

object DnsCatalog {

    val groups: List<DnsGroup> = listOf(
        DnsGroup(
            id = "fast",
            titleRu = "Быстрые, без фильтров",
            titleEn = "Fast, no filtering",
            hintRu = "Отдают всё как есть: ни рекламу, ни фишинг не блокируют. Самый предсказуемый выбор, если фильтрация не нужна",
            hintEn = "They hand back everything as is and block nothing. The most predictable choice when you do not want filtering",
            items = listOf(
                DnsEntry(
                    id = "cloudflare",
                    owner = "Cloudflare",
                    noteRu = "Один из самых быстрых в Европе, сеть anycast",
                    noteEn = "One of the fastest in Europe, anycast network",
                    plain = "1.1.1.1",
                    doh = "https://cloudflare-dns.com/dns-query",
                    dot = "tls://1.1.1.1",
                    star = true,
                ),
                DnsEntry(
                    id = "google",
                    owner = "Google",
                    noteRu = "Стабильный, хорошо отвечает из любой точки",
                    noteEn = "Steady answers from almost anywhere",
                    plain = "8.8.8.8",
                    doh = "https://dns.google/dns-query",
                    dot = "tls://dns.google",
                ),
                DnsEntry(
                    id = "quad9-open",
                    owner = "Quad9 Unfiltered",
                    noteRu = "Та же сеть Quad9, но без блокировки вредных доменов",
                    noteEn = "The Quad9 network without blocking bad domains",
                    plain = "9.9.9.10",
                    doh = "https://dns10.quad9.net/dns-query",
                    dot = "tls://dns10.quad9.net",
                ),
                DnsEntry(
                    id = "adguard-open",
                    owner = "AdGuard Unfiltered",
                    noteRu = "AdGuard без фильтров — только разрешение имён",
                    noteEn = "AdGuard with filtering switched off",
                    plain = "94.140.14.140",
                    doh = "https://unfiltered.adguard-dns.com/dns-query",
                    dot = "tls://unfiltered.adguard-dns.com",
                ),
                DnsEntry(
                    id = "opendns",
                    owner = "OpenDNS",
                    noteRu = "Старый и предсказуемый, есть защита от опечаток",
                    noteEn = "Old and predictable, fixes typos in addresses",
                    plain = "208.67.222.222",
                    doh = "https://doh.opendns.com/dns-query",
                    dot = "tls://doh.opendns.com",
                ),
            ),
        ),
        DnsGroup(
            id = "ads",
            titleRu = "Без рекламы и трекеров",
            titleEn = "No ads or trackers",
            hintRu = "Выкидывают рекламные и следящие домены ещё до загрузки страницы. Иногда вместе с рекламой пропадает нужная кнопка — это цена",
            hintEn = "They drop ad and tracking domains before a page loads. Sometimes a useful button disappears with the ads — that is the price",
            items = listOf(
                DnsEntry(
                    id = "adguard",
                    owner = "AdGuard",
                    noteRu = "Реклама, трекеры, аналитика. Лучший баланс для повседневного",
                    noteEn = "Ads, trackers, analytics. The best everyday balance",
                    plain = "94.140.14.14",
                    doh = "https://dns.adguard-dns.com/dns-query",
                    dot = "tls://dns.adguard-dns.com",
                    star = true,
                ),
                DnsEntry(
                    id = "mullvad-adblock",
                    owner = "Mullvad Adblock",
                    noteRu = "Блокирует рекламу, открыт для всех без аккаунта",
                    noteEn = "Blocks ads and is open to anyone without an account",
                    plain = "194.242.2.3",
                    doh = "https://adblock.dns.mullvad.net/dns-query",
                    dot = "tls://adblock.dns.mullvad.net",
                ),
            ),
        ),
        DnsGroup(
            id = "guard",
            titleRu = "Против вирусов и фишинга",
            titleEn = "Against malware and phishing",
            hintRu = "Не пускают на известные вредоносные домены. Для банка и почты — самое то, для отладки сайтов — мешает",
            hintEn = "They refuse known malicious domains. Great for banking and mail, annoying when debugging a site",
            items = listOf(
                DnsEntry(
                    id = "quad9",
                    owner = "Quad9",
                    noteRu = "Некоммерческий, сверяется с базой вредоносных доменов",
                    noteEn = "Non-profit, checks against a malware domain list",
                    plain = "9.9.9.9",
                    doh = "https://dns.quad9.net/dns-query",
                    dot = "tls://dns.quad9.net",
                    star = true,
                ),
                DnsEntry(
                    id = "cloudflare-security",
                    owner = "Cloudflare Security",
                    noteRu = "Тот же быстрый Cloudflare, но с блокировкой вредного",
                    noteEn = "The same fast Cloudflare with malicious hosts blocked",
                    plain = "1.1.1.2",
                    doh = "https://security.cloudflare-dns.com/dns-query",
                    dot = "tls://security.cloudflare-dns.com",
                ),
            ),
        ),
        DnsGroup(
            id = "family",
            titleRu = "Семейные",
            titleEn = "Family",
            hintRu = "Кроме вредного режут взрослые сайты. Ставь, если за этим компьютером бывают дети",
            hintEn = "They cut adult sites as well as malicious ones. Use it if children use this computer",
            items = listOf(
                DnsEntry(
                    id = "cloudflare-family",
                    owner = "Cloudflare Family",
                    noteRu = "Вредное и взрослое, плюс безопасный поиск",
                    noteEn = "Malware, adult content and safe search",
                    plain = "1.1.1.3",
                    doh = "https://family.cloudflare-dns.com/dns-query",
                    dot = "tls://family.cloudflare-dns.com",
                    star = true,
                ),
                DnsEntry(
                    id = "adguard-family",
                    owner = "AdGuard Family",
                    noteRu = "Реклама, трекеры и взрослые сайты одним пакетом",
                    noteEn = "Ads, trackers and adult sites in one package",
                    plain = "94.140.14.15",
                    doh = "https://family.adguard-dns.com/dns-query",
                    dot = "tls://family.adguard-dns.com",
                ),
                DnsEntry(
                    id = "mullvad-family",
                    owner = "Mullvad Family",
                    noteRu = "Семейный вариант от Mullvad, без аккаунта",
                    noteEn = "Mullvad's family resolver, no account needed",
                    plain = "194.242.2.4",
                    doh = "https://family.dns.mullvad.net/dns-query",
                    dot = "tls://family.dns.mullvad.net",
                ),
            ),
        ),
    )

    fun all(): List<DnsEntry> = groups.flatMap { it.items }

    /** Запись по любому из её значений — чтобы подсветить, что уже выбрано. */
    fun find(value: String): DnsEntry? = all().firstOrNull {
        it.plain == value || it.doh == value || it.dot == value
    }
}
