package ink.k4r.nekoneko.data

import android.util.Base64
import java.net.URLDecoder

/** Один сервер из подписки. Поля те же, что в Windows-версии. */
data class Profile(
    val id: String,
    val name: String,
    val host: String,
    val port: Int,
    val uuid: String,
    val flow: String = "",
    val security: String = "none",
    val network: String = "tcp",
    val sni: String = "",
    val publicKey: String = "",
    val shortId: String = "",
    val fingerprint: String = "",
    val serviceName: String = "",
    val path: String = "",
    val raw: String = "",
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
    val refreshHint: Int,
)

/**
 * Разбор подписки. Логика один в один как в Windows-версии: строки `vless://`,
 * заголовок `subscription-userinfo` с числами, `profile-title` в base64 и
 * `profile-update-interval` с подсказкой про автообновление.
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
            val value = kv[1].trim().removeSuffix("L").trim().toLongOrNull() ?: continue
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

    fun parseRefreshHours(header: String?): Int =
        header?.trim()?.toIntOrNull()?.takeIf { it in 1..168 } ?: 12

    fun parse(body: String): List<Profile> {
        val direct = parseLines(body)
        if (direct.isNotEmpty()) return direct
        // Провайдеры часто отдают весь список в base64 — тогда разбираем его
        val decoded = decodeBase64(body) ?: return emptyList()
        return parseLines(decoded)
    }

    private fun parseLines(body: String): List<Profile> {
        val out = mutableListOf<Profile>()
        for (line in body.lineSequence()) {
            val text = line.trim()
            if (text.isEmpty() || text.startsWith("#")) continue
            profileFromUri(text)?.let { out += it }
        }
        return out
    }

    /** base64 без переводов строк; null, если это не base64. */
    private fun decodeBase64(text: String): String? {
        val clean = text.filterNot { it.isWhitespace() }
        if (clean.isEmpty()) return null
        return try {
            String(Base64.decode(clean, Base64.DEFAULT), Charsets.UTF_8)
        } catch (e: IllegalArgumentException) {
            null
        }
    }

    private fun profileFromUri(uri: String): Profile? {
        if (!uri.startsWith("vless://", ignoreCase = true)) return null
        val rest = uri.substring("vless://".length)
        val userinfo = rest.substringBefore('@', "")
        val after = rest.substringAfter('@', "")
        val hostPort = after.substringBefore('?').substringBefore('#')
        val host = hostPort.substringBeforeLast(':', "")
        val port = hostPort.substringAfterLast(':', "").toIntOrNull() ?: return null
        if (host.isEmpty() || userinfo.isEmpty()) return null

        val query = after.substringAfter('?', "").substringBefore('#')
        val params = mutableMapOf<String, String>()
        for (pair in query.split('&')) {
            val kv = pair.split('=', limit = 2)
            if (kv.size == 2) params[kv[0]] = decode(kv[1])
        }
        val tag = after.substringAfter('#', "")
        val name = decode(tag).ifEmpty { "$host:$port" }
        return Profile(
            id = "$host:$port#$name",
            name = name,
            host = host,
            port = port,
            uuid = decode(userinfo),
            flow = params["flow"].orEmpty(),
            security = params["security"]?.lowercase() ?: "none",
            network = params["type"]?.lowercase() ?: "tcp",
            sni = params["sni"].orEmpty(),
            publicKey = params["pbk"].orEmpty(),
            shortId = params["sid"].orEmpty(),
            fingerprint = params["fp"].orEmpty(),
            serviceName = params["serviceName"].orEmpty(),
            path = params["path"].orEmpty(),
            raw = uri,
        )
    }

    private fun decode(text: String): String = try {
        URLDecoder.decode(text, "UTF-8")
    } catch (e: Exception) {
        text
    }
}
