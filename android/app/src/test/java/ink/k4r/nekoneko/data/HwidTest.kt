package ink.k4r.nekoneko.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Идентификатор устройства для провайдера. Он должен быть постоянным: иначе
 * каждая переустановка занимает новый слот, и подписка быстро упирается в
 * «достигнут предел количества устройств».
 */
class HwidTest {

    @Test
    fun `двенадцать шестнадцатеричных знаков`() {
        val id = Store.hwid("9774d56d682e549c")
        assertEquals(12, id.length)
        assertTrue(id.all { it in "0123456789ABCDEF" })
    }

    @Test
    fun `один и тот же телефон даёт один и тот же код`() {
        assertEquals(Store.hwid("9774d56d682e549c"), Store.hwid("9774d56d682e549c"))
    }

    @Test
    fun `разные телефоны дают разные коды`() {
        assertNotEquals(Store.hwid("9774d56d682e549c"), Store.hwid("a5f8b2c0d1e34f67"))
    }
}
