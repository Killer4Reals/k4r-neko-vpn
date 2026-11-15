package ink.k4r.nekoneko.vpn

import java.io.File

/**
 * Счётчики туннеля. Берём их у ядра системы — /sys/class/net/<имя>/statistics,
 * то есть ровно те байты, что прошли через наш интерфейс. Никаких «примерно»:
 * если файла нет, честно возвращаем null, и интерфейс показывает прочерк.
 */
object Traffic {

    /** Имя TUN-интерфейса, который создала система для нас. */
    @Volatile
    var interfaceName: String? = null

    private fun stats(name: String, file: String): Long? = try {
        File("/sys/class/net/$name/statistics/$file").readText().trim().toLongOrNull()
    } catch (e: Exception) {
        null
    }

    /** Сколько всего принято и отдано через туннель. */
    fun totals(): Pair<Long, Long>? {
        val name = interfaceName ?: return null
        val rx = stats(name, "rx_bytes") ?: return null
        val tx = stats(name, "tx_bytes") ?: return null
        return rx to tx
    }

    /** Имена tun-интерфейсов, которые есть в системе прямо сейчас. */
    fun tunNames(): Set<String> = try {
        File("/sys/class/net").list()?.filter { it.startsWith("tun") }?.toSet() ?: emptySet()
    } catch (e: Exception) {
        emptySet()
    }
}
