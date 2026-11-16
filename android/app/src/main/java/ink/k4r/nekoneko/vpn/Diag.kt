package ink.k4r.nekoneko.vpn

import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Date
import java.util.Locale

/**
 * Журнал того, что делает ядро и служба. Держим последние строки в памяти:
 * когда что-то не работает, человек может показать журнал, а не пересказывать
 * «не подключается». Логи в файл не пишем — там оказались бы адреса серверов.
 */
object Diag {

    const val LIMIT = 200

    private val lines = ArrayDeque<String>()
    private val clock = SimpleDateFormat("HH:mm:ss", Locale.US)

    @Synchronized
    fun add(message: String) {
        val text = message.trim()
        if (text.isEmpty()) return
        lines.addLast("${clock.format(Date())}  $text")
        while (lines.size > LIMIT) lines.removeFirst()
    }

    @Synchronized
    fun lines(): List<String> = lines.toList()

    @Synchronized
    fun clear() = lines.clear()

    /** Адрес в журнал не попадает: чужие глаза видят меньше. */
    private val address = Regex("""[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}(:\d+)?""")

    fun server(name: String): String {
        val text = address.replace(name.trim(), "адрес").trim().trim(':')
        return "«${text.ifBlank { "без имени" }}»"
    }
}
