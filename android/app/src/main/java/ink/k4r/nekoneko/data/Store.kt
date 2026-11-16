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

    /**
     * Подписки. Раньше была одна, и её поля лежали в настройках по отдельности;
     * теперь список, но наружу Store по-прежнему отдаёт действующую подписку:
     * экрану не нужно знать, сколько их.
     */
    fun subList(): List<Sub> {
        val stored = prefs.getString("subs", "").orEmpty()
        if (stored.isNotBlank()) return Subs.parse(stored)
        // перенос со старой версии: одна подписка в отдельных полях
        val legacyUrl = prefs.getString("sub_url", "").orEmpty()
        return if (legacyUrl.isBlank()) emptyList() else listOf(
            Sub(
                url = legacyUrl,
                title = prefs.getString("sub_title", "").orEmpty(),
                body = prefs.getString("sub_body", "").orEmpty(),
                fetched = prefs.getLong("sub_fetched", 0),
                refresh = prefs.getInt("sub_refresh", 12),
                used = prefs.getLong("sub_used", 0),
                total = prefs.getLong("sub_total", 0),
                expire = prefs.getLong("sub_expire", 0),
            )
        )
    }

    fun saveSubs(list: List<Sub>) = prefs.edit().putString("subs", Subs.write(list)).apply()

    /** Адрес действующей подписки. */
    var activeSub: String
        get() = prefs.getString("sub_active", "").orEmpty()
        set(value) = prefs.edit().putString("sub_active", value).apply()

    fun active(): Sub? = Subs.active(subList(), activeSub)

    /** Добавить подписку или обновить известную, сохранив порядок. */
    fun putSub(sub: Sub) {
        saveSubs(Subs.upsert(subList(), sub))
        activeSub = sub.url
    }

    fun forgetSub(url: String) {
        val rest = Subs.remove(subList(), url)
        saveSubs(rest)
        if (activeSub == url) activeSub = rest.firstOrNull()?.url.orEmpty()
    }

    private fun updateActive(change: (Sub) -> Sub) {
        val current = active() ?: return
        putSub(change(current))
    }

    var subUrl: String
        get() = active()?.url.orEmpty()
        set(value) {
            val clean = value.trim()
            if (clean.isEmpty()) return
            val known = subList().firstOrNull { it.url == clean }
            if (known == null) {
                putSub(Sub(url = clean))
            } else {
                activeSub = clean
            }
        }

    /** Тело последней загруженной подписки — из него собираем профили. */
    var subBody: String
        get() = active()?.body.orEmpty()
        set(value) = updateActive { it.copy(body = value) }

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
        /** Сегодняшняя дата в виде 2026-11-16: по ней и складываем дни. */
        fun today(): String {
            val format = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
            return format.format(java.util.Date())
        }

        /** 12 шестнадцатеричных знаков из системного идентификатора. */
        fun hwid(androidId: String): String {
            val digest = java.security.MessageDigest.getInstance("SHA-256")
                .digest(("k4r-neko-vpn:$androidId").toByteArray(Charsets.UTF_8))
            return digest.take(6).joinToString("") { "%02X".format(it) }
        }
    }

    /** Язык интерфейса: system / ru / en. */
    var lang: String
        get() = prefs.getString("lang", Lang.SYSTEM).orEmpty()
        set(value) = prefs.edit().putString("lang", value).apply()

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
        get() = active()?.title.orEmpty()
        set(value) = updateActive { it.copy(title = value) }

    var subUsed: Long
        get() = active()?.used ?: 0
        set(value) = updateActive { it.copy(used = value) }

    var subTotal: Long
        get() = active()?.total ?: 0
        set(value) = updateActive { it.copy(total = value) }

    var subExpire: Long
        get() = active()?.expire ?: 0
        set(value) = updateActive { it.copy(expire = value) }

    var subRefresh: Int
        get() = active()?.refresh ?: 12
        set(value) = updateActive { it.copy(refresh = value) }

    var subFetched: Long
        get() = active()?.fetched ?: 0
        set(value) = updateActive { it.copy(fetched = value) }

    /** Сколько прошло через туннель по дням (последние 30). */
    fun usage(): List<Day> = Usage.parse(prefs.getString("usage", "").orEmpty())

    /** Прибавить к сегодняшнему дню. Пишем всё сразу: потерять счётчик обиднее. */
    fun addUsage(rx: Long, tx: Long) {
        if (rx <= 0 && tx <= 0) return
        val list = Usage.add(usage(), today(), rx, tx)
        prefs.edit().putString("usage", Usage.write(list)).apply()
    }

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
