package ink.k4r.nekoneko.vpn

/**
 * Чтение JSON там, где он лежит у нас в настройках (список подписок).
 * Пишем своим [Jso], читаем здесь: объекты, массивы, строки, числа, флаги.
 */
object Jsons {

    /** Код обратной косой черты: писать её литералом в Kotlin — лишний повод ошибиться. */
    private const val BACKSLASH = 92.toChar()

    fun read(text: String): Any? {
        if (text.isBlank()) return null
        return Reader(text).value()
    }

    private class Reader(private val text: String) {
        private var at = 0

        fun value(): Any? {
            skipSpace()
            val c = text[at]
            return when (c) {
                '{' -> obj()
                '[' -> array()
                '"' -> string()
                't' -> literal("true", true)
                'f' -> literal("false", false)
                'n' -> literal("null", null)
                else -> if (c == '-' || c.isDigit()) number() else error("неожиданный символ '$c'")
            }
        }

        private fun obj(): Map<String, Any?> {
            val out = LinkedHashMap<String, Any?>()
            at++
            skipSpace()
            if (text[at] == '}') {
                at++
                return out
            }
            while (true) {
                skipSpace()
                val key = string()
                skipSpace()
                require(text[at] == ':') { "ожидалось двоеточие" }
                at++
                out[key] = value()
                skipSpace()
                when (text[at]) {
                    ',' -> at++
                    '}' -> {
                        at++
                        return out
                    }
                    else -> error("ожидалась ',' или '}'")
                }
            }
        }

        private fun array(): List<Any?> {
            val out = ArrayList<Any?>()
            at++
            skipSpace()
            if (text[at] == ']') {
                at++
                return out
            }
            while (true) {
                out += value()
                skipSpace()
                when (text[at]) {
                    ',' -> at++
                    ']' -> {
                        at++
                        return out
                    }
                    else -> error("ожидалась ',' или ']'")
                }
            }
        }

        private fun string(): String {
            require(text[at] == '"') { "ожидалась строка" }
            at++
            val out = StringBuilder()
            while (true) {
                val c = text[at++]
                if (c == '"') return out.toString()
                if (c != BACKSLASH) {
                    out.append(c)
                    continue
                }
                when (val esc = text[at++]) {
                    'n' -> out.append('\n')
                    't' -> out.append('\t')
                    'r' -> out.append('\r')
                    'b' -> out.append('\b')
                    'f' -> out.append('\u000C')
                    'u' -> {
                        out.append(text.substring(at, at + 4).toInt(16).toChar())
                        at += 4
                    }
                    else -> out.append(esc)
                }
            }
        }

        private fun number(): Any {
            val start = at
            if (text[at] == '-') at++
            while (at < text.length && (text[at].isDigit() || text[at] in ".eE+-")) at++
            val raw = text.substring(start, at)
            return raw.toDoubleOrNull()?.takeIf { it % 1.0 != 0.0 || raw.contains('.') } ?: raw.toLong()
        }

        private fun literal(word: String, result: Any?): Any? {
            require(text.startsWith(word, at)) { "ожидалось $word" }
            at += word.length
            return result
        }

        private fun skipSpace() {
            while (at < text.length && text[at].isWhitespace()) at++
        }
    }
}
