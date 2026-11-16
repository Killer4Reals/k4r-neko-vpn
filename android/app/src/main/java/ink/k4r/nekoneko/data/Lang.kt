package ink.k4r.nekoneko.data

import android.content.Context
import android.content.res.Configuration
import java.util.Locale

/**
 * Язык интерфейса. По умолчанию — как в системе, но человек может выбрать
 * русский или английский прямо в настройках: на телефоне с английской
 * системой это нужно чаще, чем кажется.
 */
object Lang {

    const val SYSTEM = "system"
    const val RU = "ru"
    const val EN = "en"

    val options = listOf(SYSTEM, RU, EN)

    /** Язык из настроек; для «как в системе» — текущий язык телефона. */
    fun resolve(lang: String, system: String): String = when (lang) {
        RU, EN -> lang
        else -> if (system == RU) RU else EN
    }

    /** Контекст с подменённой локалью — из него Compose берёт строки. */
    fun context(base: Context, lang: String): Context {
        if (lang != RU && lang != EN) return base
        val locale = Locale(lang)
        val config = Configuration(base.resources.configuration)
        config.setLocale(locale)
        config.setLayoutDirection(locale)
        return base.createConfigurationContext(config)
    }
}
