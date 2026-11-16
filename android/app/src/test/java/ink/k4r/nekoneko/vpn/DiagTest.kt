package ink.k4r.nekoneko.vpn

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Журнал в памяти: он не должен расти без конца, и он не должен содержать
 * адресов серверов — иначе человек, показывая журнал, показывает свой сервер.
 */
class DiagTest {

    @After
    fun clean() = Diag.clear()

    @Test
    fun `строки идут в том же порядке`() {
        Diag.clear()
        Diag.add("первая")
        Diag.add("вторая")
        val lines = Diag.lines()
        assertEquals(2, lines.size)
        assertTrue(lines[0].endsWith("первая"))
        assertTrue(lines[1].endsWith("вторая"))
    }

    @Test
    fun `журнал не растёт бесконечно`() {
        Diag.clear()
        for (index in 1..Diag.LIMIT + 25) Diag.add("строка $index")
        val lines = Diag.lines()
        assertEquals(Diag.LIMIT, lines.size)
        assertTrue("старые строки должны вытесняться", lines.last().endsWith("строка ${Diag.LIMIT + 25}"))
        assertTrue(lines.first().endsWith("строка 26"))
    }

    @Test
    fun `пустые строки не засоряют журнал`() {
        Diag.clear()
        Diag.add("")
        Diag.add("   ")
        assertEquals(0, Diag.lines().size)
    }

    @Test
    fun `очистка работает`() {
        Diag.clear()
        Diag.add("что-то")
        Diag.clear()
        assertEquals(0, Diag.lines().size)
    }

    @Test
    fun `у сервера в журнале нет адреса`() {
        assertEquals("«Финляндия»", Diag.server("Финляндия"))
        assertTrue(!Diag.server("bisw222.axinode.sbs:10121").contains("10121"))
    }

    @Test
    fun `хвост файла обрезается по целой строке`() {
        val text = (1..100).joinToString("\n") { "строка " + it }
        val cut = Diag.trim(text, 200)
        assertTrue(cut.length <= 200)
        // первая строка в отчёте должна быть целой, без обрывка
        assertTrue(cut.startsWith("строка "))
        assertTrue(cut.endsWith("строка 100"))
    }

    @Test
    fun `короткий журнал не трогаем`() {
        val text = "раз\nдва"
        assertEquals(text, Diag.trim(text, 1000))
    }

    @Test
    fun `отчёт содержит шапку и строки`() {
        Diag.clear()
        Diag.add("проверка отчёта")
        val report = Diag.report("шапка")
        assertTrue(report.startsWith("шапка"))
        assertTrue(report.contains("проверка отчёта"))
    }
}
