package ink.k4r.nekoneko.data

import android.content.Context
import android.provider.Settings

/**
 * Всё, что приложение помнит между запусками. Одно место, чтобы не искать
 * настройки по экранам: адрес подписки, выбранный сервер, DNS, разделение.
 */
class Store(context: Context) {

    private val context = context.applicationContext
    private val prefs = context.getSharedPreferences("settings", Context.MODE_PRIVATE)

    var subUrl: String
        get() = prefs.getString("sub_url", "").orEmpty()
        set(value) = prefs.edit().putString("sub_url", value).apply()

    /** Тело последней загруженной подписки — из него собираем профили. */
    var subBody: String
        get() = prefs.getString("sub_body", "").orEmpty()
        set(value) = prefs.edit().putString("sub_body", value).apply()

    /** Адрес выбранного сервера в виде host:port; по нему находим профиль. */
    var selected: String
        get() = prefs.getString("selected", "").orEmpty()
        set(value) = prefs.edit().putString("selected", value).apply()

    /**
     * Постоянный идентификатор устройства. Провайдеры (Happ, RayTun и подобные)
     * считают по нему устройства: без заголовка X-HWID они отвечают заглушкой
     * «приложение не поддерживается», даже если слот свободен.
     *
     * Считаем его из системного ANDROID_ID, а не из случайных чисел: он живёт
     * столько же, сколько телефон, и переустановка приложения его не меняет —
     * иначе каждая переустановка занимала бы у провайдера новый слот.
     */
    val hwid: String
        get() {
            val saved = prefs.getString("hwid", "").orEmpty()
            if (saved.isNotEmpty()) return saved
            val seed = try {
                Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
            } catch (e: Exception) {
                null
            }
            val fresh = if (seed.isNullOrBlank()) {
                // совсем без системного идентификатора — остаётся случайный
                (1..12).map { "0123456789ABCDEF"[kotlin.random.Random.nextInt(16)] }.joinToString("")
            } else {
                hwid(seed)
            }
            prefs.edit().putString("hwid", fresh).apply()
            return fresh
        }

    /**
     * Не выпускать трафик напрямую, если туннель упал. Пока выключено, обрыв
     * означает «интернет снова как обычно, но уже без защиты».
     */
    var killSwitch: Boolean
        get() = prefs.getBoolean("kill_switch", true)
        set(value) = prefs.edit().putBoolean("kill_switch", value).apply()

    companion object {
        /** 12 шестнадцатеричных знаков из системного идентификатора. */
        fun hwid(androidId: String): String {
            val digest = java.security.MessageDigest.getInstance("SHA-256")
                .digest(("k4r-neko-vpn:$androidId").toByteArray(Charsets.UTF_8))
            return digest.take(6).joinToString("") { "%02X".format(it) }
        }
    }

    /** Поднимать туннель сразу после перезагрузки телефона. */
    var autoStart: Boolean
        get() = prefs.getBoolean("auto_start", false)
        set(value) = prefs.edit().putBoolean("auto_start", value).apply()

    /** night / neon / day — как три темы на ПК. */
    var theme: String
        get() = prefs.getString("theme", "night").orEmpty()
        set(value) = prefs.edit().putString("theme", value).apply()

    var dns: String
        get() = prefs.getString("dns", "1.1.1.1").orEmpty()
        set(value) = prefs.edit().putString("dns", value).apply()

    var blockIpv6: Boolean
        get() = prefs.getBoolean("block_ipv6", true)
        set(value) = prefs.edit().putBoolean("block_ipv6", value).apply()

    /** only = в туннель идут выбранные, all = все, кроме выбранных. */
    var splitMode: String
        get() = prefs.getString("split_mode", "only").orEmpty()
        set(value) = prefs.edit().putString("split_mode", value).apply()

    fun chosen(): MutableSet<String> =
        prefs.getStringSet("chosen", emptySet())?.toMutableSet() ?: mutableSetOf()

    fun setChosen(value: Set<String>) = prefs.edit().putStringSet("chosen", value).apply()

    /** Что провайдер сообщил о подписке: название, трафик, срок. */
    var subTitle: String
        get() = prefs.getString("sub_title", "").orEmpty()
        set(value) = prefs.edit().putString("sub_title", value).apply()

    var subUsed: Long
        get() = prefs.getLong("sub_used", 0)
        set(value) = prefs.edit().putLong("sub_used", value).apply()

    var subTotal: Long
        get() = prefs.getLong("sub_total", 0)
        set(value) = prefs.edit().putLong("sub_total", value).apply()

    var subExpire: Long
        get() = prefs.getLong("sub_expire", 0)
        set(value) = prefs.edit().putLong("sub_expire", value).apply()

    var subRefresh: Int
        get() = prefs.getInt("sub_refresh", 12)
        set(value) = prefs.edit().putInt("sub_refresh", value).apply()

    var subFetched: Long
        get() = prefs.getLong("sub_fetched", 0)
        set(value) = prefs.edit().putLong("sub_fetched", value).apply()

    fun profiles(): List<Profile> = SubscriptionParser.parse(subBody)

    fun profile(): Profile? {
        val list = profiles()
        if (list.isEmpty()) return null
        val key = selected
        return list.firstOrNull { "${it.host}:${it.port}" == key } ?: defaultProfile(list)
    }

    /**
     * Кого пробовать: сначала выбранный сервер, потом остальные из подписки,
     * но не больше трёх. Провайдеры держат в списке и мёртвые адреса, и запись
     * «авто-выбор», которая никуда не ведёт — перебираем, а не сдаёмся сразу.
     */
    fun attempts(limit: Int = Servers.ATTEMPTS): List<Profile> = Servers.attempts(profiles(), selected, limit)

    /** По умолчанию берём первый настоящий сервер: «Авто-выбор» — не сервер. */
    fun defaultProfile(list: List<Profile> = profiles()): Profile? = Servers.defaultProfile(list)
}
