package ink.k4r.nekoneko.vpn

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Сборщик JSON. Ошибка в экранировании — ядро не примет конфиг, поэтому
 * проверяем кавычки, обратную косую, переводы строк и кириллицу.
 */
class JsoTest {

    @Test
    fun `объект и массив в правильном порядке`() {
        val text = Jso.obj()
            .put("a", 1)
            .put("b", Jso.arr("x", "y"))
            .put("c", true)
            .toString()
        assertEquals("""{"a":1,"b":["x","y"],"c":true}""", text)
    }

    @Test
    fun `кавычки и обратная косая экранируются`() {
        val text = Jso.obj().put("path", """C:\tmp\"кавычка""").toString()
        assertEquals("""{"path":"C:\\tmp\\\"кавычка"}""", text)
    }

    @Test
    fun `управляющие символы становятся юникодом`() {
        val text = Jso.obj().put("name", "a\nb\u0001c").toString()
        assertEquals("""{"name":"a\nb\u0001c"}""", text)
    }

    @Test
    fun `кириллица не портится`() {
        val parsed = J.of(Jso.obj().put("name", "Финляндия").toString())
        assertEquals("Финляндия", parsed.str("name"))
    }

    @Test
    fun `вложенность читается обратно`() {
        val text = Jso.obj()
            .put("route", Jso.obj().put("rules", Jso.arr(Jso.obj().put("action", "sniff"))))
            .toString()
        val rule = J.of(text).obj("route").obj("rules").arr(0)
        assertEquals("sniff", rule.str("action"))
        assertTrue(text.contains("\"rules\":[{"))
    }
}
