package ink.k4r.nekoneko.vpn

import android.content.Context
import java.io.File
import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Date
import java.util.Locale

/**
 * Журнал того, что делает ядро и служба. Держим последние строки в памяти,
 * а рядом — в файле: если приложение упало, показать журнал будет некому,
 * поэтому последние события должны переживать падение.
 *
 * Адреса серверов в журнал не попадают ни в памяти, ни в файле: чужие глаза
 * видят меньше, а имя сервера для разбора достаточно.
 */
object Diag {

    const val LIMIT = 200

    /** Сколько байт журнала держим на диске: хватает на несколько подключений. */
    const val FILE_LIMIT = 200_000

    private val lines = ArrayDeque<String>()
    private val clock = SimpleDateFormat("HH:mm:ss", Locale.US)

    @Volatile
    private var file: File? = null

    /** Привязать журнал к папке приложения. Вызывается при старте: дальше пишем и на диск. */
    fun attach(context: Context) {
        if (file != null) return
        file = File(context.applicationContext.filesDir, "diag.log")
    }

    @Synchronized
    fun add(message: String) {
        val text = message.trim()
        if (text.isEmpty()) return
        val line = "${clock.format(Date())}  $text"
        lines.addLast(line)
        while (lines.size > LIMIT) lines.removeFirst()
        persist(line)
    }

    @Synchronized
    fun lines(): List<String> = lines.toList()

    @Synchronized
    fun clear() {
        lines.clear()
        try {
            file?.writeText("")
        } catch (e: Exception) {
        }
    }

    /** Журнал с диска: то, что было до последнего запуска, тоже полезно. */
    fun saved(): String = try {
        file?.takeIf { it.exists() }?.readText().orEmpty().trim()
    } catch (e: Exception) {
        ""
    }

    /** Сколько строк лежит на диске: видно, что журнал переживает закрытие. */
    fun savedCount(): Int = saved().lineSequence().count { it.isNotBlank() }

    /** Что отправить в поддержку: шапка + журнал из памяти и с диска. */
    fun report(header: String): String {
        val memory = lines().joinToString("\n")
        val disk = saved()
        val parts = ArrayList<String>(3)
        parts += header.trim()
        if (memory.isNotEmpty()) parts += "--- сейчас ---\n$memory"
        if (disk.isNotEmpty() && !disk.endsWith(memory)) parts += "--- до запуска ---\n$disk"
        return parts.joinToString("\n\n")
    }

    private fun persist(line: String) {
        val target = file ?: return
        try {
            val old = if (target.exists()) target.readText() else ""
            val text = trim("$old\n$line", FILE_LIMIT)
            target.writeText(text)
        } catch (e: Exception) {
            // Диск может быть занят или полон: журнал на диске — не повод падать
        }
    }

    /**
     * Оставить хвост не длиннее [limit] байт, начиная с целой строки:
     * обрезанная с середины строка в отчёте только мешает.
     */
    fun trim(text: String, limit: Int): String {
        if (text.length <= limit) return text
        val tail = text.substring(text.length - limit)
        val start = tail.indexOf('\n')
        return if (start in 0 until tail.lastIndex) tail.substring(start + 1) else tail
    }

    /**
     * Падение приложения: строку пишем до того, как система убьёт процесс.
     * Свой обработчик не глотает сбой — дальше работает системный.
     */
    fun installCrashHandler() {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            try {
                add("СБОЙ: ${error.javaClass.name}: ${error.message}")
                val trace = error.stackTrace.take(8).joinToString("\n") { "  $it" }
                add(trace)
            } catch (e: Throwable) {
            }
            previous?.uncaughtException(thread, error)
        }
    }

    /** Адрес в журнал не попадает: чужие глаза видят меньше. */
    private val address = Regex("""[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}(:\d+)?""")

    fun server(name: String): String {
        val text = address.replace(name.trim(), "адрес").trim().trim(':')
        return "«${text.ifBlank { "без имени" }}»"
    }
}
