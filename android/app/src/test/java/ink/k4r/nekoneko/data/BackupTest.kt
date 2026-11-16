package ink.k4r.nekoneko.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Резервная копия: что сохраняем, что принимаем обратно и что отвергаем. */
class BackupTest {

    private val strings = mapOf("dns" to "1.1.1.1", "theme" to "neon", "empty" to "")
    private val flags = mapOf("killSwitch" to true, "autoStart" to false)

    @Test
    fun `копия читается обратно`() {
        val snapshot = Backup.parse(Backup.export(strings, flags))
        assertEquals("1.1.1.1", snapshot?.strings?.get("dns"))
        assertEquals("neon", snapshot?.strings?.get("theme"))
        assertEquals(true, snapshot?.flags?.get("killSwitch"))
        assertEquals(false, snapshot?.flags?.get("autoStart"))
    }

    @Test
    fun `пустые строки в файл не попадают`() {
        val text = Backup.export(strings, flags)
        assertTrue(!text.contains("\"empty\""))
    }

    @Test
    fun `чужой файл отвергается`() {
        assertNull(Backup.parse("""{"app":"something-else","version":1,"settings":{}}"""))
        assertNull(Backup.parse("""{"version":1,"settings":{}}"""))
        assertNull(Backup.parse("не json"))
        assertNull(Backup.parse(""))
    }

    @Test
    fun `файл будущей версии не ломает текущую`() {
        assertNull(Backup.parse("""{"app":"k4r-neko-vpn","version":99,"settings":{"dns":"1.1.1.1"}}"""))
    }

    @Test
    fun `неизвестные ключи пропускаются, известные берутся`() {
        val snapshot = Backup.parse(
            """{"app":"k4r-neko-vpn","version":1,"settings":{"dns":"9.9.9.9","чужое":"x","killSwitch":false}}"""
        )
        assertEquals("9.9.9.9", snapshot?.strings?.get("dns"))
        assertEquals(false, snapshot?.flags?.get("killSwitch"))
        assertEquals(1, snapshot?.strings?.size)
        assertEquals(1, snapshot?.flags?.size)
    }

    @Test
    fun `подписки переносятся одной строкой`() {
        val subs = Subs.write(listOf(Sub(url = "https://a.example/sub", title = "Финляндия", body = "vless://x")))
        val snapshot = Backup.parse(Backup.export(mapOf("subscriptions" to subs, "activeSubscription" to "https://a.example/sub"), emptyMap()))
        val back = Subs.parse(snapshot?.strings?.get("subscriptions").orEmpty())
        assertEquals(1, back.size)
        assertEquals("Финляндия", back[0].title)
        assertEquals("https://a.example/sub", snapshot?.strings?.get("activeSubscription"))
    }

    @Test
    fun `пустая копия распознаётся как пустая`() {
        val snapshot = Backup.parse(Backup.export(emptyMap(), emptyMap()))
        assertTrue(snapshot != null && snapshot.isEmpty)
    }
}
