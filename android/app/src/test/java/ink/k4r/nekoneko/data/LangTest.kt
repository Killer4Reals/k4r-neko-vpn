package ink.k4r.nekoneko.data

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Язык интерфейса. Строки берутся из ресурсов, а вот выбор языка — чистая
 * логика: её и проверяем.
 */
class LangTest {

    @Test
    fun `выбранный язык важнее системного`() {
        assertEquals(Lang.RU, Lang.resolve(Lang.RU, "en"))
        assertEquals(Lang.EN, Lang.resolve(Lang.EN, "ru"))
    }

    @Test
    fun `как в системе — берём язык телефона`() {
        assertEquals(Lang.EN, Lang.resolve(Lang.SYSTEM, "en"))
        assertEquals(Lang.RU, Lang.resolve(Lang.SYSTEM, "ru"))
    }

    @Test
    fun `неизвестный язык телефона — английский`() {
        assertEquals(Lang.EN, Lang.resolve(Lang.SYSTEM, "de"))
        assertEquals(Lang.EN, Lang.resolve("", "de"))
    }

    @Test
    fun `в настройках ровно три варианта`() {
        assertEquals(listOf(Lang.SYSTEM, Lang.RU, Lang.EN), Lang.options)
    }
}
