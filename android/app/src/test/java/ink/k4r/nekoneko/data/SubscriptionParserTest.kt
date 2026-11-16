package ink.k4r.nekoneko.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Разбор подписки. Проверяем то, что приходит от провайдеров на самом деле:
 * base64-тело, URI с REALITY и gRPC, заголовки с трафиком и сроком.
 */
class SubscriptionParserTest {

    private val link =
        "vless://11111111-2222-4333-8444-555555555555@bisw222.example.invalid:10121" +
            "?encryption=none&security=reality&sni=deepl.com&pbk=PUBKEY&sid=e47a9c31" +
            "&fp=firefox&type=grpc&serviceName=api#%F0%9F%87%AB%F0%9F%87%AE%20%D0%A4%D0%B8%D0%BD%D0%BB%D1%8F%D0%BD%D0%B4%D0%B8%D1%8F"

    @Test
    fun `разбирает ссылку vless с REALITY и gRPC`() {
        val profiles = SubscriptionParser.parse(link)
        assertEquals(1, profiles.size)
        val profile = profiles.first()
        assertEquals("bisw222.example.invalid", profile.host)
        assertEquals(10121, profile.port)
        assertEquals("11111111-2222-4333-8444-555555555555", profile.uuid)
        assertEquals("reality", profile.security)
        assertEquals("grpc", profile.network)
        assertEquals("deepl.com", profile.sni)
        assertEquals("PUBKEY", profile.publicKey)
        assertEquals("e47a9c31", profile.shortId)
        assertEquals("firefox", profile.fingerprint)
        assertEquals("api", profile.serviceName)
        // имя из фрагмента раскодировано (%D0%A4… → «Финляндия»)
        assertTrue(profile.name.contains("Финляндия"))
    }

    @Test
    fun `читает тело в base64`() {
        val plain = "$link\nvless://11111111-2222-3333-4444-555555555555@second.example.invalid:443" +
            "?encryption=none&security=tls&type=ws&path=%2Fws#Second"
        val wrapped = java.util.Base64.getEncoder().encodeToString(plain.toByteArray())
        val profiles = SubscriptionParser.parse(wrapped)
        assertEquals(2, profiles.size)
        assertEquals("second.example.invalid", profiles[1].host)
        assertEquals("ws", profiles[1].network)
        assertEquals("/ws", profiles[1].path)
    }

    @Test
    fun `пропускает мусор и комментарии`() {
        val body = "# комментарий\n\nне ссылка\n$link\n"
        val profiles = SubscriptionParser.parse(body)
        assertEquals(1, profiles.size)
    }

    @Test
    fun `пустое тело не даёт профилей`() {
        assertEquals(0, SubscriptionParser.parse("").size)
        assertEquals(0, SubscriptionParser.parse("   ").size)
    }

    @Test
    fun `ссылка без порта не превращается в профиль`() {
        assertEquals(0, SubscriptionParser.parse("vless://uuid@host.example.invalid?type=tcp").size)
    }

    @Test
    fun `разбирает заголовок с трафиком и сроком`() {
        val info = SubscriptionParser.parseUserinfo("upload=100; download=70752076244; total=0; expire=1796462447")
        assertNotNull(info)
        assertEquals(100L, info!!.upload)
        assertEquals(70752076244L, info.download)
        assertEquals(0L, info.total)
        assertEquals(1796462447L, info.expire)
        assertEquals(70752076344L, info.used)
        assertEquals(false, info.hasLimit)
    }

    @Test
    fun `заголовок с лимитом знает про лимит`() {
        val info = SubscriptionParser.parseUserinfo("upload=1; download=2; total=100; expire=0")!!
        assertEquals(true, info.hasLimit)
    }

    @Test
    fun `битые числа в заголовке не ломают разбор`() {
        assertNull(SubscriptionParser.parseUserinfo(null))
        assertNull(SubscriptionParser.parseUserinfo(""))
        val broken = SubscriptionParser.parseUserinfo("upload=abc; download=10")
        // число-ошибка пропускается, но download остаётся
        assertEquals(10L, broken?.download)
        assertEquals(0L, broken?.upload)
    }

    @Test
    fun `название подписки приходит в base64`() {
        val encoded = java.util.Base64.getEncoder().encodeToString("Моя подписка".toByteArray())
        assertEquals("Моя подписка", SubscriptionParser.parseTitle("base64:$encoded"))
    }

    @Test
    fun `название подписки бывает и обычным текстом`() {
        assertEquals("Happ VPN", SubscriptionParser.parseTitle("Happ VPN"))
        assertNull(SubscriptionParser.parseTitle(""))
        assertNull(SubscriptionParser.parseTitle(null))
    }

    @Test
    fun `подсказка об обновлении держится в разумных границах`() {
        assertEquals(6, SubscriptionParser.parseRefreshHours("6"))
        // меньше часа и больше недели — не верим, берём 12 часов
        assertEquals(12, SubscriptionParser.parseRefreshHours("0"))
        assertEquals(12, SubscriptionParser.parseRefreshHours("999"))
        assertEquals(12, SubscriptionParser.parseRefreshHours("не число"))
        assertEquals(12, SubscriptionParser.parseRefreshHours(null))
    }

    @Test
    fun `заглушка провайдера узнаётся по адресу и порту`() {
        val stub = SubscriptionParser.parse(
            "vless://00000000-0000-0000-0000-000000000000@0.0.0.0:1?encryption=none&type=tcp#%D0%94%D0%BE%D1%81%D1%82%D0%B8%D0%B3%D0%BD%D1%83%D1%82%20%D0%BF%D1%80%D0%B5%D0%B4%D0%B5%D0%BB"
        )
        val reason = SubscriptionParser.placeholderReason(stub)
        assertNotNull(reason)
        assertTrue(reason!!.contains("предел"))
    }

    @Test
    fun `настоящий сервер не считается заглушкой`() {
        assertNull(SubscriptionParser.placeholderReason(SubscriptionParser.parse(link)))
        assertNull(SubscriptionParser.placeholderReason(emptyList()))
    }

    @Test
    fun `предел устройств распознаётся`() {
        assertEquals(
            SubscriptionParser.Kind.DEVICES,
            SubscriptionParser.kindOf("Достигнут предел количества устройств"),
        )
        assertEquals(SubscriptionParser.Kind.DEVICES, SubscriptionParser.kindOf("device limit reached"))
        assertEquals(SubscriptionParser.Kind.DEVICES, SubscriptionParser.kindOf("превышено число устройств"))
    }

    @Test
    fun `просроченная подписка распознаётся`() {
        assertEquals(SubscriptionParser.Kind.EXPIRED, SubscriptionParser.kindOf("Подписка истекла"))
        assertEquals(SubscriptionParser.Kind.EXPIRED, SubscriptionParser.kindOf("subscription expired"))
        assertEquals(SubscriptionParser.Kind.EXPIRED, SubscriptionParser.kindOf("Срок подписки просрочен"))
    }

    @Test
    fun `непонятная причина остаётся прочим`() {
        assertEquals(SubscriptionParser.Kind.OTHER, SubscriptionParser.kindOf("provider says no"))
        assertEquals(SubscriptionParser.Kind.OTHER, SubscriptionParser.kindOf(""))
    }
}
