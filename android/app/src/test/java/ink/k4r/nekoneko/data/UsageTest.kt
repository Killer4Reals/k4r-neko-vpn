package ink.k4r.nekoneko.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Учёт трафика по дням: сложение, границы и окно недели. */
class UsageTest {

    @Test
    fun `новый день добавляется`() {
        val list = Usage.add(emptyList(), "2026-11-16", 100, 50)
        assertEquals(1, list.size)
        assertEquals(100L, list[0].rx)
        assertEquals(50L, list[0].tx)
        assertEquals(150L, list[0].total)
    }

    @Test
    fun `тот же день складывается`() {
        var list = Usage.add(emptyList(), "2026-11-16", 100, 50)
        list = Usage.add(list, "2026-11-16", 10, 5)
        assertEquals(1, list.size)
        assertEquals(110L, list[0].rx)
        assertEquals(55L, list[0].tx)
    }

    @Test
    fun `дни не путаются между собой`() {
        var list = Usage.add(emptyList(), "2026-11-15", 10, 1)
        list = Usage.add(list, "2026-11-16", 20, 2)
        list = Usage.add(list, "2026-11-15", 5, 5)
        assertEquals(2, list.size)
        assertEquals(15L, list.first { it.day == "2026-11-15" }.rx)
        assertEquals(20L, list.first { it.day == "2026-11-16" }.rx)
    }

    @Test
    fun `нулевые байты ничего не создают`() {
        assertTrue(Usage.add(emptyList(), "2026-11-16", 0, 0).isEmpty())
    }

    @Test
    fun `отрицательное не уменьшает счётчик`() {
        var list = Usage.add(emptyList(), "2026-11-16", 100, 100)
        list = Usage.add(list, "2026-11-16", -500, -500)
        assertEquals(200L, list[0].total)
    }

    @Test
    fun `храним не больше тридцати дней`() {
        var list = emptyList<Day>()
        for (day in 1..40) {
            list = Usage.add(list, "2026-10-%02d".format(day).replace("-1", "-1"), day.toLong(), 1)
        }
        assertTrue(list.size <= Usage.KEEP)
        assertEquals(Usage.KEEP, list.size)
        assertTrue(list.last().day > list.first().day)
    }

    @Test
    fun `запись и чтение сохраняют дни`() {
        val list = Usage.add(Usage.add(emptyList(), "2026-11-15", 7, 3), "2026-11-16", 1, 2)
        val restored = Usage.parse(Usage.write(list))
        assertEquals(2, restored.size)
        assertEquals("2026-11-15", restored[0].day)
        assertEquals(10L, restored[0].total)
        assertEquals(3L, restored[1].total)
    }

    @Test
    fun `мусор вместо истории не роняет`() {
        assertTrue(Usage.parse("не json").isEmpty())
        assertTrue(Usage.parse("").isEmpty())
        assertTrue(Usage.parse("""[{"day":"2026-11-16"}]""").isEmpty() == false)
    }

    @Test
    fun `окно недели берёт последние семь дней`() {
        var list = emptyList<Day>()
        for (day in 1..10) list = Usage.add(list, "2026-11-%02d".format(day), day.toLong(), 0)
        val week = Usage.window(list, 7)
        assertEquals(7, week.size)
        assertEquals("2026-11-04", week.first().day)
        assertEquals("2026-11-10", week.last().day)
    }

    @Test
    fun `пик и сумма`() {
        val list = listOf(Day("2026-11-15", 100, 50), Day("2026-11-16", 10, 5))
        assertEquals(150L, Usage.peak(list))
        assertEquals(165L, Usage.total(list))
        assertEquals(0L, Usage.peak(emptyList()))
    }
}
