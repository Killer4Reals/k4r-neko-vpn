package ink.k4r.nekoneko.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Скорость: арифметика и подписи. Сеть в тестах не трогаем. */
class SpeedTest {

    @Test
    fun `мегабиты считаются из байт и времени`() {
        // 5 000 000 байт = 40 000 000 бит за секунду = 40 Мбит/с
        assertEquals(40.0, Speed.mbps(5_000_000, 1000), 0.001)
        assertEquals(20.0, Speed.mbps(5_000_000, 2000), 0.001)
    }

    @Test
    fun `половина секунды даёт двойную скорость`() {
        assertEquals(80.0, Speed.mbps(5_000_000, 500), 0.001)
    }

    @Test
    fun `без данных скорость нулевая, а не бесконечная`() {
        assertEquals(0.0, Speed.mbps(0, 1000), 0.0)
        assertEquals(0.0, Speed.mbps(1000, 0), 0.0)
        assertEquals(0.0, Speed.mbps(-5, 1000), 0.0)
    }

    @Test
    fun `подпись округляет до десятых`() {
        assertEquals("18.4 Мбит/с", Speed.label(18.44, true))
        assertEquals("18.4 Mbps", Speed.label(18.44, false))
        assertEquals("40.0 Мбит/с", Speed.label(40.0, true))
        assertEquals("0.9 Mbps", Speed.label(0.86, false))
    }

    @Test
    fun `порог замера не нулевой`() {
        // слишком короткий замер ничего не доказывает: соединение ещё разгонялось
        assertTrue(Speed.MIN_MS >= 300)
        assertTrue(Speed.CAP_MS > Speed.MIN_MS)
    }
}
