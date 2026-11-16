package ink.k4r.nekoneko.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Флаги стран. На Android рисуем эмодзи, поэтому важно правильно вытащить код
 * из имени, которое присылает провайдер, и не съесть само название.
 */
class FlagsTest {

    @Test
    fun `код из пары региональных символов`() {
        assertEquals("fi", Flags.ccFromName("🇫🇮 Финляндия"))
        assertEquals("nl", Flags.ccFromName("🇳🇱 Нидерланды"))
    }

    @Test
    fun `код из латинского префикса`() {
        assertEquals("fi", Flags.ccFromName("FI Финляндия"))
        assertEquals("de", Flags.ccFromName("DE Germany"))
    }

    @Test
    fun `страна по названию на русском и английском`() {
        assertEquals("fi", Flags.ccFromName("Финляндия"))
        assertEquals("nl", Flags.ccFromName("Amsterdam"))
        assertEquals("us", Flags.ccFromName("Нью-Йорк"))
    }

    @Test
    fun `неизвестное имя не даёт флага`() {
        assertNull(Flags.ccFromName(""))
        assertNull(Flags.ccFromName("   "))
        assertNull(Flags.ccFromName("Сервер №3"))
        assertNull(Flags.ccFromName("XX Неизвестно"))
    }

    @Test
    fun `флаг убирается из имени, название остаётся`() {
        assertEquals("Финляндия", Flags.stripCc("🇫🇮 Финляндия"))
        assertEquals("Финляндия", Flags.stripCc("FI Финляндия"))
        assertEquals("Финляндия", Flags.stripCc("Финляндия"))
    }

    @Test
    fun `слово, похожее на код, не съедается`() {
        // «It works» — не Италия: после кода должно идти имя собственное
        assertEquals("It works", Flags.stripCc("It works"))
    }

    @Test
    fun `эмодзи по коду страны`() {
        assertEquals("🇫🇮", Flags.emoji("fi"))
        assertNull(Flags.emoji("xx"))
        assertNull(Flags.emoji(null))
    }
}
