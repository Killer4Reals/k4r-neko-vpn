package ink.k4r.nekoneko.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Разделение по программам. Главное правило Android: пустой список разрешённых
 * означает «все приложения». Если добавить туда себя, «только выбранные» станет
 * «только это приложение», и остальные пойдут напрямую.
 */
class SplitTest {

    private val self = "ink.k4r.nekoneko.vpn"

    @Test
    fun `по умолчанию в туннель идут все приложения`() {
        assertTrue(Split.allowed(Split.ONLY, emptySet(), self).isEmpty())
        assertTrue(Split.excluded(Split.ONLY, emptySet()).isEmpty())
    }

    @Test
    fun `только выбранные плюс себя`() {
        val allowed = Split.allowed(Split.ONLY, setOf("org.telegram.messenger"), self)
        assertEquals(2, allowed.size)
        assertTrue(allowed.contains("org.telegram.messenger"))
        assertTrue(allowed.contains(self))
        assertTrue(Split.excluded(Split.ONLY, setOf("org.telegram.messenger")).isEmpty())
    }

    @Test
    fun `все кроме выбранных`() {
        val chosen = setOf("com.example.game")
        assertTrue(Split.allowed("all", chosen, self).isEmpty())
        assertEquals(listOf("com.example.game"), Split.excluded("all", chosen))
    }

    @Test
    fun `себя не добавляем дважды`() {
        val allowed = Split.allowed(Split.ONLY, setOf(self), self)
        assertEquals(1, allowed.size)
    }
}
