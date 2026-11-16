package ink.k4r.nekoneko.vpn

import ink.k4r.nekoneko.data.Profile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Конфиг ядра. Смотрим на то, что реально уходит sing-box: адреса TUN,
 * поля VLESS, TLS/REALITY, транспорт и DNS. Ошибка здесь — мёртвый туннель.
 */
class ConfigTest {

    private fun profile(
        security: String = "reality",
        network: String = "grpc",
        serviceName: String = "api",
        path: String = "",
        flow: String = "",
    ) = Profile(
        id = "host:443#имя",
        name = "Финляндия",
        host = "server.example.invalid",
        port = 443,
        uuid = "11111111-2222-4333-8444-555555555555",
        flow = flow,
        security = security,
        network = network,
        sni = "deepl.com",
        publicKey = "PUBKEY",
        shortId = "abc123",
        fingerprint = "firefox",
        serviceName = serviceName,
        path = path,
        raw = "",
    )

    private fun build(p: Profile = profile(), dns: String = "1.1.1.1", blockIpv6: Boolean = true) =
        J.of(Config.build(p, dns, blockIpv6))

    @Test
    fun `тун входящий с адресом и маршрутом`() {
        val config = build()
        val inbound = config.obj("inbounds").arr(0)
        assertEquals("tun", inbound.str("type"))
        assertEquals("172.19.0.1/30", inbound.obj("address").list()[0])
        assertEquals(1350, inbound.int("mtu"))
        assertTrue(inbound.bool("auto_route"))
        assertEquals("mixed", inbound.str("stack"))
    }

    @Test
    fun `выход vless содержит адрес сервера и uuid`() {
        val out = build().obj("outbounds").arr(0)
        assertEquals("vless", out.str("type"))
        assertEquals("proxy", out.str("tag"))
        assertEquals("server.example.invalid", out.str("server"))
        assertEquals(443, out.int("server_port"))
        assertEquals("11111111-2222-4333-8444-555555555555", out.str("uuid"))
    }

    @Test
    fun `reality включает tls с отпечатком и ключом`() {
        val tls = build().obj("outbounds").arr(0).obj("tls")
        assertTrue(tls.bool("enabled"))
        assertEquals("deepl.com", tls.str("server_name"))
        assertEquals("firefox", tls.obj("utls").str("fingerprint"))
        val reality = tls.obj("reality")
        assertTrue(reality.bool("enabled"))
        assertEquals("PUBKEY", reality.str("public_key"))
        assertEquals("abc123", reality.str("short_id"))
    }

    @Test
    fun `обычный tls без reality`() {
        val tls = build(profile(security = "tls")).obj("outbounds").arr(0).obj("tls")
        assertTrue(tls.bool("enabled"))
        assertFalse(tls.has("reality"))
    }

    @Test
    fun `без шифрования блока tls нет`() {
        val out = build(profile(security = "none")).obj("outbounds").arr(0)
        assertFalse(out.has("tls"))
    }

    @Test
    fun `gRPC передаёт имя сервиса, ws — путь`() {
        val grpc = build(profile(network = "grpc", serviceName = "api"))
            .obj("outbounds").arr(0).obj("transport")
        assertEquals("grpc", grpc.str("type"))
        assertEquals("api", grpc.str("service_name"))

        val ws = build(profile(network = "ws", path = "/ws"))
            .obj("outbounds").arr(0).obj("transport")
        assertEquals("ws", ws.str("type"))
        assertEquals("/ws", ws.str("path"))
    }

    @Test
    fun `flow передаётся, если задан`() {
        val out = build(profile(flow = "xtls-rprx-vision")).obj("outbounds").arr(0)
        assertEquals("xtls-rprx-vision", out.str("flow"))
        val plain = build(profile(flow = "")).obj("outbounds").arr(0)
        assertFalse(plain.has("flow"))
    }

    @Test
    fun `обычный адрес DNS превращается в DoH`() {
        val server = build(dns = "1.1.1.1").obj("dns").obj("servers").arr(0)
        assertEquals("https", server.str("type"))
        assertEquals("1.1.1.1", server.str("server"))
    }

    @Test
    fun `DoH-адрес передаётся как есть, вместе с путём`() {
        val server = build(dns = "https://dns.google/resolve")
            .obj("dns").obj("servers").arr(0)
        assertEquals("https", server.str("type"))
        assertEquals("dns.google", server.str("server"))
        assertEquals("/resolve", server.str("path"))
    }

    @Test
    fun `DoT-адрес становится tls-резолвером`() {
        val server = build(dns = "tls://dns.google")
            .obj("dns").obj("servers").arr(0)
        assertEquals("tls", server.str("type"))
        assertEquals("dns.google", server.str("server"))
    }

    @Test
    fun `блокировка IPv6 меняет стратегию DNS`() {
        assertEquals("ipv4_only", build(blockIpv6 = true).obj("dns").str("strategy"))
        assertEquals("prefer_ipv4", build(blockIpv6 = false).obj("dns").str("strategy"))
    }

    @Test
    fun `правила перехватывают DNS и не пускают локальную сеть в туннель`() {
        val route = build().obj("route")
        val rules = route.obj("rules")
        var dnsHijack = false
        var privateDirect = false
        for (i in 0 until rules.size()) {
            val rule = rules.arr(i)
            if (rule.optStr("protocol") == "dns" && rule.optStr("action") == "hijack-dns") dnsHijack = true
            if (rule.optBool("ip_is_private") && rule.optStr("outbound") == "direct") privateDirect = true
        }
        assertTrue("DNS должен перехватываться", dnsHijack)
        assertTrue("Локальная сеть должна идти напрямую", privateDirect)
        assertEquals("proxy", route.str("final"))
    }
}
