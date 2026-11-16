package ink.k4r.nekoneko.data

import java.net.HttpURLConnection
import java.net.URL

/**
 * Загрузка подписки. Ничего лишнего: один GET с заголовком клиента, разбор
 * заголовков и тела. Адрес вводит владелец — в коде его нет.
 */
object SubscriptionClient {

    // Тот же клиент, что на ПК: провайдеры отдают «Приложение не поддерживается»
    // любому незнакомому заголовку, поэтому строку не меняем.
    private const val UA = "K4R-Neko-VPN/0.1"

    fun fetch(url: String, hwid: String = ""): SubResult {
        val text = url.trim()
        require(text.startsWith("http://") || text.startsWith("https://")) { "адрес должен начинаться с http:// или https://" }
        val connection = (URL(text).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15000
            readTimeout = 20000
            setRequestProperty("User-Agent", UA)
            // Провайдер узнаёт устройство по этому заголовку; без него — заглушка
            if (hwid.isNotEmpty()) setRequestProperty("X-HWID", hwid)
            // Эти три строки нужны только чтобы в кабинете провайдера устройство
            // называлось понятно («Pixel 6, Android 15»), а не «неизвестное»
            setRequestProperty("X-Device-OS", "Android")
            setRequestProperty("X-Ver-OS", android.os.Build.VERSION.RELEASE.orEmpty())
            setRequestProperty("X-Device-Model", android.os.Build.MODEL.orEmpty())
        }
        try {
            val code = connection.responseCode
            if (code !in 200..299) error("сервер ответил $code")
            val info = SubscriptionParser.parseUserinfo(connection.getHeaderField("subscription-userinfo"))
            val title = SubscriptionParser.parseTitle(connection.getHeaderField("profile-title"))
            val refresh = SubscriptionParser.parseRefreshHours(connection.getHeaderField("profile-update-interval"))
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            val direct = SubscriptionParser.parse(body)
            // Провайдер может отдать ссылку на вторую подписку вместо списка
            val nested = if (direct.isEmpty() && body.trim().startsWith("http")) {
                fetch(body.trim()).profiles
            } else {
                direct
            }
            // Провайдер умеет отвечать заглушкой «приложение не поддерживается»:
            // это профиль с адресом 0.0.0.0:1. Показываем её словами, а не сервером.
            SubscriptionParser.placeholderReason(nested)?.let { throw IllegalStateException(it) }
            return SubResult(nested, info, title, refresh)
        } finally {
            connection.disconnect()
        }
    }

    /** Тот же разбор, но из вставленного текста — на случай ручного импорта. */
    fun fromText(text: String): List<Profile> = SubscriptionParser.parse(text)
}
