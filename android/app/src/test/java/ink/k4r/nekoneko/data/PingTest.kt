package ink.k4r.nekoneko.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Отклик сервера. Проверяем на живом сокете: слушающий порт отвечает,
 * закрытый — нет, а подпись не врёт про единицы измерения.
 */
class PingTest {

    @Test
    fun `живой порт мерится`() {
        ServerSocket(0).use { server ->
            val port = server.localPort
            val latch = CountDownLatch(1)
            Thread {
                latch.countDown()
                try {
                    server.accept().close()
                } catch (e: Exception) {
                    // сервер закрыли — это нормально
                }
            }.start()
            latch.await(2, TimeUnit.SECONDS)
            val ms = Ping.measure("127.0.0.1", port, 2000)
            assertNotNull(ms)
            assertTrue("отклик не может быть отрицательным", ms!! >= 0)
        }
    }

    @Test
    fun `закрытый порт — нет ответа`() {
        val free = ServerSocket(0).use { it.localPort }
        // порт только что был свободен и, скорее всего, всё ещё никем не занят
        assertNull(Ping.measure("127.0.0.1", free, 400))
    }

    @Test
    fun `пустой адрес и кривой порт не меряются`() {
        assertNull(Ping.measure("", 443))
        assertNull(Ping.measure("127.0.0.1", 0))
        assertNull(Ping.measure("127.0.0.1", 70000))
    }

    @Test
    fun `подпись по-русски`() {
        assertEquals("нет ответа", Ping.label(null, true))
        assertEquals("<1 мс", Ping.label(0, true))
        assertEquals("42 мс", Ping.label(42, true))
    }

    @Test
    fun `подпись по-английски`() {
        assertEquals("no answer", Ping.label(null, false))
        assertEquals("<1 ms", Ping.label(0, false))
        assertEquals("42 ms", Ping.label(42, false))
    }
}
