package ink.k4r.nekoneko.vpn

/**
 * Крошечный разбор JSON для тестов. Настоящий `org.json` в юнит-тестах —
 * заглушка из android.jar («not mocked»), а тянуть зависимость ради проверки
 * конфига незачем: здесь нужны объекты, массивы, строки и числа.
 */
object Json {

    fun parse(text: String): Any? {
        val reader = Reader(text)
        val value = reader.value()
        reader.skipSpace()
        require(reader.done()) { "лишние символы после JSON" }
        return value
    }

    private class Reader(val text: String) {
        var at = 0
        fun done() = at >= text.length
        fun skipSpace() {
            while (at < text.length && text[at].isWhitespace()) at++
        }

        fun value(): Any? {
            skipSpace()
            return when (val c = text[at]) {
                '{' -> obj()
                '[' -> array()
                '"' -> str()
                't' -> literal("true", true)
                'f' -> literal("false", false)
                'n' -> literal("null", null)
                else -> if (c == '-' || c.isDigit()) num() else error("неожиданный символ '$c'")
            }
        }

        fun obj(): Map<String, Any?> {
            val out = LinkedHashMap<String, Any?>()
            at++ // {
            skipSpace()
            if (text[at] == '}') { at++; return out }
            while (true) {
                skipSpace()
                val key = str()
                skipSpace()
                require(text[at] == ':') { "ожидалось двоеточие" }
                at++
                out[key] = value()
                skipSpace()
                when (text[at]) {
                    ',' -> at++
                    '}' -> { at++; return out }
                    else -> error("ожидалась ',' или '}'")
                }
            }
        }

        fun array(): List<Any?> {
            val out = ArrayList<Any?>()
            at++ // [
            skipSpace()
            if (text[at] == ']') { at++; return out }
            while (true) {
                out += value()
                skipSpace()
                when (text[at]) {
                    ',' -> at++
                    ']' -> { at++; return out }
                    else -> error("ожидалась ',' или ']'")
                }
            }
        }

        fun str(): String {
            require(text[at] == '"') { "ожидалась строка" }
            at++
            val sb = StringBuilder()
            while (true) {
                val c = text[at++]
                when (c) {
                    '"' -> return sb.toString()
                    '\\' -> {
                        when (val esc = text[at++]) {
                            'n' -> sb.append('\n')
                            't' -> sb.append('\t')
                            'r' -> sb.append('\r')
                            'b' -> sb.append('\b')
                            'f' -> sb.append('\u000C')
                            'u' -> {
                                sb.append(text.substring(at, at + 4).toInt(16).toChar())
                                at += 4
                            }
                            else -> sb.append(esc)
                        }
                    }
                    else -> sb.append(c)
                }
            }
        }

        fun num(): Any {
            val start = at
            if (text[at] == '-') at++
            while (at < text.length && (text[at].isDigit() || text[at] in ".eE+-")) at++
            val raw = text.substring(start, at)
            return raw.toDoubleOrNull()?.takeIf { it % 1.0 != 0.0 || raw.contains('.') } ?: raw.toLong()
        }

        fun literal(word: String, result: Any?): Any? {
            require(text.startsWith(word, at)) { "ожидалось $word" }
            at += word.length
            return result
        }
    }
}

/** Удобные обращения: путь вида "route.rules.0.protocol". */
class J(val value: Any?) {

    fun obj(key: String): J = J(map()[key])
    fun arr(index: Int): J = J(list()[index])
    fun size(): Int = list().size
    fun str(key: String): String = map()[key] as? String ?: error("нет строки '$key'")
    fun long(key: String): Long = (map()[key] as? Number)?.toLong() ?: error("нет числа '$key'")
    fun int(key: String): Int = long(key).toInt()
    fun bool(key: String): Boolean = map()[key] as? Boolean ?: error("нет флага '$key'")
    fun has(key: String): Boolean = map().containsKey(key)
    fun isEmpty(): Boolean = when (val v = value) {
        null -> true
        is Map<*, *> -> v.isEmpty()
        is List<*> -> v.isEmpty()
        else -> false
    }

    @Suppress("UNCHECKED_CAST")
    fun map(): Map<String, Any?> = value as? Map<String, Any?> ?: error("ожидался объект, а не $value")

    @Suppress("UNCHECKED_CAST")
    fun list(): List<Any?> = value as? List<Any?> ?: error("ожидался массив, а не $value")

    /** Мягкие варианты: отсутствие ключа — это не ошибка. */
    fun optStr(key: String): String? = map()[key] as? String
    fun optBool(key: String): Boolean = map()[key] as? Boolean ?: false

    companion object {
        fun of(text: String) = J(Json.parse(text))
    }
}
