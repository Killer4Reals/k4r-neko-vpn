package ink.k4r.nekoneko.data

/**
 * Выбор сервера для подключения. Отдельно от настроек и службы: это чистая
 * логика, её можно проверить без телефона.
 */
object Servers {

    /** Сколько серверов пробуем за одно нажатие «Подключить». */
    const val ATTEMPTS = 3

    /** Настоящие серверы: заглушки провайдера (0.0.0.0 / порт 1) не в счёт. */
    fun real(profiles: List<Profile>): List<Profile> =
        profiles.filterNot { it.host.startsWith("0.0.0.0") || it.port == 1 }

    /** «Авто-выбор сервера» от провайдера — запись списка, а не сервер. */
    fun isAuto(name: String): Boolean {
        val text = name.lowercase()
        return text.contains("авто") || text.contains("auto") || text.contains("выбор")
    }

    /** Первый настоящий сервер; «Авто-выбор» пропускаем. */
    fun defaultProfile(profiles: List<Profile>): Profile? {
        val list = real(profiles)
        if (list.isEmpty()) return null
        return list.firstOrNull { !isAuto(it.name) } ?: list.first()
    }

    /**
     * Кого пробовать: сначала выбранный, потом остальные по порядку подписки.
     * Провайдеры держат в списке и мёртвые адреса, поэтому перебираем.
     */
    fun attempts(profiles: List<Profile>, selected: String, limit: Int = ATTEMPTS): List<Profile> {
        val list = real(profiles)
        if (list.isEmpty()) return emptyList()
        val first = list.firstOrNull { "${it.host}:${it.port}" == selected } ?: defaultProfile(list) ?: return emptyList()
        val rest = list.filter { it.id != first.id }
        // Записи «Авто-выбор» — последними: сначала настоящие серверы
        val ordered = rest.filterNot { isAuto(it.name) } + rest.filter { isAuto(it.name) }
        return (listOf(first) + ordered).take(limit)
    }
}
