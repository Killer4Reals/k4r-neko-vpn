package ink.k4r.nekoneko.data

/**
 * Флаги стран. На Android эмодзи-флаги рисуются системным шрифтом, поэтому
 * отдельные картинки не нужны: код страны превращается в пару региональных
 * символов. Если страну не узнали, интерфейс покажет глобус.
 *
 * Имена приходят от провайдера вида «🇫🇮 Финляндия» или «FI Финляндия», поэтому
 * код достаём из эмодзи, из двух латинских букв или из названия страны.
 */
object Flags {

    private val known = setOf(
        "ru", "fi", "gb", "nl", "pl", "de", "es", "fr", "se", "tr", "us", "ca", "jp",
        "sg", "hk", "ch", "at", "it", "lv", "lt", "ee", "ua", "kz", "am", "ge", "rs",
        "ro", "bg", "cz", "hu", "cy", "md", "uz", "vn", "in", "id", "my", "th", "au",
        "br", "ar", "mx", "il", "ae", "za", "ng", "no", "dk", "by",
    )

    private val words = listOf(
        "финлянд|хельсинк|finland|helsink" to "fi",
        "лондон|англи|британ|london|england|britain" to "gb",
        "нидерланд|амстердам|голланд|netherland|amsterdam" to "nl",
        "польш|варшав|poland|warsaw" to "pl",
        "герман|франкфурт|берлин|germany|frankfurt|berlin" to "de",
        "испан|мадрид|spain|madrid" to "es",
        "франц|париж|france|paris" to "fr",
        "швец|стокгольм|sweden|stockholm" to "se",
        "турци|стамбул|turkey|istanbul" to "tr",
        "сша|америк|нью-йорк|usa|united states|new york" to "us",
        "канад|canada" to "ca",
        "япон|токио|japan|tokyo" to "jp",
        "сингапур|singapore" to "sg",
        "гонконг|hong kong" to "hk",
        "швейцар|switzerland|zurich" to "ch",
        "австри|austria|vienna" to "at",
        "итали|милан|italy|milan" to "it",
        "латви|рига|latvia|riga" to "lv",
        "литв|вильнюс|lithuania" to "lt",
        "эстони|таллин|estonia" to "ee",
        "украин|киев|ukraine|kyiv" to "ua",
    )

    /** Код страны из имени сервера, как в Windows-версии. */
    fun ccFromName(name: String?): String? {
        val raw = name?.trim().orEmpty()
        if (raw.isEmpty()) return null
        ccFromRegional(raw)?.let { return it }
        val text = raw.dropWhile { isEmoji(it) }.trim()
        if (text.length >= 2) {
            val head = text.take(2).lowercase()
            val third = text.getOrNull(2)
            if (head in known && (third == null || !third.isLetter())) return head
        }
        for ((pattern, cc) in words) {
            if (Regex(pattern, RegexOption.IGNORE_CASE).containsMatchIn(text)) return cc
        }
        return null
    }

    /** Имя сервера без служебного кода и эмодзи: «🇫🇮 Финляндия» → «Финляндия». */
    fun stripCc(name: String?): String {
        var text = name?.trim().orEmpty()
        if (ccFromRegional(text) != null) {
            // флаг — это два суррогатных символа, в UTF-16 это 4 char-единицы
            text = text.drop(4).trim()
        }
        text = text.dropWhile { isEmoji(it) }.trim()
        if (text.length >= 3 && text.take(2).lowercase() in known && !text[2].isLetter()) {
            text = text.drop(2).trim().trimStart('-', '–', '—', '·', ':').trim()
        }
        text = text.trimEnd().dropLastWhile { isEmoji(it) }.trim()
        return text
    }

    /** Эмодзи-флаг из кода страны; null, если кода нет. */
    fun emoji(cc: String?): String? {
        val code = cc?.lowercase()?.takeIf { it.length == 2 && it.all { ch -> ch in 'a'..'z' } } ?: return null
        val base = 0x1F1E6 - 'a'.code
        return String(Character.toChars(base + code[0].code)) +
            String(Character.toChars(base + code[1].code))
    }

    /** Пара региональных символов в начале строки — это и есть код страны. */
    private fun ccFromRegional(text: String): String? {
        if (text.length < 4) return null
        val a = text.codePointAt(0)
        val b = text.codePointAt(2)
        val lo = 0x1F1E6
        val hi = 0x1F1FF
        if (a !in lo..hi || b !in lo..hi) return null
        val cc = (('a'.code + (a - lo)).toChar()).toString() + ('a'.code + (b - lo)).toChar()
        return cc.takeIf { it in known }
    }

    private fun isEmoji(ch: Char): Boolean {
        val cp = ch.code
        return cp == 0xFE0F || cp == 0x200D || Character.isSpaceChar(cp) ||
            cp in 0x2600..0x27BF ||
            cp in 0xD800..0xDFFF // суррогаты: сюда попадают эмодзи вне BMP
    }
}
