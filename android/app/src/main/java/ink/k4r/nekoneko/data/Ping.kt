package ink.k4r.nekoneko.data

import java.net.InetSocketAddress
import java.net.Socket

/**
 * Отклик сервера. Меряем время до установления TCP-соединения с его адресом:
 * это честная цифра «сколько ждать до сервера», а не выдуманный пинг. Работает
 * ли через него туннель, проверяет отдельно запуск — обе вещи разные.
 */
object Ping {

    const val TIMEOUT_MS = 2500

    /** Миллисекунды или null, если сервер не ответил. */
    fun measure(host: String, port: Int, timeoutMs: Int = TIMEOUT_MS): Long? {
        if (host.isBlank() || port !in 1..65535) return null
        val started = System.nanoTime()
        return try {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(host, port), timeoutMs)
                (System.nanoTime() - started) / 1_000_000
            }
        } catch (e: Exception) {
            null
        }
    }

    /** Подпись для списка серверов: «42 мс», «—», «нет ответа». */
    fun label(ms: Long?, russian: Boolean): String = when {
        ms == null -> if (russian) "нет ответа" else "no answer"
        ms < 1 -> if (russian) "<1 мс" else "<1 ms"
        else -> if (russian) "$ms мс" else "$ms ms"
    }
}
