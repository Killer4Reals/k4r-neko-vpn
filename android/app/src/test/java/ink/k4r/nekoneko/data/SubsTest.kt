package ink.k4r.nekoneko.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Список подписок: хранение и переключение. Раньше подписка была одна, теперь
 * их несколько, и важно не потерять ни тело списка серверов, ни порядок.
 */
class SubsTest {

    private fun sub(url: String, title: String = "", body: String = "vless://x") =
        Sub(url = url, title = title, body = body, fetched = 1700000000000, refresh = 6, used = 10, total = 100, expire = 42)

    @Test
    fun `запись и чтение сохраняют всё`() {
        val list = listOf(sub("https://a.example/sub", "Первая"), sub("https://b.example/sub", "Вторая"))
        val restored = Subs.parse(Subs.write(list))
        assertEquals(2, restored.size)
        assertEquals("Первая", restored[0].title)
        assertEquals(6, restored[0].refresh)
        assertEquals(10L, restored[0].used)
        assertEquals(42L, restored[0].expire)
        assertEquals(1700000000000L, restored[0].fetched)
        assertEquals("vless://x", restored[1].body)
    }

    @Test
    fun `кириллица и кавычки переживают запись`() {
        val list = listOf(sub("https://a.example/sub", "Моя «подписка»\nвторая строка"))
        val restored = Subs.parse(Subs.write(list))
        assertEquals("Моя «подписка»\nвторая строка", restored[0].title)
    }

    @Test
    fun `пустое хранилище даёт пустой список`() {
        assertEquals(0, Subs.parse("").size)
        assertEquals(0, Subs.parse("не json").size)
    }

    @Test
    fun `без адреса запись пропускается`() {
        assertEquals(0, Subs.parse("""[{"title":"без адреса"}]""").size)
    }

    @Test
    fun `новая подписка добавляется в конец`() {
        val list = listOf(sub("https://a.example/sub"), sub("https://b.example/sub"))
        val next = Subs.upsert(list, sub("https://c.example/sub"))
        assertEquals(3, next.size)
        assertEquals("https://c.example/sub", next[2].url)
    }

    @Test
    fun `известная подписка обновляется на месте`() {
        val list = listOf(sub("https://a.example/sub", "Старое"), sub("https://b.example/sub"))
        val next = Subs.upsert(list, sub("https://a.example/sub", "Новое"))
        assertEquals(2, next.size)
        assertEquals("Новое", next[0].title)
        assertEquals("https://b.example/sub", next[1].url)
    }

    @Test
    fun `забыть одну подписку`() {
        val list = listOf(sub("https://a.example/sub"), sub("https://b.example/sub"))
        val next = Subs.remove(list, "https://a.example/sub")
        assertEquals(1, next.size)
        assertEquals("https://b.example/sub", next[0].url)
    }

    @Test
    fun `действующая — запомненная, иначе первая`() {
        val list = listOf(sub("https://a.example/sub"), sub("https://b.example/sub"))
        assertEquals("https://b.example/sub", Subs.active(list, "https://b.example/sub")?.url)
        assertEquals("https://a.example/sub", Subs.active(list, "пропала")?.url)
        assertNull(Subs.active(emptyList(), "https://a.example/sub"))
    }

    @Test
    fun `подпись плашки — название или адрес без схемы`() {
        assertEquals("Финляндия", sub("https://a.example/sub", "Финляндия").label())
        assertEquals("a.example/sub", sub("https://a.example/sub").label())
        assertEquals("a.example/sub2", sub("https://a.example/sub2/").label())
        assertTrue(sub("freetext").label().isNotEmpty())
    }
}
