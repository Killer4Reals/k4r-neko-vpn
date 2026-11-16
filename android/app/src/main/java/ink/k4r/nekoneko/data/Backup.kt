package ink.k4r.nekoneko.data

import ink.k4r.nekoneko.vpn.Jso
import ink.k4r.nekoneko.vpn.Jsons

/**
 * Резервная копия настроек: подписки, DNS, тема, язык, разделение, учёт трафика.
 * Формат — обычный JSON, чтобы копию можно было прочитать глазами и не бояться,
 * что она «только для этой версии». Секретов в ней нет, кроме ссылок на
 * подписки — их человек и так носит с собой.
 */
object Backup {

    const val APP = "k4r-neko-vpn"
    const val VERSION = 1

    /** Строковые настройки: имя в файле → ключ в настройках. */
    val STRINGS = mapOf(
        "subscriptions" to "subs",
        "activeSubscription" to "sub_active",
        "dns" to "dns",
        "theme" to "theme",
        "language" to "lang",
        "splitMode" to "split_mode",
        "deviceId" to "hwid",
        "usage" to "usage",
    )

    /** Переключатели. */
    val FLAGS = mapOf(
        "blockIpv6" to "block_ipv6",
        "autoStart" to "auto_start",
        "killSwitch" to "kill_switch",
    )

    /** Что удалось прочитать из файла копии. */
    data class Snapshot(
        val strings: Map<String, String>,
        val flags: Map<String, Boolean>,
    ) {
        val isEmpty: Boolean get() = strings.isEmpty() && flags.isEmpty()
    }

    fun export(strings: Map<String, String>, flags: Map<String, Boolean>): String {
        val body = Jso.obj()
        for ((key, value) in strings) {
            if (value.isNotEmpty()) body.put(key, value)
        }
        for ((key, value) in flags) body.put(key, value)
        return Jso.obj()
            .put("app", APP)
            .put("version", VERSION)
            .put("saved", System.currentTimeMillis())
            .put("settings", body)
            .toString()
    }

    /**
     * Читаем копию. Чужой файл или файл будущей версии — не ошибка приложения,
     * но и не повод что-то менять: возвращаем null и говорим об этом человеку.
     */
    fun parse(text: String): Snapshot? {
        val root = try {
            Jsons.read(text)
        } catch (e: Exception) {
            return null
        }
        val map = root as? Map<*, *> ?: return null
        if (map["app"] != APP) return null
        val version = (map["version"] as? Number)?.toInt() ?: return null
        if (version > VERSION) return null
        val settings = map["settings"] as? Map<*, *> ?: return null
        val strings = LinkedHashMap<String, String>()
        val flags = LinkedHashMap<String, Boolean>()
        for (key in STRINGS.keys) {
            val value = settings[key] as? String ?: continue
            if (value.isNotEmpty()) strings[key] = value
        }
        for (key in FLAGS.keys) {
            val value = settings[key] as? Boolean ?: continue
            flags[key] = value
        }
        return Snapshot(strings, flags)
    }
}
