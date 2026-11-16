package ink.k4r.nekoneko.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Выбор сервера. Провайдер кладёт в список запись «Авто-выбор сервера» с чужим
 * адресом — она не отвечает; при этом мёртвых серверов в списках тоже хватает.
 * Поэтому проверяем и выбор по умолчанию, и порядок перебора.
 */
class ServersTest {

    private fun profile(name: String, host: String, port: Int = 443) = Profile(
        id = "$host:$port#$name",
        name = name,
        host = host,
        port = port,
        uuid = "11111111-2222-3333-4444-555555555555",
        flow = "",
        security = "reality",
        network = "grpc",
        sni = "deepl.com",
        publicKey = "PUBKEY",
        shortId = "abc",
        fingerprint = "chrome",
        serviceName = "api",
        path = "",
        raw = "",
    )

    private val auto = profile("Авто-выбор сервера", "selectel.ru", 10121)
    private val finland = profile("🇫🇮 Финляндия", "bisw222.example.invalid", 10121)
    private val london = profile("🇬🇧 Лондон", "agazani.example.invalid", 10121)
    private val netherlands = profile("🇳🇱 Нидерланды", "habsxjj.example.invalid", 10121)
    private val poland = profile("🇵🇱 Польша", "ebusc.example.invalid", 10121)

    @Test
    fun `по умолчанию первый настоящий сервер, а не авто-выбор`() {
        val list = listOf(auto, finland, london)
        assertEquals(finland, Servers.defaultProfile(list))
    }

    @Test
    fun `если кроме авто-выбора ничего нет, берём его`() {
        assertEquals(auto, Servers.defaultProfile(listOf(auto)))
    }

    @Test
    fun `заглушка провайдера не считается сервером`() {
        val stub = profile("Достигнут предел", "0.0.0.0", 1)
        assertEquals(0, Servers.real(listOf(stub)).size)
        assertNull(Servers.defaultProfile(listOf(stub)))
    }

    @Test
    fun `выбранный сервер пробуем первым`() {
        val list = listOf(auto, finland, london, netherlands, poland)
        val order = Servers.attempts(list, "agazani.example.invalid:10121")
        assertEquals(london, order.first())
    }

    @Test
    fun `пробуем не больше трёх и без повторов`() {
        val list = listOf(auto, finland, london, netherlands, poland)
        val order = Servers.attempts(list, "")
        assertEquals(3, order.size)
        assertEquals(3, order.map { it.id }.toSet().size)
        assertEquals(finland, order.first())
    }

    @Test
    fun `чужой выбор не ломает перебор`() {
        // выбранного сервера в списке больше нет — начинаем с первого настоящего
        val order = Servers.attempts(listOf(auto, finland, london), "old.example.invalid:443")
        assertEquals(finland, order.first())
        // «Авто-выбор» остаётся последней попыткой: вдруг у провайдера он живой
        assertEquals(auto, order.last())
        assertEquals(3, order.size)
    }

    @Test
    fun `пустой список не даёт попыток`() {
        assertEquals(0, Servers.attempts(emptyList(), "").size)
        assertNull(Servers.defaultProfile(emptyList()))
    }

    @Test
    fun `авто-выбор узнаётся по имени`() {
        assertTrue(Servers.isAuto("Авто-выбор сервера"))
        assertTrue(Servers.isAuto("Auto select"))
        assertFalse(Servers.isAuto("🇫🇮 Финляндия"))
        assertFalse(Servers.isAuto("Amsterdam 2"))
    }
}
