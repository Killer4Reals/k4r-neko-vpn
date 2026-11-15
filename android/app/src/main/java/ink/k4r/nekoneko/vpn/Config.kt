package ink.k4r.nekoneko.vpn

import ink.k4r.nekoneko.data.Profile
import org.json.JSONArray
import org.json.JSONObject

/**
 * Конфиг для ядра. Форма та же, что в Windows-версии: TUN внутри, VLESS наружу,
 * один зашифрованный резолвер на всех. Отличие в том, что разделение по
 * программам здесь делает VpnService (allowed/disallowed), а не правила
 * `process_name`, поэтому в конфиге их нет.
 */
object Config {

    fun build(profile: Profile, dns: String, blockIpv6: Boolean): String {
        val root = JSONObject()
        root.put("log", JSONObject().put("level", "debug").put("timestamp", true))

        root.put("dns", dns(dns, blockIpv6))

        val inbound = JSONObject()
            .put("type", "tun")
            .put("tag", "tun-in")
            .put("address", JSONArray().put("172.19.0.1/30"))
            .put("mtu", 1350)
            .put("auto_route", true)
            .put("strict_route", true)
            .put("stack", "mixed")
        root.put("inbounds", JSONArray().put(inbound))

        val outbounds = JSONArray().put(outbound(profile))
        outbounds.put(JSONObject().put("type", "direct").put("tag", "direct"))
        root.put("outbounds", outbounds)

        val rules = JSONArray()
            .put(JSONObject().put("action", "sniff"))
            .put(JSONObject().put("protocol", "dns").put("action", "hijack-dns"))
            // локальная сеть остаётся локальной всегда
            .put(JSONObject().put("ip_is_private", true).put("outbound", "direct"))
        root.put(
            "route",
            JSONObject()
                .put("rules", rules)
                .put("final", "proxy")
                .put("auto_detect_interface", true)
                .put("default_domain_resolver", "remote")
        )
        return root.toString()
    }

    private fun outbound(profile: Profile): JSONObject {
        val out = JSONObject()
            .put("type", "vless")
            .put("tag", "proxy")
            .put("server", profile.host)
            .put("server_port", profile.port)
            .put("uuid", profile.uuid)
        if (profile.flow.isNotEmpty()) out.put("flow", profile.flow)

        if (profile.security == "tls" || profile.security == "reality") {
            val tls = JSONObject()
                .put("enabled", true)
                .put(
                    "utls",
                    JSONObject()
                        .put("enabled", true)
                        .put("fingerprint", profile.fingerprint.ifEmpty { "chrome" })
                )
            if (profile.sni.isNotEmpty()) tls.put("server_name", profile.sni)
            if (profile.security == "reality") {
                tls.put(
                    "reality",
                    JSONObject()
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
                JSONObject().put("type", "ws").put("path", profile.path.ifEmpty { "/" })
            )
            "grpc" -> {
                val transport = JSONObject().put("type", "grpc")
                if (profile.serviceName.isNotEmpty()) transport.put("service_name", profile.serviceName)
                out.put("transport", transport)
            }
        }
        return out
    }

    /** Тот же разбор, что на ПК: адрес → DoH, `https://`/`tls://` — как есть. */
    private fun dns(raw: String, blockIpv6: Boolean): JSONObject {
        val value = raw.trim()
        val remote = when {
            value.startsWith("https://") -> {
                val rest = value.removePrefix("https://")
                val host = rest.substringBefore('/')
                val path = if (rest.contains('/')) "/" + rest.substringAfter('/') else ""
                JSONObject().put("type", "https").put("tag", "remote").put("server", host).apply {
                    if (path.isNotEmpty() && path != "/dns-query") put("path", path)
                }
            }
            value.startsWith("tls://") ->
                JSONObject().put("type", "tls").put("tag", "remote").put("server", value.removePrefix("tls://"))
            value.isEmpty() ->
                JSONObject().put("type", "https").put("tag", "remote").put("server", "1.1.1.1")
            else -> JSONObject().put("type", "https").put("tag", "remote").put("server", value)
        }
        // Резолвер вызывается напрямую через интерфейс системы: он сообщён
        // ядру монитором, поэтому запрос до сервера доходит до поднятия туннеля.
        return JSONObject()
            .put("servers", JSONArray().put(remote).put(JSONObject().put("type", "local").put("tag", "system")))
            .put("final", "remote")
            .put("strategy", if (blockIpv6) "ipv4_only" else "prefer_ipv4")
    }
}
