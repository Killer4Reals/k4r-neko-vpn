package ink.k4r.nekoneko.vpn

import ink.k4r.nekoneko.data.Profile

/**
 * Конфиг для ядра. Форма та же, что в Windows-версии: TUN внутри, VLESS наружу,
 * один зашифрованный резолвер на всех. Отличие в том, что разделение по
 * программам здесь делает VpnService (allowed/disallowed), а не правила
 * `process_name`, поэтому в конфиге их нет.
 */
object Config {

    fun build(profile: Profile, dns: String, blockIpv6: Boolean): String {
        val root = Jso.obj()
        root.put("log", Jso.obj().put("level", "debug").put("timestamp", true))

        root.put("dns", dns(dns, blockIpv6))

        val inbound = Jso.obj()
            .put("type", "tun")
            .put("tag", "tun-in")
            .put("address", Jso.arr("172.19.0.1/30"))
            .put("mtu", 1350)
            .put("auto_route", true)
            .put("strict_route", true)
            .put("stack", "mixed")
        root.put("inbounds", Jso.arr(inbound))

        val outbounds = Jso.arr(outbound(profile)).add(Jso.obj().put("type", "direct").put("tag", "direct"))
        root.put("outbounds", outbounds)

        val rules = Jso.arr()
            .add(Jso.obj().put("action", "sniff"))
            .add(Jso.obj().put("protocol", "dns").put("action", "hijack-dns"))
            // локальная сеть остаётся локальной всегда
            .add(Jso.obj().put("ip_is_private", true).put("outbound", "direct"))
        root.put(
            "route",
            Jso.obj()
                .put("rules", rules)
                .put("final", "proxy")
                .put("auto_detect_interface", true)
                .put("default_domain_resolver", "remote")
        )
        return root.toString()
    }

    private fun outbound(profile: Profile): Jso {
        val out = Jso.obj()
            .put("type", "vless")
            .put("tag", "proxy")
            .put("server", profile.host)
            .put("server_port", profile.port)
            .put("uuid", profile.uuid)
        if (profile.flow.isNotEmpty()) out.put("flow", profile.flow)

        if (profile.security == "tls" || profile.security == "reality") {
            val tls = Jso.obj()
                .put("enabled", true)
                .put(
                    "utls",
                    Jso.obj()
                        .put("enabled", true)
                        .put("fingerprint", profile.fingerprint.ifEmpty { "chrome" })
                )
            if (profile.sni.isNotEmpty()) tls.put("server_name", profile.sni)
            if (profile.security == "reality") {
                tls.put(
                    "reality",
                    Jso.obj()
                        .put("enabled", true)
                        .put("public_key", profile.publicKey)
                        .put("short_id", profile.shortId)
                )
            }
            out.put("tls", tls)
        }

        when (profile.network) {
            "ws" -> out.put(
                "transport",
                Jso.obj().put("type", "ws").put("path", profile.path.ifEmpty { "/" })
            )
            "grpc" -> {
                val transport = Jso.obj().put("type", "grpc")
                if (profile.serviceName.isNotEmpty()) transport.put("service_name", profile.serviceName)
                out.put("transport", transport)
            }
        }
        return out
    }

    /** Тот же разбор, что на ПК: адрес → DoH, `https://`/`tls://` — как есть. */
    private fun dns(raw: String, blockIpv6: Boolean): Jso {
        val value = raw.trim()
        val remote = when {
            value.startsWith("https://") -> {
                val rest = value.removePrefix("https://")
                val host = rest.substringBefore('/')
                val path = if (rest.contains('/')) "/" + rest.substringAfter('/') else ""
                Jso.obj().put("type", "https").put("tag", "remote").put("server", host).apply {
                    if (path.isNotEmpty() && path != "/dns-query") put("path", path)
                }
            }
            value.startsWith("tls://") ->
                Jso.obj().put("type", "tls").put("tag", "remote").put("server", value.removePrefix("tls://"))
            value.isEmpty() ->
                Jso.obj().put("type", "https").put("tag", "remote").put("server", "1.1.1.1")
            else -> Jso.obj().put("type", "https").put("tag", "remote").put("server", value)
        }
        // Резолвер вызывается напрямую через интерфейс системы: он сообщён
        // ядру монитором, поэтому запрос до сервера доходит до поднятия туннеля.
        return Jso.obj()
            .put("servers", Jso.arr(remote).add(Jso.obj().put("type", "local").put("tag", "system")))
            .put("final", "remote")
            .put("strategy", if (blockIpv6) "ipv4_only" else "prefer_ipv4")
    }
}
