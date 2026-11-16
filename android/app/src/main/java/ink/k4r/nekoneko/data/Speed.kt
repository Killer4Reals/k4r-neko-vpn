package ink.k4r.nekoneko.data

import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Спидтест. Качаем файл известного размера тем же путём, которым ходит
 * обычный трафик: приложение живёт внутри туннеля, поэтому цифра — это скорость
 * туннеля, а не «скорость рядом с телефоном». Если туннеля нет, соединение
 * уйдёт напрямую, и тогда честный ответ — «нечего мерить», а не красивая цифра.
 */
object Speed {

    /** Файл на 5 МБ: достаточно, чтобы измерить, и мало, чтобы не жечь трафик. */
    const val URL_SPEED = "https://speed.cloudflare.com/__down?bytes=5000000"
    const val BYTES = 5_000_000
    const val CAP_MS = 12_000L
    const val MIN_MS = 600L

    /** Мбит в секунду по числу байт и времени. */
    fun mbps(bytes: Long, millis: Long): Double {
        if (bytes <= 0 || millis <= 0) return 0.0
        return bytes * 8.0 / (millis / 1000.0) / 1_000_000.0
    }

    /** Подпись результата: «18.4 Мбит/с». */
    fun label(mbps: Double, russian: Boolean): String {
        val unit = if (russian) "Мбит/с" else "Mbps"
        val rounded = Math.round(mbps * 10.0) / 10.0
        return "$rounded $unit"
    }

    /**
     * Замер. Возвращает мбит/с или null, если скачать не удалось.
     * Читаем кусками и останавливаемся по сроку: сеть может «жевать» вечно.
     */
    suspend fun measure(
        url: String = URL_SPEED,
        capMs: Long = CAP_MS,
        onSpeed: (Double) -> Unit = {},
    ): Double? = withContext(Dispatchers.IO) {
        var connection: HttpURLConnection? = null
        try {
            connection = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 6000
                readTimeout = 8000
                instanceFollowRedirects = true
                setRequestProperty("User-Agent", "K4R-Neko-VPN")
            }
            val started = System.nanoTime()
            val stream: InputStream = connection.inputStream
            val buffer = ByteArray(64 * 1024)
            var total = 0L
            var complete = false
            stream.use {
                while (true) {
                    val read = it.read(buffer)
                    if (read <= 0) {
                        // Файл скачался целиком: на быстром канале это может
                        // случиться раньше, чем истечёт «минимальный» срок —
                        // такой замер всё равно настоящий
                        complete = true
                        break
                    }
                    total += read
                    val millis = (System.nanoTime() - started) / 1_000_000
                    if (millis >= capMs) break
                    // Показываем, как растёт скорость: человек видит, что идёт замер
                    if (millis >= MIN_MS) onSpeed(mbps(total, millis))
                }
            }
            val millis = ((System.nanoTime() - started) / 1_000_000).coerceAtLeast(1)
            if (total <= 0) return@withContext null
            if (millis < MIN_MS && !complete) return@withContext null
            mbps(total, millis)
        } catch (e: Exception) {
            null
        } finally {
            try {
                connection?.disconnect()
            } catch (e: Exception) {
            }
        }
    }
}
