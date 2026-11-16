package ink.k4r.nekoneko.data

import ink.k4r.nekoneko.vpn.Jso
import ink.k4r.nekoneko.vpn.Jsons

/**
 * Одна подписка: ссылка, тело от провайдера и то, что он сообщил о трафике.
 * Раньше подписка была одна, и её поля лежали в настройках по отдельности;
 * теперь их список, но наружу Store по-прежнему отдаёт «действующую» подписку —
 * экрану не нужно знать, что их несколько.
 */
data class Sub(
    val url: String,
    val title: String = "",
    val body: String = "",
    val fetched: Long = 0,
    val refresh: Int = 12,
    val used: Long = 0,
    val total: Long = 0,
    val expire: Long = 0,
) {
    /**
     * Подпись на плашке: название от провайдера, а если его нет — адрес без
     * схемы вместе с последним куском пути: у одного провайдера их может быть
     * несколько, и по одному хосту их не различить.
     */
    fun label(): String {
        val text = title.trim()
        if (text.isNotEmpty()) return text
        val rest = url.substringAfter("://").trimEnd('/')
        if (rest.isEmpty()) return url
        return rest
    }
}

object Subs {

    fun parse(json: String): List<Sub> {
        if (json.isBlank()) return emptyList()
        val root = try {
            Jsons.read(json)
        } catch (e: Exception) {
            return emptyList()
        }
        @Suppress("UNCHECKED_CAST")
        val items = root as? List<Any?> ?: return emptyList()
        val out = ArrayList<Sub>(items.size)
        for (item in items) {
            val map = item as? Map<*, *> ?: continue
            val url = (map["url"] as? String).orEmpty()
            if (url.isBlank()) continue
            out += Sub(
                url = url,
                title = (map["title"] as? String).orEmpty(),
                body = (map["body"] as? String).orEmpty(),
                fetched = number(map["fetched"]),
                refresh = number(map["refresh"]).toInt().takeIf { it in 1..168 } ?: 12,
                used = number(map["used"]),
                total = number(map["total"]),
                expire = number(map["expire"]),
            )
        }
        return out
    }

    fun write(list: List<Sub>): String {
        val array = Jso.arr()
        for (sub in list) {
            array.add(
                Jso.obj()
                    .put("url", sub.url)
                    .put("title", sub.title)
                    .put("body", sub.body)
                    .put("fetched", sub.fetched)
                    .put("refresh", sub.refresh)
                    .put("used", sub.used)
                    .put("total", sub.total)
                    .put("expire", sub.expire)
            )
        }
        return array.toString()
    }

    /**
     * Добавляет подписку или обновляет уже известную по тому же адресу.
     * Порядок сохраняется: человек привыкает к своему списку.
     */
    fun upsert(list: List<Sub>, sub: Sub): List<Sub> {
        val index = list.indexOfFirst { it.url == sub.url }
        if (index < 0) return list + sub
        return list.toMutableList().also { it[index] = sub }
    }

    fun remove(list: List<Sub>, url: String): List<Sub> = list.filterNot { it.url == url }

    /** Действующая подписка; если запомненной нет — первая в списке. */
    fun active(list: List<Sub>, url: String): Sub? =
        list.firstOrNull { it.url == url } ?: list.firstOrNull()

    private fun number(value: Any?): Long = (value as? Number)?.toLong() ?: 0
}
