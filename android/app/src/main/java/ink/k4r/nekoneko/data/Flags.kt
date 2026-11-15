package ink.k4r.nekoneko.data

/**
 * Флаги стран. На Android эмодзи-флаги рисуются системным шрифтом, поэтому
 * отдельные картинки не нужны: код страны превращается в пару региональных
 * символов. Если страну не узнали — флага нет, интерфейс покажет глобус.
 */
object Flags {

    private val known = setOf(
        "ru", "fi", "gb", "nl", "pl", "de", "es", "fr", "se", "tr", "us", "ca", "jp",
        "sg", "hk", "ch", "at", "it", "lv", "lt", "ee", "ua", "kz", "am", "ge", "rs",
        "ro", "bg", "cz", "hu", "cy", "md", "uz", "vn", "in", "id", "my", "th", "au",
        "br", "ar", "mx", "il", "ae", "za", "ng", "no", "dk", "by",
    )

    private val words = listOf(
        Regex("финлянд|хельсинк|finland|helsink", RegexOption.IGNORE_CASE) to "fi",
        Regex("лондон|англи|британ|london|england|britain", RegexOption.IGNORE_CASE) to "gb",
        Regex("нидерланд|амстердам|голланд|netherland|amsterdam", RegexOption.IGNORE_CASE) to "nl",
        Regex("польш|варшав|poland|warsaw", RegexOption.IGNORE_CASE) to "pl",
        Regex("герман|франкфурт|берлин|germany|frankfurt|berlin", RegexOption.IGNORE_CASE) to "de",
        Regex("испан|мадрид|spain|madrid", RegexOption.IGNORE_CASE) to "es",
        Regex("франц|париж|france|paris", RegexOption.IGNORE_CASE) to "fr",
        Regex("швец|стокгольм|sweden|stockholm", RegexOption.IGNORE_CASE) to "se",
        Regex("турци|стамбул|turkey|istanbul", RegexOption.IGNORE_CASE) to "tr",
        Regex("сша|америк|нью-йорк|usa|united states|new york", RegexOption.IGNORE_CASE) to "us",
        Regex("канад|canada", RegexOption.IGNORE_CASE) to "ca",
        Regex("япон|токио|japan|tokyo", RegexOption.IGNORE_CASE) to "jp",
        Regex("сингапур|singapore", RegexOption.IGNORE_CASE) to "sg",
        Regex("гонконг|hong kong", RegexOption.IGNORE_CASE) to "hk",
    )

    /** Код страны из имени сервера, как в Windows-версии. */
    fun ccFromName(name: String?): String? {
        val text = name?.trim().orEmpty()
        if (text.isEmpty()) return null
        regional(text)?.let { return it }
        val stripped = text.replace(LEAD_EMOJI, "").trim()
        val prefix = Regex("^([A-Za-z]{2})(?![A-Za-z])").find(stripped)
        if (prefix != null) {
            val cc = prefix.groupValues[1].lowercase()
            if (cc in known) return cc
        }
        for ((re, cc) in words) if (re.containsMatchIn(stripped)) return cc
        return null
    }

    /** Имя сервера без служебного кода и эмодзи: «🇫🇮 Финляндия» → «Финляндия». */
    fun stripCc(name: String?): String {
        var text = name?.trim().orEmpty()
        if (regional(text) != null) text = text.removePrefix(text.take(2)).trim()
        text = text.replace(LEAD_EMOJI, "").trim()
        val m = Regex("^([A-Za-z]{2})(?![A-Za-z])\s*[-–—·:]?\s*(.+)$").find(text)
        if (m != null && m.groupValues[1].lowercase() in known) text = m.groupValues[2].trim()
        return text.replace(TAIL_EMOJI, "").trim()
    }

    /** Эмодзи-флаг из кода страны; null, если кода нет. */
    fun emoji(cc: String?): String? {
        val code = cc?.lowercase()?.takeIf { it.length == 2 && it.all { ch -> ch in 'a'..'z' } } ?: return null
        val base = 0x1F1E6 - 'a'.code
        val first = Character.toChars(base + code[0].code)
        val second = Character.toChars(base + code[1].code)
        return String(first) + String(second)
    }

    private fun regional(text: String): String? {
        if (text.length < 2) return null
        val a = text[0].code
        val b = text[1].code
        val lo = 0x1F1E6
        val hi = 0x1F1FF
        if (a !in lo..hi || b !in lo..hi) return null
        val cc = (('a'.code + (a - lo)).toChar()).toString() + ('a'.code + (b - lo)).toChar()
        return cc.takeIf { it in known }
    }

    private val LEAD_EMOJI = Regex("^[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\s]+")
    private val TAIL_EMOJI = Regex("[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\s]+$")
}
