package ink.k4r.nekoneko.vpn

/**
 * Крошечный сборщик JSON. Настоящий `org.json` тянет за собой Android и делает
 * конфиг непроверяемым на обычной машине; здесь нужны только объекты, массивы,
 * строки, числа и флаги. Порядок ключей сохраняется — так конфиг читаем глазами
 * в логах ядра.
 */
class Jso private constructor(private val value: Any?) {

    fun put(key: String, value: Any?): Jso {
        val map = this.value as? LinkedHashMap<String, Any?>
            ?: throw IllegalStateException("put с ключом только для объекта")
        map[key] = plain(value)
        return this
    }

    /** Для массива: значение без ключа. */
    fun add(value: Any?): Jso {
        val list = this.value as? ArrayList<Any?>
            ?: throw IllegalStateException("add только для массива")
        list.add(plain(value))
        return this
    }

    fun size(): Int = when (val v = value) {
        is Map<*, *> -> v.size
        is List<*> -> v.size
        else -> 0
    }

    override fun toString(): String = StringBuilder().also { write(it, value) }.toString()

    private fun plain(value: Any?): Any? = when (value) {
        is Jso -> value.value
        else -> value
    }

    private fun write(out: StringBuilder, value: Any?) {
        when (value) {
            null -> out.append("null")
            is Boolean -> out.append(value)
            is Int, is Long -> out.append(value)
            is Double -> out.append(value)
            is String -> quote(out, value)
            is Map<*, *> -> {
                out.append('{')
                var first = true
                for ((key, item) in value) {
                    if (!first) out.append(',')
                    first = false
                    quote(out, key.toString())
                    out.append(':')
                    write(out, item)
                }
                out.append('}')
            }
            is List<*> -> {
                out.append('[')
                var first = true
                for (item in value) {
                    if (!first) out.append(',')
                    first = false
                    write(out, item)
                }
                out.append(']')
            }
            else -> quote(out, value.toString())
        }
    }

    /** Экранирование по RFC 8259; кириллицу оставляем как есть — файл в UTF-8. */
    private fun quote(out: StringBuilder, text: String) {
        out.append('"')
        for (ch in text) {
            when {
                ch == '"' -> out.append("\\\"")
                ch == '\\' -> out.append("\\\\")
                ch == '\n' -> out.append("\\n")
                ch == '\r' -> out.append("\\r")
                ch == '\t' -> out.append("\\t")
                ch < ' ' -> out.append("\\u").append(String.format("%04x", ch.code))
                else -> out.append(ch)
            }
        }
        out.append('"')
    }

    companion object {
        fun obj(vararg pairs: Pair<String, Any?>): Jso {
            val one = Jso(LinkedHashMap<String, Any?>())
            for ((key, value) in pairs) one.put(key, value)
            return one
        }

        fun arr(vararg items: Any?): Jso {
            val one = Jso(ArrayList<Any?>())
            for (item in items) one.add(item)
            return one
        }
    }
}
