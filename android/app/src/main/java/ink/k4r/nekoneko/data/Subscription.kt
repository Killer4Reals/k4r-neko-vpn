package ink.k4r.nekoneko.data

import android.util.Base64

/** Один сервер из подписки. */
data class Profile(
    val id: String,
    val name: String,
    val host: String,
    val port: Int,
    val raw: String,
)

/** Что провайдер сказал про подписку: сколько съедено и до когда. */
data class SubInfo(
    val upload: Long = 0,
    val download: Long = 0,
    val total: Long = 0,
    val expire: Long = 0,
) {
    val used: Long get() = upload + download
    val hasLimit: Boolean get() = total > 0
}

data class SubResult(
    val profiles: List<Profile>,
    val info: SubInfo?,
    val title: String?,
)

/**
 * Разбор подписки. Та же логика, что в Windows-версии: строки `vless://` и
 * ссылки `https://` внутри тела, заголовок `subscription-userinfo` с числами,
 * заголовок `profile-title` в base64 или открытым текстом.
 */
object SubscriptionParser {

    fun parseUserinfo(header: String?): SubInfo? {
        if (header.isNullOrBlank()) return null
        var up = 0L
        var down = 0L
        var total = 0L
        var expire = 0L
        var any = false
        for (part in header.split(';', ',')) {
            val kv = part.split('=', limit = 2)
            if (kv.size != 2) continue
            val value = kv[1].trim().removeSuffix("L").toLongOrNull() ?: continue
            any = true
            when (kv[0].trim().lowercase()) {
                "upload" -> up = value
                "download" -> down = value
                "total" -> total = value
                "expire" -> expire = value
            }
        }
        return if (any) SubInfo(upload = up, download = down, total = total, expire = expire) else null
    }

    fun parseTitle(header: String?): String? {
        val text = header?.trim().orEmpty()
        if (text.isEmpty()) return null
        if (!text.startsWith("base64:", ignoreCase = true)) return text
        return try {
            val raw = text.substring("base64:".length).trim()
            String(Base64.decode(raw, Base64.DEFAULT), Charsets.UTF_8).trim().ifEmpty { null }
        } catch (e: IllegalArgumentException) {
            null
        }
    }

    fun parseBody(body: String): List<Profile> {
        val out = mutableListOf<Profile>()
        for (line in body.lineSequence()) {
            val text = line.trim()
            if (text.isEmpty() || text.startsWith("#")) continue
            val profile = profileFromUri(text) ?: continue
            out += profile
        }
        return out
    }

    private fun profileFromUri(uri: String): Profile? {
        if (!uri.startsWith("vless://", true)) return null
        val hostPort = uri.substringAfter('@', "").substringBefore('?').substringBefore('#')
        val host = hostPort.substringBeforeLast(':', "")
        val port = hostPort.substringAfterLast(':', "").toIntOrNull() ?: return null
        if (host.isEmpty()) return null
        val tag = uri.substringAfter('#', "").ifEmpty { "$host:$port" }
        val name = try {
            java.net.URLDecoder.decode(tag, "UTF-8")
        } catch (e: Exception) {
            tag
        }
        return Profile(id = "$host:$port#$name", name = name, host = host, port = port, raw = uri)
    }
}
